import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  actorFor,
  entriesEditable,
  recalculateTimesheet,
  recordEvent,
  WORK_CATEGORIES,
} from "@/lib/timesheets";

/**
 * Timesheet lines.
 *
 * Every entity reference is a real foreign key chosen from a CRM lookup, not a
 * typed name or identifier — the spec requires it, and a free-text client name
 * cannot be reported on.
 */

const entrySchema = z.object({
  date: z.string().min(1),
  workCategory: z.enum(WORK_CATEGORIES as unknown as [string, ...string[]]),
  description: z.string().min(1, "Say what the time was spent on").max(2000),
  hours: z.number().positive("Hours must be greater than zero").max(24, "A single line cannot exceed 24 hours"),
  notes: z.string().max(2000).optional().nullable(),
  institutionId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  parentType: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
});

/** Resolves the sheet and checks the caller may edit its lines. */
async function editableSheet(id: string, role: string, userId: string) {
  const sheet = await db.timesheet.findUnique({
    where: { id },
    select: {
      id: true, status: true, employeeId: true, approverId: true, periodStart: true, periodEnd: true,
      employee: { select: { timesheetApproverId: true, managerId: true } },
    },
  });
  if (!sheet) return { error: NextResponse.json({ error: "Timesheet not found" }, { status: 404 }) };

  const me = await db.employee.findFirst({ where: { userId }, select: { id: true } });
  const actor = actorFor(role, me?.id ?? null, sheet);
  if (!actor) return { error: NextResponse.json({ error: "Timesheet not found" }, { status: 404 }) };

  // An approver may read a sheet but never write its lines: the hours are the
  // employee's statement about their own time, and a reviewer editing them
  // silently would destroy that.
  if (actor !== "OWNER" && actor !== "HR") {
    return { error: NextResponse.json({ error: "Only the employee can change their own entries." }, { status: 403 }) };
  }
  if (!entriesEditable(sheet.status)) {
    return {
      error: NextResponse.json(
        { error: "This timesheet is not open for changes. It must be a draft or returned for amendment." },
        { status: 409 }
      ),
    };
  }
  return { sheet, actor };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;
  const { id } = await params;

  const gate = await editableSheet(id, role, userId);
  if (gate.error) return gate.error;
  const sheet = gate.sheet!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = entrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const d = parsed.data;

  // The line must fall inside its own period. Without this, hours drift into
  // periods that have already been approved and the approved totals stop
  // matching the entries behind them.
  const date = new Date(`${d.date.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "That date is not valid." }, { status: 422 });
  }
  if (date < sheet.periodStart || date > sheet.periodEnd) {
    return NextResponse.json(
      {
        error: `That date is outside this timesheet's period (${sheet.periodStart
          .toISOString()
          .slice(0, 10)} to ${sheet.periodEnd.toISOString().slice(0, 10)}).`,
      },
      { status: 422 }
    );
  }

  // Lookups are validated to exist rather than trusted, so a stale or
  // hand-crafted id cannot attach time to a client that is not there.
  if (d.institutionId) {
    const inst = await db.institution.findFirst({
      where: { id: d.institutionId, deletedAt: null },
      select: { id: true },
    });
    if (!inst) return NextResponse.json({ error: "That client was not found." }, { status: 422 });
  }
  if (d.departmentId) {
    const dept = await db.department.findUnique({ where: { id: d.departmentId }, select: { id: true } });
    if (!dept) return NextResponse.json({ error: "That cost centre was not found." }, { status: 422 });
  }

  const entry = await db.timesheetEntry.create({
    data: {
      timesheetId: sheet.id,
      date,
      workCategory: d.workCategory as never,
      description: d.description.trim(),
      hours: d.hours,
      notes: d.notes?.trim() || null,
      institutionId: d.institutionId || null,
      departmentId: d.departmentId || null,
      parentType: (d.parentType as never) || null,
      parentId: d.parentId || null,
    },
    include: {
      institution: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  });

  const totals = await recalculateTimesheet(sheet.id);
  await recordEvent({
    timesheetId: sheet.id,
    action: "ENTRY_ADDED",
    actorId: userId,
    notes: `${d.hours}h — ${d.description.trim().slice(0, 120)}`,
    snapshot: totals ?? undefined,
  });

  return NextResponse.json({ entry, totals }, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;
  const { id } = await params;

  const sheet = await db.timesheet.findUnique({
    where: { id },
    select: {
      employeeId: true, approverId: true,
      employee: { select: { timesheetApproverId: true, managerId: true } },
    },
  });
  if (!sheet) return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });

  const me = await db.employee.findFirst({ where: { userId }, select: { id: true } });
  if (!actorFor(role, me?.id ?? null, sheet)) {
    return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });
  }

  const entries = await db.timesheetEntry.findMany({
    where: { timesheetId: id },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: {
      institution: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ entries });
}
