import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

const patchTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  assigneeId: z.string().min(1).optional().nullable(),
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

  const isHR = HR_ROLES.includes(session.user.role as Role);
  const isAssignee = employee && task.assigneeId === employee.id;
  const isCreator = employee && task.createdById === employee.id;

  if (!isHR && !isAssignee && !isCreator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  // Non-HR assignees can only update status
  if (!isHR && !isCreator) {
    const { status } = parsed.data;
    Object.keys(updateData).forEach((k) => {
      if (k !== "status") delete updateData[k];
    });
    if (status) updateData.status = status;
  }

  if (updateData.status === "DONE") {
    updateData.completedAt = new Date();
  }

  const updated = await db.task.update({
    where: { id },
    data: updateData,
    include: {
      assignee: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
    },
  });

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

  const isHR = HR_ROLES.includes(session.user.role as Role);
  const isCreator = employee && task.createdById === employee.id;

  if (!isHR && !isCreator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.task.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
