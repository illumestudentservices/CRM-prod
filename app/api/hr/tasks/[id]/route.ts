import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { trashRecord } from "@/lib/recycle-bin";
import { logActivity } from "@/lib/activity-logger";
import { refuseAssignment } from "@/lib/task-assignment";
import { notifyTaskAssigned } from "@/lib/task-notify";

// HR_ROLES was removed on 2026-10-09. Being in HR is not a relationship to
// a task, and it was the only thing standing between an HR account and every
// task in the company. Visibility is decided by lib/task-visibility.ts alone.

const patchTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  assigneeId: z.string().min(1).optional().nullable(),
  sourceActivityId: z.string().min(1).optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
  dueDate: z.string().transform((v) => new Date(v)).optional().nullable(),
});

// ─── PATCH /api/hr/tasks/[id] ─────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const task = await db.task.findFirst({ where: { id, deletedAt: null } });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const employee = await db.employee.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  // The HR bypass that used to sit here is gone: being in HR_ROLES is not a
  // relationship to a task. Only the two people on it may touch it.
  const isAssignee = !!employee && task.assigneeId === employee.id;
  const isCreator = !!employee && task.createdById === employee.id;

  if (!isAssignee && !isCreator) {
    // 404, not 403 — a caller who cannot see the task must not learn it exists.
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const updateData: Record<string, unknown> = { ...parsed.data };

  // An assignee reports progress; the person who allocated it owns the rest.
  if (!isCreator) {
    const { status } = parsed.data;
    Object.keys(updateData).forEach((k) => {
      if (k !== "status") delete updateData[k];
    });
    if (status) updateData.status = status;
  }

  if (updateData.status === "DONE") {
    updateData.completedAt = new Date();
  }

  // Reassignment is subject to the same rule as creation; see
  // lib/task-assignment.ts. `employee` is null only for a user with no HR
  // record, who cannot reach this branch — the field is stripped above for
  // anyone who is neither HR nor the creator.
  if (typeof updateData.assigneeId === "string" && updateData.assigneeId !== task.assigneeId) {
    if (!employee) {
      return NextResponse.json({ error: "No Employee profile for the signed-in user" }, { status: 409 });
    }
    const refusal = await refuseAssignment(employee.id, updateData.assigneeId);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
  }

  const updated = await db.task.update({
    where: { id },
    data: updateData,
    include: {
      assignee: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
      createdBy: {
        include: { user: { select: { id: true, name: true } } },
      },
      sourceActivity: {
        select: { id: true, title: true, type: true },
      },
    },
  });
  void logActivity(session.user.id, "UPDATE", "Task", updated.id, { route: "hr/tasks/[id]" });

  // Handing a task to somebody else is the one update they cannot discover on
  // their own. Compared against the row read before the update, so a PATCH that
  // merely repeats the current assignee does not re-announce it.
  if (updated.assigneeId && updated.assigneeId !== task.assigneeId) {
    await notifyTaskAssigned({
      taskId: updated.id,
      actorUserId: session.user.id,
      reason: "reassigned",
    });
  }

  return NextResponse.json({ task: updated });
}

// ─── DELETE /api/hr/tasks/[id] (soft delete) ──────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const task = await db.task.findFirst({ where: { id, deletedAt: null } });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const employee = await db.employee.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  const isCreator = !!employee && task.createdById === employee.id;
  const isAssignee = !!employee && task.assigneeId === employee.id;

  if (!isCreator) {
    // An assignee can see the task but not destroy it; anyone else is told
    // nothing about whether it exists.
    return isAssignee
      ? NextResponse.json(
          { error: "Only the person who raised this task can delete it." },
          { status: 403 }
        )
      : NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  await trashRecord({ entityType: "HRTask", entityId: id, userId: session.user.id });

  return NextResponse.json({ success: true });
}
