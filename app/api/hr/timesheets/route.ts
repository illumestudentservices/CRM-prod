import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";
import {
  approvedLeaveHoursFor,
  expectedHoursFor,
  isTimesheetAdmin,
  periodFor,
  recordEvent,
  resolveApprover,
  round2,
} from "@/lib/timesheets";

/**
 * The timesheet queue.
 *
 * GET  — the sheets this user may see: their own, those they approve, or all
 *        of them for HR.
 * POST — open a period by hand. The daily generator does this automatically;
 *        this covers a new joiner mid-period and a re-open after a mistake.
 */

const LIST_INCLUDE = {
  employee: {
    select: {
      id: true,
      employeeId: true,
      jobTitle: true,
      costCentre: true,
      department: { select: { id: true, name: true } },
      user: { select: { id: true, firstName: true, lastName: true, name: true, email: true } },
    },
  },
  approver: {
    select: { id: true, employeeId: true, user: { select: { firstName: true, lastName: true, name: true } } },
  },
  _count: { select: { entries: true } },
} as const;

/** The viewer's own employee row, or null for an account with no staff record. */
async function viewerEmployee(userId: string) {
  return db.employee.findFirst({
    where: { userId },
    select: { id: true, timesheetRequired: true, timesheetFrequency: true, standardWorkingHours: true },
  });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;

  const me = await viewerEmployee(userId);
  const admin = isTimesheetAdmin(role);

  // An account with no employee record and no HR role has no timesheets and
  // approves none. Returning an empty list beats a 403: the tab is visible to
  // everyone and an error there reads as a fault rather than "nothing for you".
  if (!admin && !me) {
    return NextResponse.json({ timesheets: [], canReviewAny: false, isAdmin: false, mine: null });
  }

  const status = req.nextUrl.searchParams.get("status");
  const employeeId = req.nextUrl.searchParams.get("employeeId");

  const scope = admin
    ? {}
    : {
        OR: [
          { employeeId: me!.id },
          { approverId: me!.id },
          // Sheets not yet stamped with an approver still need to reach whoever
          // is configured to review them, or they are invisible until someone
          // opens them.
          { employee: { timesheetApproverId: me!.id } },
          { employee: { managerId: me!.id, timesheetApproverId: null } },
        ],
      };

  const where: Record<string, unknown> = { AND: [scope] };
  if (status) where.status = status;
  if (employeeId && admin) where.employeeId = employeeId;

  const timesheets = await db.timesheet.findMany({
    where,
    include: LIST_INCLUDE,
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    take: 300,
  });

  return NextResponse.json({
    timesheets,
    isAdmin: admin,
    canReviewAny: admin || timesheets.some((t) => t.employeeId !== me?.id),
    mine: me ? { employeeId: me.id, timesheetRequired: me.timesheetRequired } : null,
  });
}

// ─── POST: open a period ─────────────────────────────────────────────────────

const createSchema = z.object({
  employeeId: z.string().min(1).optional(),
  /** Any date inside the wanted period; the period itself is derived. */
  on: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed" },
      { status: 422 }
    );
  }

  const admin = isTimesheetAdmin(role);
  const me = await viewerEmployee(userId);

  // Only HR may open a period for somebody else. Anyone else gets their own.
  const targetId = parsed.data.employeeId && admin ? parsed.data.employeeId : me?.id;
  if (!targetId) {
    return NextResponse.json(
      { error: "You have no employee record, so there is no timesheet to open." },
      { status: 403 }
    );
  }

  const employee = await db.employee.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      employeeId: true,
      isActive: true,
      timesheetRequired: true,
      timesheetFrequency: true,
      standardWorkingHours: true,
    },
  });
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  if (!employee.isActive) {
    return NextResponse.json({ error: "That employee record is closed." }, { status: 409 });
  }
  if (!employee.timesheetRequired) {
    // Refused rather than quietly enabled: the spec makes "who has to submit"
    // a deliberate per-employee decision, and opening a sheet for someone
    // exempt would start reminding and chasing them.
    return NextResponse.json(
      {
        error:
          "Timesheets are not enabled for this employee. Switch on Timesheet Required on their profile first.",
      },
      { status: 409 }
    );
  }
  if (!employee.timesheetFrequency) {
    return NextResponse.json(
      { error: "Set a timesheet frequency on this employee's profile first." },
      { status: 409 }
    );
  }

  const { periodStart, periodEnd } = periodFor(employee.timesheetFrequency, parsed.data.on ?? new Date());

  const existing = await db.timesheet.findUnique({
    where: { employeeId_periodStart: { employeeId: employee.id, periodStart } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "A timesheet already exists for that period.", timesheetId: existing.id },
      { status: 409 }
    );
  }

  const expectedHours = expectedHoursFor(employee.standardWorkingHours, periodStart, periodEnd);
  const approvedLeaveHours = await approvedLeaveHoursFor(
    employee.id,
    periodStart,
    periodEnd,
    employee.standardWorkingHours
  );

  const sheet = await db.timesheet.create({
    data: {
      employeeId: employee.id,
      frequency: employee.timesheetFrequency,
      periodStart,
      periodEnd,
      expectedHours,
      approvedLeaveHours,
      totalAccountedHours: approvedLeaveHours,
      variance: round2(approvedLeaveHours - expectedHours),
      approverId: await resolveApprover(employee.id),
    },
    include: LIST_INCLUDE,
  });

  await recordEvent({
    timesheetId: sheet.id,
    action: "PERIOD_OPENED",
    toStatus: "DRAFT",
    actorId: userId,
    snapshot: { expectedHours, approvedLeaveHours },
  });
  void logActivity(userId, "CREATE", "Timesheet", sheet.id, {
    employeeId: employee.employeeId,
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
  });

  return NextResponse.json({ timesheet: sheet }, { status: 201 });
}
