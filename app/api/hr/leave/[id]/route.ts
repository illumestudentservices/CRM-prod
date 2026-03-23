import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { sendLeaveDecisionEmail } from "@/lib/email";

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
    if (!isSelf && !isHR) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    if (!isHR && !isManager) {
      return NextResponse.json({ error: "Forbidden — only HR managers or direct manager can approve/reject" }, { status: 403 });
    }
  }

  if (leaveRequest.status !== "PENDING") {
    return NextResponse.json(
      { error: `Leave request is already ${leaveRequest.status}` },
      { status: 422 }
    );
  }

  const year = leaveRequest.startDate.getFullYear();

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

    // Update leave balance
    if (leaveRequest.leaveType !== "UNPAID") {
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
      } else {
        // REJECTED or CANCELLED — reverse pending
        await tx.leaveBalance.update({
          where: balanceWhere,
          data: {
            pendingDays: { decrement: leaveRequest.days },
          },
        });
      }
    }

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
