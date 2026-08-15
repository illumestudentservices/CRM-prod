import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma, TimesheetStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";
import { displayNameOr } from "@/lib/person-name";
import {
  actorFor,
  availableTransitions,
  canTransition,
  entriesEditable,
  isTimesheetAdmin,
  recalculateTimesheet,
  recordEvent,
  resolveApprover,
  STATUS_LABELS,
} from "@/lib/timesheets";

const DETAIL_INCLUDE = {
  employee: {
    select: {
      id: true,
      employeeId: true,
      jobTitle: true,
      costCentre: true,
      managerId: true,
      timesheetApproverId: true,
      standardWorkingHours: true,
      department: { select: { id: true, name: true } },
      user: { select: { id: true, firstName: true, lastName: true, name: true, email: true } },
    },
  },
  approver: {
    select: { id: true, user: { select: { firstName: true, lastName: true, name: true, email: true } } },
  },
  entries: {
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: {
      institution: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  },
  events: { orderBy: { createdAt: "desc" }, take: 100 },
  // No `as const`: it makes the nested orderBy arrays readonly, which Prisma's
  // generated input types reject. Same trap as the workload-reassignment where
  // clause.
} satisfies Prisma.TimesheetInclude;

/** Loads the sheet and works out how the caller relates to it. 404s if not theirs. */
async function loadScoped(id: string, role: string, userId: string) {
  const sheet = await db.timesheet.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  if (!sheet) return { sheet: null, actor: null } as const;

  const me = await db.employee.findFirst({ where: { userId }, select: { id: true } });
  const actor = actorFor(role, me?.id ?? null, {
    employeeId: sheet.employeeId,
    approverId: sheet.approverId,
    employee: {
      timesheetApproverId: sheet.employee.timesheetApproverId,
      managerId: sheet.employee.managerId,
    },
  });
  return { sheet, actor, myEmployeeId: me?.id ?? null } as const;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;
  const { id } = await params;

  const { sheet, actor } = await loadScoped(id, role, userId);
  // 404 rather than 403 for someone else's sheet — a 403 confirms it exists,
  // and time records are payroll-adjacent.
  if (!sheet || !actor) return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });

  return NextResponse.json({
    timesheet: sheet,
    actor,
    transitions: availableTransitions(sheet.status, actor),
    entriesEditable: entriesEditable(sheet.status) && (actor === "OWNER" || actor === "HR"),
  });
}

// ─── PATCH: move it through the workflow ─────────────────────────────────────

const patchSchema = z.object({
  toStatus: z.enum(["DRAFT", "SUBMITTED", "MANAGER_REVIEW", "AMENDMENTS_REQUIRED", "APPROVED"]),
  notes: z.string().max(2000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed" },
      { status: 422 }
    );
  }
  const { toStatus, notes } = parsed.data;

  const { sheet, actor } = await loadScoped(id, role, userId);
  if (!sheet || !actor) return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });

  const check = canTransition(sheet.status, toStatus as TimesheetStatus, actor);
  if (!check.ok) {
    // 409 for "the sheet is not in a state where that makes sense", 403 for
    // "you are not allowed" — the caller needs to tell those apart.
    const status = check.reason?.includes("role") ? 403 : 409;
    return NextResponse.json({ error: check.reason ?? "Not allowed" }, { status });
  }
  if (check.requiresNotes && (!notes || notes.trim().length < 5)) {
    return NextResponse.json(
      { error: "Say what needs changing — the employee has to know what to fix." },
      { status: 422 }
    );
  }

  // Recalculate before approving rather than trusting the stored figures: leave
  // may have been approved since the sheet was submitted, which changes the
  // variance the approver is signing off.
  await recalculateTimesheet(sheet.id);

  const now = new Date();
  const data: Record<string, unknown> = { status: toStatus };
  if (toStatus === "SUBMITTED") {
    data.submittedAt = now;
    // Stamp the approver at submission so the sheet reaches a named person even
    // if the employee's configuration changes afterwards.
    if (!sheet.approverId) data.approverId = await resolveApprover(sheet.employeeId);
  }
  if (toStatus === "APPROVED") {
    data.approvedAt = now;
    const me = await db.employee.findFirst({ where: { userId }, select: { id: true } });
    if (me) data.approverId = me.id;
  }
  if (toStatus === "AMENDMENTS_REQUIRED") data.reviewNotes = notes?.trim() ?? null;
  if (toStatus === "DRAFT") {
    data.submittedAt = null;
    data.reviewNotes = null;
  }

  // Compare-and-swap on the status the caller believed it was in: two reviewers
  // acting at once would otherwise both "decide" it and the second would
  // silently overwrite the first.
  const swap = await db.timesheet.updateMany({
    where: { id: sheet.id, status: sheet.status },
    data,
  });
  if (swap.count === 0) {
    return NextResponse.json(
      { error: "This timesheet has already moved on. Reload to see its current state." },
      { status: 409 }
    );
  }

  const fresh = await db.timesheet.findUniqueOrThrow({ where: { id: sheet.id }, include: DETAIL_INCLUDE });

  await recordEvent({
    timesheetId: sheet.id,
    action: toStatus,
    fromStatus: sheet.status,
    toStatus: toStatus as TimesheetStatus,
    actorId: userId,
    notes: notes?.trim() || null,
    snapshot: {
      expectedHours: fresh.expectedHours,
      loggedHours: fresh.loggedHours,
      approvedLeaveHours: fresh.approvedLeaveHours,
      variance: fresh.variance,
    },
  });

  // Tell the other side. A timesheet returned for amendment that nobody is told
  // about simply sits there until the deadline passes.
  const employeeName = displayNameOr(sheet.employee.user, sheet.employee.user.email);
  const period = `${sheet.periodStart.toISOString().slice(0, 10)} to ${sheet.periodEnd.toISOString().slice(0, 10)}`;

  if (toStatus === "AMENDMENTS_REQUIRED" && sheet.employee.user.id) {
    await db.notification.create({
      data: {
        userId: sheet.employee.user.id,
        title: "Timesheet needs amendments",
        message: `Your timesheet for ${period} was returned. ${notes?.trim() ?? ""}`.trim(),
        type: "TIMESHEET",
        link: "/hr?tab=timesheets",
      },
    });
  }
  if (toStatus === "APPROVED" && sheet.employee.user.id) {
    await db.notification.create({
      data: {
        userId: sheet.employee.user.id,
        title: "Timesheet approved",
        message: `Your timesheet for ${period} was approved.`,
        type: "TIMESHEET",
        link: "/hr?tab=timesheets",
      },
    });
  }
  if (toStatus === "SUBMITTED" && fresh.approverId) {
    const approver = await db.employee.findUnique({
      where: { id: fresh.approverId },
      select: { userId: true },
    });
    if (approver?.userId) {
      await db.notification.create({
        data: {
          userId: approver.userId,
          title: "Timesheet awaiting your review",
          message: `${employeeName} submitted their timesheet for ${period}.`,
          type: "TIMESHEET",
          link: "/hr?tab=timesheets",
        },
      });
    }
  }

  void logActivity(userId, toStatus, "Timesheet", sheet.id, {
    from: sheet.status,
    to: toStatus,
    employeeId: sheet.employee.employeeId,
    period,
    ...(notes ? { notes: notes.trim() } : {}),
  });

  return NextResponse.json({
    timesheet: fresh,
    message: `Timesheet moved to ${STATUS_LABELS[toStatus]}.`,
  });
}

// ─── DELETE: remove an unsubmitted period ────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;
  const { id } = await params;

  const { sheet, actor } = await loadScoped(id, role, userId);
  if (!sheet || !actor) return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });

  // Only HR, and only while nothing has been claimed about it. An approved or
  // in-review sheet is a record of a decision and must not vanish.
  if (!isTimesheetAdmin(role)) {
    return NextResponse.json({ error: "Only HR can delete a timesheet." }, { status: 403 });
  }
  if (sheet.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Only a draft timesheet can be deleted. Return it for amendment instead." },
      { status: 409 }
    );
  }

  await db.timesheet.delete({ where: { id: sheet.id } });
  void logActivity(userId, "DELETE", "Timesheet", sheet.id, {
    employeeId: sheet.employee.employeeId,
    periodStart: sheet.periodStart.toISOString().slice(0, 10),
  });
  return NextResponse.json({ deleted: true });
}
