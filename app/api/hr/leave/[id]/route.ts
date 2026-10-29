import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { sendLeaveDecisionEmail } from "@/lib/email";
import { logActivity } from "@/lib/activity-logger";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

const patchLeaveSchema = z.object({
  action: z.enum(["APPROVED", "REJECTED", "CANCELLED"]),
  rejectionNote: z.string().optional(),
});

// ─── PATCH /api/hr/leave/[id] ─────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const leaveRequest = await db.leaveRequest.findUnique({
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

  if (!leaveRequest) {
    return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
  }

  const isHR = HR_ROLES.includes(session.user.role as Role);
  const isManager =
    leaveRequest.employee.manager?.user?.id === session.user.id;
  const isSelf = leaveRequest.employee.userId === session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchLeaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { action, rejectionNote } = parsed.data;

  // Permission checks
  if (action === "CANCELLED") {
    // Withdrawing a PENDING request: the employee themselves, or HR (the
    // self-service Withdraw button). Withdrawing an already-APPROVED request:
    // HR or the employee's manager only — NOT the employee, since an approval
    // should not be undone silently by the person who benefits from it.
    if (leaveRequest.status === "APPROVED") {
      if (!isHR && !isManager) {
        return NextResponse.json({ error: "Forbidden — only the employee's manager or an administrator can withdraw an approved leave." }, { status: 403 });
      }
    } else if (!isSelf && !isHR) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    if (!isHR && !isManager) {
      return NextResponse.json({ error: "Forbidden — a leave request can only be decided by the employee's manager or an administrator" }, { status: 403 });
    }
  }

  // Approve/Reject only act on a PENDING request. CANCELLED may also act on an
  // APPROVED one (a withdrawal). Anything already CANCELLED/REJECTED is final.
  const cancellable = leaveRequest.status === "PENDING" || leaveRequest.status === "APPROVED";
  if (action === "CANCELLED" ? !cancellable : leaveRequest.status !== "PENDING") {
    return NextResponse.json(
      { error: `Leave request is already ${leaveRequest.status}` },
      { status: 422 }
    );
  }

  // UTC, because that is what POST /api/hr/leave used when it created the row.
  // getFullYear() reads the server's local calendar: for leave starting 1
  // January, a server behind UTC resolves the previous year, the balance lookup
  // below misses, and the approval fails with a 500 on a request that is
  // perfectly valid. The VPS runs UTC so the two agreed by luck, not design.
  const year = leaveRequest.startDate.getUTCFullYear();

  await db.$transaction(async (tx) => {
    // Update leave request status
    await tx.leaveRequest.update({
      where: { id },
      data: {
        status: action,
        approvedById: action !== "CANCELLED" ? session.user.id : undefined,
        approvedAt: action !== "CANCELLED" ? new Date() : undefined,
        rejectionNote: action === "REJECTED" ? rejectionNote : undefined,
      },
    });

    // Update leave balance. Every remaining type tracks one — the unpaid type
    // this used to exempt no longer exists.
    {
      const balanceWhere = {
        employeeId_leaveType_year: {
          employeeId: leaveRequest.employeeId,
          leaveType: leaveRequest.leaveType,
          year,
        },
      };

      if (action === "APPROVED") {
        await tx.leaveBalance.update({
          where: balanceWhere,
          data: {
            usedDays: { increment: leaveRequest.days },
            pendingDays: { decrement: leaveRequest.days },
          },
        });
      } else if (action === "CANCELLED" && leaveRequest.status === "APPROVED") {
        // Withdrawing an APPROVED leave: the days were already moved into USED
        // on approval, so give them back from used (not pending).
        await tx.leaveBalance.update({
          where: balanceWhere,
          data: {
            usedDays: { decrement: leaveRequest.days },
          },
        });
      } else {
        // REJECTED, or a PENDING request withdrawn — reverse the pending hold.
        await tx.leaveBalance.update({
          where: balanceWhere,
          data: {
            pendingDays: { decrement: leaveRequest.days },
          },
        });
      }
    }

    void logActivity(session.user.id, "LEAVE_DECISION", "LeaveRequest", id, {
      route: "hr/leave/[id]",
      decision: action,
      employeeId: leaveRequest.employeeId,
      ...(rejectionNote ? { rejectionNote } : {}),
    });

    // Send notification to employee
    await tx.notification.create({
      data: {
        userId: leaveRequest.employee.userId,
        title: `Leave Request ${action}`,
        message:
          action === "APPROVED"
            ? `Your ${leaveRequest.leaveType.toLowerCase()} leave request from ${leaveRequest.startDate.toDateString()} to ${leaveRequest.endDate.toDateString()} has been approved.`
            : action === "REJECTED"
            ? `Your leave request has been rejected.${rejectionNote ? ` Reason: ${rejectionNote}` : ""}`
            : `Your leave request has been cancelled.`,
        type: "LEAVE",
        link: `/hr/employees/${leaveRequest.employeeId}`,
      },
    });
  });

  // Fire-and-forget email to employee
  if ((action === "APPROVED" || action === "REJECTED") && leaveRequest.employee.user.email) {
    sendLeaveDecisionEmail({
      to: leaveRequest.employee.user.email,
      employeeName: leaveRequest.employee.user.name ?? "Employee",
      leaveType: leaveRequest.leaveType,
      startDate: leaveRequest.startDate.toDateString(),
      endDate: leaveRequest.endDate.toDateString(),
      days: leaveRequest.days,
      action,
      note: action === "REJECTED" ? rejectionNote : undefined,
      leaveUrl: `${process.env.NEXTAUTH_URL ?? ""}/hr/employees/${leaveRequest.employeeId}`,
    });
  }

  const updated = await db.leaveRequest.findUnique({
    where: { id },
    include: {
      employee: { include: { user: { select: { name: true } } } },
    },
  });

  return NextResponse.json({ request: updated });
}
