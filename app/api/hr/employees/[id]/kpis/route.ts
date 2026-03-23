import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isHR = session.user.role === "HR_MANAGER" || session.user.role === "SUPER_ADMIN";
  if (!isHR) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { title, description, target, current, unit, period, dueDate } = body;

  if (!title || !target || !period) {
    return NextResponse.json({ error: "title, target, and period are required" }, { status: 400 });
  }

  const kpi = await db.kPITarget.create({
    data: {
      employeeId: id,
      title,
      description: description || null,
      target,
      current: current || null,
      unit: unit || null,
      period,
      dueDate: dueDate ? new Date(dueDate) : null,
    },
  });

  return NextResponse.json({ kpi }, { status: 201 });
}
