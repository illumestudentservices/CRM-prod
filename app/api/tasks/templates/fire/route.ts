import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { fireTaskTemplate, fireEventTriggers } from "@/lib/task-workflow";

const schema = z.object({
  templateId: z.string().optional(),
  triggerEvent: z.string().optional(),
  assigneeId: z.string().optional(),
  parentType: z.string().optional(),
  parentId: z.string().optional(),
  baseDate: z.string().datetime().optional(),
}).refine(d => d.templateId || d.triggerEvent, { message: "templateId or triggerEvent is required" });

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
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    const employee = await db.employee.findFirst({ where: { userId }, select: { id: true } });
    if (!employee) return NextResponse.json({ error: "No Employee profile" }, { status: 409 });

    const opts = {
      createdById: employee.id,
      assigneeId: parsed.data.assigneeId ?? employee.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parentType: parsed.data.parentType as any,
      parentId: parsed.data.parentId,
      baseDate: parsed.data.baseDate ? new Date(parsed.data.baseDate) : undefined,
    };

    let result;
    if (parsed.data.templateId) {
      result = await fireTaskTemplate(parsed.data.templateId, opts);
    } else {
      result = await fireEventTriggers(parsed.data.triggerEvent!, opts);
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[POST /api/tasks/templates/fire]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
