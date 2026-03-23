import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  assigneeId: z.string().min(1).optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z.string().transform((v) => new Date(v)).optional().nullable(),
});

// ─── GET /api/hr/tasks ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const assigneeId = searchParams.get("assigneeId");
  const isHR = HR_ROLES.includes(session.user.role as Role);

  const where: Record<string, unknown> = { deletedAt: null };

  if (!isHR) {
    // Employees see only their assigned tasks
    const employee = await db.employee.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!employee) return NextResponse.json({ tasks: [] });
    where.assigneeId = employee.id;
  } else if (assigneeId) {
    where.assigneeId = assigneeId;
  }

  if (status) where.status = status;

  const tasks = await db.task.findMany({
    where,
    include: {
      assignee: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
      createdBy: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ tasks });
}

// ─── POST /api/hr/tasks ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const employee = await db.employee.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  if (!employee) {
    return NextResponse.json({ error: "Employee record not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const data = parsed.data;

  const task = await db.task.create({
    data: {
      title: data.title,
      description: data.description,
      assigneeId: data.assigneeId ?? null,
      createdById: employee.id,
      priority: data.priority,
      status: "TODO",
      dueDate: data.dueDate ?? null,
    },
    include: {
      assignee: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
