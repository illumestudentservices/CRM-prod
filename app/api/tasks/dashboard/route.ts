import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { TaskStatus } from "@prisma/client";

/// Spec §9 — Personal task dashboard. Returns Due Today / Overdue / This Week /
/// Waiting on External / Completed This Week for the signed-in user.
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "tasks", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const employee = await db.employee.findFirst({ where: { userId }, select: { id: true } });
    if (!employee) return NextResponse.json({ dueToday: 0, overdue: 0, dueThisWeek: 0, waitingExternal: 0, completedThisWeek: 0, byCategory: {} });

    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(now); endOfWeek.setDate(endOfWeek.getDate() + 7); endOfWeek.setHours(23, 59, 59, 999);
    const startOfWeek = new Date(now); startOfWeek.setDate(startOfWeek.getDate() - 7); startOfWeek.setHours(0, 0, 0, 0);

    const openStatuses: TaskStatus[] = ["NOT_STARTED", "TODO", "IN_PROGRESS"];
    const doneStatuses: TaskStatus[] = ["COMPLETED", "DONE"];

    const [dueToday, overdue, dueThisWeek, waitingExternal, completedThisWeek, byCategoryRows] = await Promise.all([
      db.task.count({ where: { assigneeId: employee.id, deletedAt: null, status: { in: openStatuses }, dueDate: { gte: startOfDay, lte: endOfDay } } }),
      db.task.count({ where: { assigneeId: employee.id, deletedAt: null, status: { in: openStatuses }, dueDate: { lt: startOfDay } } }),
      db.task.count({ where: { assigneeId: employee.id, deletedAt: null, status: { in: openStatuses }, dueDate: { gte: startOfDay, lte: endOfWeek } } }),
      db.task.count({ where: { assigneeId: employee.id, deletedAt: null, status: "WAITING_ON_EXTERNAL_PARTY" } }),
      db.task.count({ where: { assigneeId: employee.id, deletedAt: null, status: { in: doneStatuses }, completedAt: { gte: startOfWeek } } }),
      db.task.groupBy({
        by: ["category"],
        where: { assigneeId: employee.id, deletedAt: null, status: { in: openStatuses } },
        _count: true,
      }),
    ]);

    const byCategory = byCategoryRows.reduce<Record<string, number>>((acc, r) => {
      acc[r.category] = typeof r._count === "number" ? r._count : 0;
      return acc;
    }, {});

    return NextResponse.json({ dueToday, overdue, dueThisWeek, waitingExternal, completedThisWeek, byCategory });
  } catch (err) {
    console.error("[GET /api/tasks/dashboard]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
