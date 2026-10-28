import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSeeTask } from "@/lib/task-visibility";
import { notifyTaskComment } from "@/lib/task-notify";

/**
 * The notes thread on a task — a back-and-forth between the assignee and the
 * creator. Access is the task's own rule (lib/task-visibility.ts): only the two
 * people on the task may read or post, and a caller with no claim gets 404 so
 * the task's existence is not disclosed.
 */

const bodySchema = z.object({
  body: z.string().trim().min(1, "A note cannot be empty").max(5000),
});

// ─── GET /api/tasks/[id]/comments ────────────────────────────────────────────

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await canSeeTask(session.user.id, id))) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const comments = await db.taskComment.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true, image: true } },
    },
  });

  return NextResponse.json({ comments });
}

// ─── POST /api/tasks/[id]/comments ───────────────────────────────────────────

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await canSeeTask(session.user.id, id))) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
  }

  const comment = await db.taskComment.create({
    data: { taskId: id, authorId: session.user.id, body: parsed.data.body },
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true, image: true } },
    },
  });

  // Tell the other person on the task (manager ↔ assignee). Fire-and-forget —
  // never let a notification failure cost a note that is already saved.
  void notifyTaskComment({ taskId: id, authorUserId: session.user.id, body: parsed.data.body });

  return NextResponse.json({ comment }, { status: 201 });
}
