import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-logger";

/**
 * Live accounts with no Employee record.
 *
 * Only HR → Add Employee creates one, and that endpoint creates a *new* user,
 * refusing an email that already exists. So an account made through
 * Settings → Users had no route to an employee record at all: HR could see the
 * problem and had no way to fix it. POST here closes that.
 *
 * People in this state can sign in and use the CRM, but every HR feature keyed
 * to Employee — leave, attendance, parental-leave eligibility, performance
 * reviews — cannot see them, and the failure is silent: applying for leave just
 * returns "employee not found".
 */
const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

async function requireHR() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!HR_ROLES.includes(session.user.role as Role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const ctx = await requireHR();
  if ("error" in ctx) return ctx.error;

  const users = await db.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      employee: null,
      // Not people, and never will be.
      isServiceAccount: false,
      // Institution clients are external contacts — no employee record expected.
      role: { not: "INSTITUTION_CLIENT" },
    },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ users });
}

// ─── POST: give an existing account an employee record ───────────────────────

const linkSchema = z.object({
  userId: z.string().min(1),
  jobTitle: z.string().min(2, "Job title is required").max(120),
  startDate: z.string().min(1, "Start date is required"),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]).default("FULL_TIME"),
  departmentId: z.string().min(1).optional().nullable(),
  managerId: z.string().min(1).optional().nullable(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const ctx = await requireHR();
  if ("error" in ctx) return ctx.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const d = parsed.data;

  const user = await db.user.findUnique({
    where: { id: d.userId },
    select: { id: true, email: true, name: true, deletedAt: true, isServiceAccount: true, employee: { select: { id: true } } },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (user.deletedAt) {
    return NextResponse.json({ error: "That account is deleted." }, { status: 400 });
  }
  if (user.employee) {
    return NextResponse.json(
      { error: "That account already has an employee record." },
      { status: 409 }
    );
  }
  if (user.isServiceAccount) {
    return NextResponse.json(
      { error: "That is a service account, not a person. It cannot have an employee record." },
      { status: 400 }
    );
  }

  const startDate = new Date(d.startDate);
  if (Number.isNaN(startDate.getTime())) {
    return NextResponse.json({ error: "Invalid start date" }, { status: 422 });
  }

  const employee = await db.$transaction(async (tx) => {
    // Sequence derived inside the transaction, as in the create-employee path,
    // so two concurrent links cannot claim the same number.
    const last = await tx.employee.findFirst({
      orderBy: { createdAt: "desc" },
      select: { employeeId: true },
    });
    const lastNum = last ? parseInt(last.employeeId.replace(/^[A-Z]+-/, ""), 10) || 0 : 0;

    return tx.employee.create({
      data: {
        employeeId: `ILL-${String(lastNum + 1).padStart(4, "0")}`,
        userId: user.id,
        jobTitle: d.jobTitle.trim(),
        departmentId: d.departmentId ?? null,
        employmentType: d.employmentType,
        managerId: d.managerId ?? null,
        // Leave entitlement is derived from this, so a wrong date silently
        // mis-prices every balance. It is required for exactly that reason.
        startDate,
        gender: d.gender ?? null,
        phone: d.phone?.trim() || null,
        isActive: true,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  });

  void logActivity(ctx.session.user.id, "CREATE", "Employee", employee.id, {
    linkedExistingUser: user.email,
    jobTitle: employee.jobTitle,
    startDate: startDate.toISOString().slice(0, 10),
  });

  return NextResponse.json({ employee }, { status: 201 });
}

// ─── PATCH: mark an account as a service account (or back again) ─────────────

const flagSchema = z.object({
  userId: z.string().min(1),
  isServiceAccount: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  const ctx = await requireHR();
  if ("error" in ctx) return ctx.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = flagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 422 });
  }
  const { userId, isServiceAccount } = parsed.data;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, employee: { select: { id: true } } },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (isServiceAccount && user.employee) {
    return NextResponse.json(
      {
        error:
          "That account has an employee record, so it belongs to a person. Remove the employee record first if it is really a service account.",
      },
      { status: 400 }
    );
  }

  await db.user.update({ where: { id: userId }, data: { isServiceAccount } });

  void logActivity(ctx.session.user.id, "UPDATE", "User", userId, {
    isServiceAccount,
    email: user.email,
  });

  return NextResponse.json({ ok: true });
}
