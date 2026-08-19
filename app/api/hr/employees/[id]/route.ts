import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-logger";
import { userNameFields } from "@/lib/person-name";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

const patchEmployeeSchema = z.object({
  // Employee record fields (HR + SUPER_ADMIN)
  jobTitle: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional().nullable(),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]).optional(),
  managerId: z.string().min(1).optional().nullable(),
  phone: z.string().optional().nullable(),
  emergencyContact: z.string().optional().nullable(),
  emergencyPhone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  photoUrl: z.string().url().optional().nullable(),
  isActive: z.boolean().optional(),
  // Editable, not just settable at onboarding. Every employee hired before this
  // field existed has it null, and a null blocks maternity and paternity — so
  // without an edit path the block would have had no way to be lifted.
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  // Leave entitlement is derived from startDate (see lib/leave-policy.ts), so
  // correcting a wrong joining date immediately reprices every accrual. HR-only,
  // and audited below, because it silently moves someone's balance.
  startDate: z.string().transform((v) => new Date(v)).optional(),
  endDate: z.string().transform((v) => new Date(v)).optional().nullable(),
  // ─── Timesheet configuration (spec §Timesheets, migration 028) ───────────
  // HR-only, like the rest of the employee record. Switching `timesheetRequired`
  // on is what causes periods, reminders and overdue chases to start for this
  // person, so it is a deliberate act rather than a default.
  timesheetRequired: z.boolean().optional(),
  timesheetFrequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]).optional().nullable(),
  standardWorkingHours: z.number().positive().max(80).optional().nullable(),
  timesheetApproverId: z.string().min(1).optional().nullable(),
  costCentre: z.string().max(120).optional().nullable(),
  // User account fields (SUPER_ADMIN only)
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(["SUPER_ADMIN","HQ_EXECUTIVE","HQ_ANALYTICS","REGIONAL_MANAGER","ICR","INSTITUTION_CLIENT","HR_MANAGER","EMPLOYEE"]).optional(),
  regionId: z.string().min(1).optional().nullable(),
});

// ─── GET /api/hr/employees/[id] ───────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const year = new Date().getFullYear();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const employee = await db.employee.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, image: true, role: true, regionId: true } },
      department: true,
      manager: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
      directReports: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
      leaveBalances: { where: { year } },
      leaveRequests: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      worklogs: {
        orderBy: { date: "desc" },
        take: 30,
      },
      trainingRecords: { orderBy: { completedAt: "desc" } },
      documents: { orderBy: { uploadedAt: "desc" } },
      assetAssignments: {
        where: { returnedAt: null },
        include: { asset: true },
      },
      onboardingItems: { orderBy: { order: "asc" } },
    },
  });

  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  // Check access: HR managers can see all, employees can only see themselves
  const isHR = HR_ROLES.includes(session.user.role as Role);
  const isSelf = employee.userId === session.user.id;
  if (!isHR && !isSelf) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Recent attendance
  const recentAttendance = await db.attendance.findMany({
    where: { employeeId: id, date: { gte: thirtyDaysAgo } },
    orderBy: { date: "desc" },
  });

  // Open tasks
  const openTasks = await db.task.findMany({
    where: {
      assigneeId: id,
      deletedAt: null,
      status: { in: ["TODO", "IN_PROGRESS"] },
    },
    orderBy: { dueDate: "asc" },
    take: 10,
  });

  return NextResponse.json({ employee, recentAttendance, openTasks });
}

// ─── PATCH /api/hr/employees/[id] ─────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const employee = await db.employee.findUnique({ where: { id } });
  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const isHR = HR_ROLES.includes(session.user.role as Role);
  const isSelf = employee.userId === session.user.id;
  if (!isHR && !isSelf) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";

  // Split fields by permission level
  const superAdminUserFields = ["firstName", "lastName", "email", "role", "regionId"];
  // HR-only, like the other employment-record fields: gender decides parental
  // leave eligibility, so it is not something an employee sets on themselves.
  // NOTE: the loop below applies ONLY fields named in one of these three lists.
  // A field added to the zod schema and forgotten here validates cleanly and is
  // then silently discarded — the request returns 200 having changed nothing.
  // Add to both, or the change is a no-op.
  const hrEmployeeFields = [
    "jobTitle", "departmentId", "employmentType", "managerId", "isActive",
    "startDate", "endDate", "gender",
    // Timesheet configuration (migration 028).
    "timesheetRequired", "timesheetFrequency", "standardWorkingHours",
    "timesheetApproverId", "costCentre",
  ];
  const selfFields = ["phone", "emergencyContact", "emergencyPhone", "address", "photoUrl"];

  const employeeUpdate: Record<string, unknown> = {};
  const userUpdate: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(parsed.data)) {
    if (superAdminUserFields.includes(key)) {
      if (isSuperAdmin) userUpdate[key] = value;
    } else if (hrEmployeeFields.includes(key)) {
      if (isHR) employeeUpdate[key] = value;
    } else if (selfFields.includes(key)) {
      employeeUpdate[key] = value;
    }
  }

  // `name` is derived from both parts, so a request that changes only one of
  // them still has to be combined with the stored other half — recomputing
  // from `userUpdate` alone would blank the part that was not sent.
  if ("firstName" in userUpdate || "lastName" in userUpdate) {
    const current = await db.employee.findUnique({
      where: { id },
      select: { user: { select: { firstName: true, lastName: true } } },
    });
    Object.assign(
      userUpdate,
      userNameFields({
        firstName: (userUpdate.firstName as string | undefined) ?? current?.user.firstName,
        lastName: (userUpdate.lastName as string | undefined) ?? current?.user.lastName,
      })
    );
  }

  // Prevent demoting last super admin
  if (userUpdate.role && userUpdate.role !== "SUPER_ADMIN") {
    const emp = await db.employee.findUnique({ where: { id }, select: { userId: true } });
    const targetUser = await db.user.findUnique({ where: { id: emp?.userId }, select: { role: true } });
    if (targetUser?.role === "SUPER_ADMIN") {
      const adminCount = await db.user.count({ where: { role: "SUPER_ADMIN", deletedAt: null } });
      if (adminCount <= 1) {
        return NextResponse.json({ error: "Cannot change role of the last Super Admin" }, { status: 400 });
      }
    }
  }

  const [updated] = await Promise.all([
    db.employee.update({
      where: { id },
      data: employeeUpdate,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        department: { select: { id: true, name: true } },
      },
    }),
    ...(Object.keys(userUpdate).length > 0
      ? [db.employee.findUnique({ where: { id }, select: { userId: true } }).then((e) =>
          e ? db.user.update({ where: { id: e.userId }, data: userUpdate }) : null
        )]
      : []),
  ]);

  // A joining-date change reprices every leave accrual for that employee, with
  // no other trace that anything happened — so record the before and after.
  if (employeeUpdate.startDate) {
    const before = employee.startDate.toISOString().slice(0, 10);
    const after = (employeeUpdate.startDate as Date).toISOString().slice(0, 10);
    if (before !== after) {
      void logActivity(session.user.id, "UPDATE", "EMPLOYEE", id, {
        field: "startDate",
        from: before,
        to: after,
        note: "Joining date changed — leave entitlement recalculated",
      });
    }
  }

  return NextResponse.json({ employee: updated });
}
