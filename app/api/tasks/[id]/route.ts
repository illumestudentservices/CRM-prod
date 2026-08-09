import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

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
    const { role } = session.user;
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
    if (parsed.data.status === "COMPLETED" || parsed.data.status === "DONE") {
      patch.completedAt = new Date();
    }

    const updated = await db.task.update({ where: { id }, data: patch });
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
    await db.task.update({ where: { id }, data: { deletedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/tasks/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
