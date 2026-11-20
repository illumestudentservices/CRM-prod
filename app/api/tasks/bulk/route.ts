import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { stripNullBytes } from "@/lib/sanitize-text";
import { requiresParent, validateTaskParent } from "@/lib/task-workflow";
import { logActivity } from "@/lib/activity-logger";
import { canBulkAssignTasks } from "@/lib/task-assignment";
import { ACTIVE_EMPLOYEE } from "@/lib/hr-scope";
import { notifyTaskAssigned } from "@/lib/task-notify";
import { rateLimit } from "@/lib/rate-limit";

// One bulk call can fan out to 200 people (a task + an email each). Cap how
// often a single account may do it, so a compromised or misused bulk-assigner
// cannot turn one session into an internal mail / notification flood.
const BULK_MAX_PER_WINDOW = 10;
const BULK_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Assign ONE task to MANY people in one request — a task per person, so each
 * assignee has their own trackable task with its own reminders, escalation and
 * completion. Restricted to HQ Executives, the CEO and Super Admins
 * (canBulkAssignTasks); they may target any active employee, which is why this
 * does NOT go through refuseAssignment's per-report rule.
 */

const blankToUndefined = (v: unknown) => (v === "" || v === null || v === "none" ? undefined : v);

const bulkSchema = z.object({
  title: z.string().min(1),
  description: z.preprocess(blankToUndefined, z.string().optional()),
  assigneeIds: z.array(z.string().min(1)).min(1, "Pick at least one person").max(200),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z.preprocess(blankToUndefined, z.string().datetime().optional()),
  reminderDate: z.preprocess(blankToUndefined, z.string().datetime().optional()),
  escalationDate: z.preprocess(blankToUndefined, z.string().datetime().optional()),
  category: z.enum([
    "STUDENT_FOLLOW_UP", "CLIENT_FOLLOW_UP", "RECRUITMENT_PARTNER", "SCHOOL_ENGAGEMENT",
    "EVENT_PREPARATION", "EVENT_FOLLOW_UP", "MARKETING", "ADMINISTRATION",
    "REPORTING", "COMPLIANCE", "INTERNAL", "PERSONAL", "OTHER",
  ]).default("OTHER"),
  recurrence: z.enum(["ONE_OFF", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"]).default("ONE_OFF"),
  parentType: z.preprocess(blankToUndefined, z.enum([
    "STUDENT", "INSTITUTION_INTEREST", "INSTITUTION", "RECRUITMENT_PARTNER",
    "RECRUITMENT_EVENT", "MARKETING_CAMPAIGN", "FIELD_OPERATION", "MARKET",
    "MONTHLY_REPORT", "RECRUITMENT_PLAN", "VARIATION_REQUEST", "TRAVEL_RECORD", "CLIENT_ISSUE",
  ]).optional()),
  parentId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  estimatedMinutes: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId, email } = session.user;

    // Needs the task write permission AND the (stricter) bulk-assign right.
    if (!(await effectiveHasPermission(role as Role, "tasks", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!canBulkAssignTasks(role as Role, email)) {
      return NextResponse.json({ error: "Only HQ Executives and the CEO can assign to several people at once." }, { status: 403 });
    }

    // Per-user throttle (in-memory sliding window). Counts requests, so a normal
    // few-at-a-time workflow is never hit, but a flood is.
    if (!rateLimit(`tasks-bulk:${userId}`, BULK_MAX_PER_WINDOW, BULK_WINDOW_MS)) {
      return NextResponse.json(
        { error: "You're assigning in bulk too frequently. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = bulkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }
    const data = stripNullBytes(parsed.data);

    if (requiresParent(data.category)) {
      const parentError = await validateTaskParent(data.parentType, data.parentId);
      if (parentError) return NextResponse.json({ error: parentError }, { status: 422 });
    }

    const creator = await db.employee.findFirst({ where: { userId }, select: { id: true } });
    if (!creator) {
      return NextResponse.json({ error: "No Employee profile for the signed-in user" }, { status: 409 });
    }

    // One task per DISTINCT person. Every target must be an active employee —
    // a departed colleague's id or a made-up string is rejected for the whole
    // batch rather than silently skipped.
    const assigneeIds = [...new Set(data.assigneeIds)];
    const found = await db.employee.findMany({
      where: { id: { in: assigneeIds }, ...ACTIVE_EMPLOYEE },
      select: { id: true },
    });
    if (found.length !== assigneeIds.length) {
      return NextResponse.json(
        { error: "One or more selected people are not active employees." },
        { status: 422 }
      );
    }

    const common = {
      title: data.title,
      description: data.description,
      createdById: creator.id,
      priority: data.priority,
      status: "NOT_STARTED" as const,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      reminderDate: data.reminderDate ? new Date(data.reminderDate) : undefined,
      escalationDate: data.escalationDate ? new Date(data.escalationDate) : undefined,
      category: data.category,
      recurrence: data.recurrence,
      parentType: data.parentType,
      parentId: data.parentId,
      estimatedMinutes: data.estimatedMinutes,
    };

    const created = await db.$transaction(
      assigneeIds.map((assigneeId) => db.task.create({ data: { ...common, assigneeId } }))
    );

    void logActivity(session.user.id, "CREATE", "Task", created.map((t) => t.id).join(","), {
      route: "tasks/bulk",
      count: created.length,
    });

    // Tell every assignee, in the app and by email (same notifier as the single
    // path so they cannot drift). Awaited so a serverless freeze can't drop them.
    await Promise.all(
      created.map((t) => notifyTaskAssigned({ taskId: t.id, actorUserId: session.user.id, reason: "created" }))
    );

    return NextResponse.json({ created: created.length, taskIds: created.map((t) => t.id) }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/tasks/bulk]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
