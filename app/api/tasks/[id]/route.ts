import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { trashRecord } from "@/lib/recycle-bin";

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(["TODO", "NOT_STARTED", "IN_PROGRESS", "WAITING_ON_EXTERNAL_PARTY", "DONE", "COMPLETED", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assigneeId: z.string().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  reminderDate: z.string().datetime().optional().nullable(),
  escalationDate: z.string().datetime().optional().nullable(),
  actualMinutes: z.number().int().nonnegative().optional().nullable(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "tasks", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    // Load prior state so lifecycle stamps only fire on real transitions
    // (setting status = "IN_PROGRESS" twice should not overwrite the original
    // startedAt).
    const existing = await db.task.findUnique({
      where: { id },
      select: { status: true, startedAt: true, assigneeId: true },
    });
    if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) {
        if (k === "dueDate" || k === "reminderDate" || k === "escalationDate") {
          patch[k] = v ? new Date(v as string) : null;
        } else {
          patch[k] = v;
        }
      }
    }

    // Spec Tasks §7 — lifecycle timestamps.
    const now = new Date();
    const wasStarted = existing.status === "IN_PROGRESS";
    const willStart = parsed.data.status === "IN_PROGRESS";
    // Stamp `startedAt` the FIRST time the task transitions into IN_PROGRESS
    // (so restarting a WAITING_ON_EXTERNAL_PARTY row doesn't lose the original
    // start).
    if (willStart && !existing.startedAt) {
      patch.startedAt = now;
    }
    // A silent side-effect of "task moved from NOT_STARTED to DONE" (skipped
    // IN_PROGRESS) should still stamp startedAt so cycle-time analytics work.
    if (!wasStarted && !existing.startedAt && parsed.data.status === "DONE") {
      patch.startedAt = now;
    }
    if (parsed.data.status === "COMPLETED" || parsed.data.status === "DONE") {
      patch.completedAt = now;
    }
    if (parsed.data.status === "CANCELLED" || parsed.data.status === "DONE" || parsed.data.status === "COMPLETED") {
      // Resolve the current user's Employee row to attribute the close. Task
      // records employees, not users, so the join is required.
      const closer = await db.employee.findFirst({
        where: { userId },
        select: { id: true },
      });
      if (closer) patch.closedById = closer.id;
    }

    // Reassignment notification. Fires when assigneeId changes to another
    // person (not when it goes null or when the closing user is the assignee).
    const newAssigneeId = parsed.data.assigneeId ?? undefined;
    const reassigningTo =
      newAssigneeId && newAssigneeId !== existing.assigneeId ? newAssigneeId : null;

    const updated = await db.task.update({ where: { id }, data: patch });

    // Spec Tasks §D — recurring materialisation. When a WEEKLY / MONTHLY /
    // QUARTERLY / ANNUAL task is completed or done, spawn the next
    // occurrence so the schedule keeps rolling.
    if (
      (parsed.data.status === "COMPLETED" || parsed.data.status === "DONE") &&
      existing.status !== "COMPLETED" &&
      existing.status !== "DONE"
    ) {
      try {
        const { materialiseNextRecurrence } = await import("@/lib/task-recurrence");
        await materialiseNextRecurrence(id);
      } catch (err) {
        console.error("[PATCH tasks] recurrence materialisation failed", err);
      }
    }

    if (reassigningTo) {
      try {
        const target = await db.employee.findUnique({
          where: { id: reassigningTo },
          select: { userId: true },
        });
        if (target?.userId && target.userId !== userId) {
          await db.notification.create({
            data: {
              userId: target.userId,
              title: "Task reassigned to you",
              message: updated.title,
              type: "TASK_ASSIGNED",
              link: `/tasks?taskId=${updated.id}`,
            },
          });
        }
      } catch {
        /* non-fatal */
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[PATCH /api/tasks/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "tasks", "delete"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    await trashRecord({ entityType: "Task", entityId: id, userId: session.user.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/tasks/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
