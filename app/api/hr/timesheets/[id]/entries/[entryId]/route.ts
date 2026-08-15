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

/** Editing and removing a single timesheet line. */

const patchSchema = z.object({
  date: z.string().optional(),
  workCategory: z.enum(WORK_CATEGORIES as unknown as [string, ...string[]]).optional(),
  description: z.string().min(1).max(2000).optional(),
  hours: z.number().positive().max(24).optional(),
  notes: z.string().max(2000).optional().nullable(),
  institutionId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  parentType: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
});

/**
 * Loads the line, its sheet, and confirms the caller may change it.
 *
 * The entry is looked up scoped to the timesheet in the path, so a valid entry
 * id from somebody else's sheet cannot be edited by pairing it with a sheet the
 * caller does own.
 */
async function loadEditable(id: string, entryId: string, role: string, userId: string) {
  const entry = await db.timesheetEntry.findFirst({
    where: { id: entryId, timesheetId: id },
    include: {
      timesheet: {
        select: {
          id: true, status: true, employeeId: true, approverId: true,
          periodStart: true, periodEnd: true,
          employee: { select: { timesheetApproverId: true, managerId: true } },
        },
      },
    },
  });
  if (!entry) return { error: NextResponse.json({ error: "Entry not found" }, { status: 404 }) };

  const me = await db.employee.findFirst({ where: { userId }, select: { id: true } });
  const actor = actorFor(role, me?.id ?? null, entry.timesheet);
  if (!actor) return { error: NextResponse.json({ error: "Entry not found" }, { status: 404 }) };
  if (actor !== "OWNER" && actor !== "HR") {
    return { error: NextResponse.json({ error: "Only the employee can change their own entries." }, { status: 403 }) };
  }
  if (!entriesEditable(entry.timesheet.status)) {
    return {
      error: NextResponse.json(
        { error: "This timesheet is not open for changes." },
        { status: 409 }
      ),
    };
  }
  return { entry };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;
  const { id, entryId } = await params;

  const gate = await loadEditable(id, entryId, role, userId);
  if (gate.error) return gate.error;
  const entry = gate.entry!;

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
  const d = parsed.data;
  const data: Record<string, unknown> = {};

  if (d.date !== undefined) {
    const date = new Date(`${d.date.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: "That date is not valid." }, { status: 422 });
    }
    if (date < entry.timesheet.periodStart || date > entry.timesheet.periodEnd) {
      return NextResponse.json(
        { error: "That date is outside this timesheet's period." },
        { status: 422 }
      );
    }
    data.date = date;
  }
  if (d.workCategory !== undefined) data.workCategory = d.workCategory;
  if (d.description !== undefined) data.description = d.description.trim();
  if (d.hours !== undefined) data.hours = d.hours;
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;
  if (d.parentType !== undefined) data.parentType = d.parentType || null;
  if (d.parentId !== undefined) data.parentId = d.parentId || null;

  if (d.institutionId !== undefined) {
    if (d.institutionId) {
      const inst = await db.institution.findFirst({
        where: { id: d.institutionId, deletedAt: null },
        select: { id: true },
      });
      if (!inst) return NextResponse.json({ error: "That client was not found." }, { status: 422 });
    }
    data.institutionId = d.institutionId || null;
  }
  if (d.departmentId !== undefined) {
    if (d.departmentId) {
      const dept = await db.department.findUnique({
        where: { id: d.departmentId },
        select: { id: true },
      });
      if (!dept) return NextResponse.json({ error: "That cost centre was not found." }, { status: 422 });
    }
    data.departmentId = d.departmentId || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 422 });
  }

  const updated = await db.timesheetEntry.update({
    where: { id: entryId },
    data,
    include: {
      institution: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  });

  const totals = await recalculateTimesheet(entry.timesheet.id);
  await recordEvent({
    timesheetId: entry.timesheet.id,
    action: "ENTRY_EDITED",
    actorId: userId,
    notes: `${entry.hours}h → ${updated.hours}h — ${updated.description.slice(0, 100)}`,
    snapshot: totals ?? undefined,
  });

  return NextResponse.json({ entry: updated, totals });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;
  const { id, entryId } = await params;

  const gate = await loadEditable(id, entryId, role, userId);
  if (gate.error) return gate.error;
  const entry = gate.entry!;

  await db.timesheetEntry.delete({ where: { id: entryId } });

  const totals = await recalculateTimesheet(entry.timesheet.id);
  await recordEvent({
    timesheetId: entry.timesheet.id,
    action: "ENTRY_REMOVED",
    actorId: userId,
    notes: `${entry.hours}h — ${entry.description.slice(0, 120)}`,
    snapshot: totals ?? undefined,
  });

  return NextResponse.json({ deleted: true, totals });
}
