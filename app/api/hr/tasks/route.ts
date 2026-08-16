import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { requiresParent, validateTaskParent } from "@/lib/task-workflow";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  assigneeId: z.string().min(1).optional().nullable(),
  sourceActivityId: z.string().min(1).optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z.string().transform((v) => new Date(v)).optional().nullable(),
  // ─── Workflow fields (added 2026-08-15) ─────────────────────────────────
  //
  // There are two task endpoints. /api/tasks is the workflow engine — category,
  // polymorphic parent, recurrence, reminders, estimates — and this one, which
  // the Tasks screen actually posts to, accepted none of them. Every task
  // raised through the UI therefore had no category and no parent link, so the
  // spec §1 rule ("a task that is not personal or internal must be attached to
  // a record") was never applied to the only path staff use.
  //
  // Rather than rewire the screen onto the other endpoint — a much larger
  // change — this accepts the same fields and reuses the engine's own
  // requiresParent/validateTaskParent, so one set of rules governs both.
  category: z
    .enum([
      "STUDENT_FOLLOW_UP", "CLIENT_FOLLOW_UP", "RECRUITMENT_PARTNER", "SCHOOL_ENGAGEMENT",
      "EVENT_PREPARATION", "EVENT_FOLLOW_UP", "MARKETING", "ADMINISTRATION",
      "REPORTING", "COMPLIANCE", "INTERNAL", "PERSONAL", "OTHER",
    ])
    .optional(),
  parentType: z
    .enum([
      "STUDENT", "INSTITUTION_INTEREST", "INSTITUTION", "RECRUITMENT_PARTNER",
      "RECRUITMENT_EVENT", "MARKETING_CAMPAIGN", "FIELD_OPERATION", "MARKET",
      "MONTHLY_REPORT", "RECRUITMENT_PLAN", "VARIATION_REQUEST", "TRAVEL_RECORD", "CLIENT_ISSUE",
    ])
    .optional()
    .nullable(),
  parentId: z.string().min(1).optional().nullable(),
  reminderDate: z.string().optional().nullable(),
  estimatedMinutes: z.number().int().positive().optional().nullable(),
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
  const sourceActivityId = searchParams.get("sourceActivityId");
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
  if (sourceActivityId) where.sourceActivityId = sourceActivityId;

  const tasks = await db.task.findMany({
    where,
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

  // Spec §1, enforced with the SAME helpers as /api/tasks so the two endpoints
  // cannot disagree about when a parent is required. Defaults to PERSONAL when
  // the caller sends nothing, which needs no parent — the previous behaviour
  // for an unspecified category, preserved so existing callers do not break.
  const category = data.category ?? "PERSONAL";
  if (requiresParent(category)) {
    const parentError = await validateTaskParent(data.parentType, data.parentId);
    if (parentError) return NextResponse.json({ error: parentError }, { status: 422 });
  }

  const task = await db.task.create({
    data: {
      title: data.title,
      description: data.description,
      assigneeId: data.assigneeId ?? null,
      sourceActivityId: data.sourceActivityId ?? null,
      createdById: employee.id,
      priority: data.priority,
      status: "TODO",
      dueDate: data.dueDate ?? null,
      category,
      parentType: data.parentType ?? null,
      parentId: data.parentId ?? null,
      reminderDate: data.reminderDate ? new Date(data.reminderDate) : null,
      estimatedMinutes: data.estimatedMinutes ?? null,
    },
    include: {
      assignee: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
