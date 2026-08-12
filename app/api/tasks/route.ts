import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { stripNullBytes } from "@/lib/sanitize-text";
import { requiresParent, validateTaskParent } from "@/lib/task-workflow";

const blankToUndefined = (v: unknown) =>
  v === "" || v === null || v === "none" ? undefined : v;

const createSchema = z.object({
  title: z.string().min(1),
  description: z.preprocess(blankToUndefined, z.string().optional()),
  assigneeId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
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

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "tasks", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const status = req.nextUrl.searchParams.get("status");
    const category = req.nextUrl.searchParams.get("category");
    const assigneeId = req.nextUrl.searchParams.get("assigneeId");
    const parentType = req.nextUrl.searchParams.get("parentType");
    const parentId = req.nextUrl.searchParams.get("parentId");
    const scope = req.nextUrl.searchParams.get("scope") ?? "mine";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (category) where.category = category;
    if (parentType) where.parentType = parentType;
    if (parentId) where.parentId = parentId;
    if (scope === "mine") {
      const employee = await db.employee.findFirst({ where: { userId }, select: { id: true } });
      if (!employee) return NextResponse.json({ data: [] });
      where.assigneeId = employee.id;
    } else {
      // Any scope other than "mine" used to drop the assignee filter entirely, so
      // every tasks:read holder — EMPLOYEE included — could list all 200 most
      // recent tasks in the organisation just by asking for ?scope=all.
      //
      // Seeing the whole organisation now requires tasks:approve. That is a
      // matrix action rather than a hardcoded role list, so it can be granted
      // per role in Settings → Security without a deploy; by default only
      // SUPER_ADMIN holds it.
      //
      // Everyone else gets their own tasks plus the ones they raised for other
      // people, which is wider than scope=mine (assigned-only) and preserves
      // visibility of work they delegated.
      const canSeeAll = await effectiveHasPermission(role as Role, "tasks", "approve");
      if (canSeeAll) {
        if (assigneeId) where.assigneeId = assigneeId;
      } else {
        const employee = await db.employee.findFirst({ where: { userId }, select: { id: true } });
        if (!employee) return NextResponse.json({ data: [] });
        if (assigneeId && assigneeId !== employee.id) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        where.OR = [{ assigneeId: employee.id }, { createdById: employee.id }];
      }
    }

    const tasks = await db.task.findMany({
      where,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { priority: "desc" }],
      take: 200,
      include: {
        assignee: { select: { id: true, jobTitle: true, user: { select: { id: true, name: true, email: true, image: true } } } },
        createdBy: { select: { id: true, jobTitle: true, user: { select: { id: true, name: true } } } },
      },
    });
    return NextResponse.json({ data: tasks });
  } catch (err) {
    console.error("[GET /api/tasks]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "tasks", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }
    const data = stripNullBytes(parsed.data);

    // Spec §1: parent-link is required unless PERSONAL.
    if (requiresParent(data.category)) {
      const parentError = await validateTaskParent(data.parentType, data.parentId);
      if (parentError) return NextResponse.json({ error: parentError }, { status: 422 });
    }

    // Resolve the current user's Employee row for createdById
    const creator = await db.employee.findFirst({ where: { userId }, select: { id: true } });
    if (!creator) {
      return NextResponse.json({ error: "No Employee profile for the signed-in user" }, { status: 409 });
    }

    const assigneeId = data.assigneeId ?? creator.id;
    const task = await db.task.create({
      data: {
        title: data.title,
        description: data.description,
        assigneeId,
        createdById: creator.id,
        priority: data.priority,
        status: "NOT_STARTED",
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        reminderDate: data.reminderDate ? new Date(data.reminderDate) : undefined,
        escalationDate: data.escalationDate ? new Date(data.escalationDate) : undefined,
        category: data.category,
        recurrence: data.recurrence,
        parentType: data.parentType,
        parentId: data.parentId,
        estimatedMinutes: data.estimatedMinutes,
      },
    });

    // Spec Tasks §11 — notify the assignee when a task is created for someone
    // other than the creator. Silent failure keeps the create response 201.
    if (assigneeId !== creator.id) {
      try {
        const assigneeUser = await db.employee.findUnique({
          where: { id: assigneeId },
          select: { userId: true },
        });
        if (assigneeUser?.userId) {
          await db.notification.create({
            data: {
              userId: assigneeUser.userId,
              title: "New task assigned",
              message: task.title,
              type: "TASK_ASSIGNED",
              link: `/tasks?taskId=${task.id}`,
            },
          });
        }
      } catch {
        /* non-fatal */
      }
    }

    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    console.error("[POST /api/tasks]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
