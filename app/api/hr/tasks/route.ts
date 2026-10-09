import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requiresParent, validateTaskParent } from "@/lib/task-workflow";
import { logActivity } from "@/lib/activity-logger";
import { visibleTaskWhere } from "@/lib/task-visibility";
import { refuseAssignment } from "@/lib/task-assignment";
import { notifyTaskAssigned } from "@/lib/task-notify";

// HR_ROLES was removed on 2026-10-09. Being in HR is not a relationship to
// a task, and it was the only thing standing between an HR account and every
// task in the company. Visibility is decided by lib/task-visibility.ts alone.

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
  // Visibility.
  //
  // Two things changed here on 2026-10-09. HR_ROLES used to see every task in
  // the company from this endpoint — the widest read in the task system, and
  // the one the Tasks screen itself calls. And everyone else saw only what was
  // ASSIGNED to them, so a manager could not see the work they had handed out
  // the moment after handing it out.
  //
  // Both answers now come from one rule: your own tasks, plus the ones you
  // allocated. See lib/task-visibility.ts.
  const employee = await db.employee.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!employee) return NextResponse.json({ tasks: [] });

  const where: Record<string, unknown> = {
    deletedAt: null,
    ...visibleTaskWhere(employee.id),
  };

  // As above: filtering by assignee may only narrow what you can already see.
  if (assigneeId) {
    where.assigneeId = assigneeId;
    if (assigneeId !== employee.id) {
      delete where.OR;
      where.createdById = employee.id;
    }
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

  // Same two rules as /api/tasks, and the same default: unassigned becomes
  // self-assigned rather than ownerless.
  const assigneeId = data.assigneeId ?? employee.id;
  const refusal = await refuseAssignment(employee.id, assigneeId);
  if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });

  const task = await db.task.create({
    data: {
      title: data.title,
      description: data.description,
      assigneeId,
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
  void logActivity(session.user.id, "CREATE", "Task", task.id, { route: "hr/tasks" });

  // This endpoint told nobody anything until 2026-10-09 — and it is the one the
  // Tasks screen posts to, so in practice no task raised through the UI ever
  // notified the person it was given to.
  await notifyTaskAssigned({
    taskId: task.id,
    actorUserId: session.user.id,
    reason: "created",
  });

  return NextResponse.json({ task }, { status: 201 });
}
