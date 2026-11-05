import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-logger";
import { sendInLieuDecisionEmail } from "@/lib/email";

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });

/**
 * Decide an in-lieu earn request. On APPROVED the day-equivalent is credited to
 * the employee's IN_LIEU leave balance for the request's year — stored in
 * LeaveBalance.adjustmentDays, which is exactly what computeEntitlement adds for
 * the GRANT_ONLY accrual mode. They then book the time off as an ordinary
 * IN_LIEU leave request. Rejecting credits nothing.
 */

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

const patchSchema = z.object({
  action: z.enum(["APPROVED", "REJECTED", "CANCELLED"]),
  rejectionNote: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const request = await db.inLieuRequest.findUnique({
    where: { id },
    include: {
      employee: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          manager: { include: { user: { select: { id: true } } } },
        },
      },
    },
  });
  if (!request) return NextResponse.json({ error: "In-lieu request not found" }, { status: 404 });

  const isHR = HR_ROLES.includes(session.user.role as Role);
  const isManager = request.employee.manager?.user?.id === session.user.id;
  const isSelf = request.employee.userId === session.user.id;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
  }
  const { action, rejectionNote } = parsed.data;

  // Who may do what:
  //  - CANCELLED (withdraw): the employee themselves while PENDING, or HR/manager.
  //  - APPROVED/REJECTED: the employee's manager or HR only.
  if (action === "CANCELLED") {
    if (request.status === "APPROVED") {
      if (!isHR && !isManager) {
        return NextResponse.json({ error: "Forbidden — only the manager or an administrator can withdraw an approved in-lieu credit." }, { status: 403 });
      }
    } else if (!isSelf && !isHR && !isManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (!isHR && !isManager) {
    return NextResponse.json({ error: "Forbidden — an in-lieu request can only be decided by the employee's manager or an administrator." }, { status: 403 });
  }

  const cancellable = request.status === "PENDING" || request.status === "APPROVED";
  if (action === "CANCELLED" ? !cancellable : request.status !== "PENDING") {
    return NextResponse.json({ error: `In-lieu request is already ${request.status}` }, { status: 422 });
  }

  const { year, days, employeeId } = request;
  const balanceWhere = {
    employeeId_leaveType_year: { employeeId, leaveType: "IN_LIEU" as const, year },
  };

  await db.$transaction(async (tx) => {
    await tx.inLieuRequest.update({
      where: { id },
      data: {
        status: action,
        approvedById: action !== "CANCELLED" ? session.user.id : undefined,
        approvedAt: action !== "CANCELLED" ? new Date() : undefined,
        rejectionNote: action === "REJECTED" ? rejectionNote : undefined,
      },
    });

    if (action === "APPROVED") {
      // Credit the balance. The row is created on first use — entitlement is
      // otherwise derived, so there is nothing to seed.
      await tx.leaveBalance.upsert({
        where: balanceWhere,
        create: {
          employeeId,
          leaveType: "IN_LIEU",
          year,
          totalDays: 0,
          adjustmentDays: days,
          usedDays: 0,
          pendingDays: 0,
        },
        update: { adjustmentDays: { increment: days } },
      });
    } else if (action === "CANCELLED" && request.status === "APPROVED") {
      // Withdrawing an already-approved credit: take the days back out.
      await tx.leaveBalance.update({
        where: balanceWhere,
        data: { adjustmentDays: { decrement: days } },
      });
    }
    // REJECTED or a PENDING withdrawal: nothing was credited, nothing to reverse.

    void logActivity(session.user.id, "LEAVE_DECISION", "InLieuRequest", id, {
      route: "hr/leave/in-lieu/[id]",
      decision: action,
      employeeId,
      days,
    });

    await tx.notification.create({
      data: {
        userId: request.employee.userId,
        title: `In-lieu request ${action}`,
        message:
          action === "APPROVED"
            ? `Your in-lieu request for ${days} day${days !== 1 ? "s" : ""} was approved and added to your balance.`
            : action === "REJECTED"
            ? `Your in-lieu request was rejected.${rejectionNote ? ` Reason: ${rejectionNote}` : ""}`
            : `Your in-lieu request was cancelled.`,
        type: "LEAVE",
        link: "/hr?tab=leave",
      },
    });
  });

  // Email the employee on a decision (fire-and-forget).
  if ((action === "APPROVED" || action === "REJECTED") && request.employee.user.email) {
    sendInLieuDecisionEmail({
      to: request.employee.user.email,
      employeeName: request.employee.user.name ?? "Employee",
      hours: request.hours,
      days,
      workDate: request.workDateEnd
        ? `${fmtDate(request.workDate)} – ${fmtDate(request.workDateEnd)}`
        : fmtDate(request.workDate),
      action,
      note: action === "REJECTED" ? rejectionNote : undefined,
      url: `${process.env.NEXTAUTH_URL ?? ""}/hr/employees/${employeeId}?tab=leave`,
    });
  }

  const updated = await db.inLieuRequest.findUnique({ where: { id } });
  return NextResponse.json({ request: updated });
}
