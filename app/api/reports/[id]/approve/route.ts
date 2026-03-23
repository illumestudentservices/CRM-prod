import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { sendReportSubmittedEmail, sendReportStatusEmail } from "@/lib/email";
// ReportStatus is used as a string union locally
type ReportStatus = "DRAFT" | "PENDING_REVIEW" | "REGIONAL_APPROVED" | "HQ_REVIEW" | "FINAL_APPROVED" | "RETURNED";

const approveSchema = z.object({
  action: z.enum(["SUBMIT", "APPROVE", "RETURN", "FINAL_APPROVE"]),
  comment: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    const { id } = await params;

    const report = await db.monthlyReport.findFirst({
      where: { id, deletedAt: null },
      include: {
        icr: { select: { id: true, name: true, email: true } },
        institution: { select: { name: true } },
      },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = approveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }

    const { action, comment } = parsed.data;

    // ── Validate state transitions ─────────────────────────────────────────
    let newStatus: ReportStatus | null = null;
    let approvalAction: "SUBMITTED" | "APPROVED" | "RETURNED" | "ESCALATED" = "SUBMITTED";
    let notifyUserId: string | null = null;
    let notificationTitle = "";
    let notificationMessage = "";

    if (action === "SUBMIT") {
      const canSubmit = (role === "ICR" || role === "SUPER_ADMIN") && report.icrId === userId;
      if (!canSubmit) {
        return NextResponse.json({ error: "Only the report owner can submit" }, { status: 403 });
      }
      if (report.status !== "DRAFT" && report.status !== "RETURNED") {
        return NextResponse.json({ error: "Report must be in DRAFT or RETURNED status to submit" }, { status: 400 });
      }
      newStatus = "PENDING_REVIEW";
      approvalAction = "SUBMITTED";

      // Notify regional manager
      const rm = await db.user.findFirst({
        where: { role: "REGIONAL_MANAGER", regionId: report.regionId ?? undefined, isActive: true },
        select: { id: true },
      });
      if (rm) {
        notifyUserId = rm.id;
        notificationTitle = "New Report Submitted for Review";
        notificationMessage = `${report.icr.name} submitted a monthly report for ${report.institution.name} (${getMonthName(report.reportingMonth)} ${report.reportingYear})`;
      }
    } else if (action === "APPROVE") {
      if (role !== "REGIONAL_MANAGER") {
        return NextResponse.json({ error: "Only Regional Managers can approve at this stage" }, { status: 403 });
      }
      if (report.status !== "PENDING_REVIEW") {
        return NextResponse.json({ error: "Report must be in PENDING_REVIEW status" }, { status: 400 });
      }
      if (regionId !== report.regionId) {
        return NextResponse.json({ error: "You can only approve reports in your region" }, { status: 403 });
      }
      newStatus = "REGIONAL_APPROVED";
      approvalAction = "APPROVED";

      // Notify HQ
      const hqUser = await db.user.findFirst({
        where: { role: { in: ["HQ_EXECUTIVE", "HQ_ANALYTICS"] }, isActive: true },
        select: { id: true },
      });
      if (hqUser) {
        notifyUserId = hqUser.id;
        notificationTitle = "Report Ready for HQ Review";
        notificationMessage = `Report from ${report.icr.name} for ${report.institution.name} has been regionally approved`;
      }
    } else if (action === "RETURN") {
      if (!["REGIONAL_MANAGER", "HQ_EXECUTIVE", "HQ_ANALYTICS", "SUPER_ADMIN"].includes(role)) {
        return NextResponse.json({ error: "Insufficient permissions to return a report" }, { status: 403 });
      }
      if (!["PENDING_REVIEW", "REGIONAL_APPROVED", "HQ_REVIEW"].includes(report.status)) {
        return NextResponse.json({ error: "Report cannot be returned in current status" }, { status: 400 });
      }
      if (!comment) {
        return NextResponse.json({ error: "A comment is required when returning a report" }, { status: 400 });
      }
      newStatus = "RETURNED";
      approvalAction = "RETURNED";

      // Notify ICR
      notifyUserId = report.icrId;
      notificationTitle = "Report Returned for Revision";
      notificationMessage = `Your report for ${report.institution.name} (${getMonthName(report.reportingMonth)} ${report.reportingYear}) has been returned: ${comment}`;
    } else if (action === "FINAL_APPROVE") {
      if (!["HQ_EXECUTIVE", "HQ_ANALYTICS", "SUPER_ADMIN"].includes(role)) {
        return NextResponse.json({ error: "Only HQ can give final approval" }, { status: 403 });
      }
      if (report.status !== "REGIONAL_APPROVED" && report.status !== "HQ_REVIEW") {
        return NextResponse.json({ error: "Report must be regionally approved for final approval" }, { status: 400 });
      }
      newStatus = "FINAL_APPROVED";
      approvalAction = "APPROVED";

      // Notify ICR
      notifyUserId = report.icrId;
      notificationTitle = "Report Finally Approved";
      notificationMessage = `Your report for ${report.institution.name} (${getMonthName(report.reportingMonth)} ${report.reportingYear}) has been finally approved`;
    }

    if (!newStatus) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // ── Perform DB operations ──────────────────────────────────────────────
    const [updatedReport] = await db.$transaction([
      db.monthlyReport.update({
        where: { id },
        data: {
          status: newStatus,
          ...(action === "SUBMIT" ? { submittedAt: new Date() } : {}),
          ...(action === "FINAL_APPROVE" ? { finalApprovedAt: new Date() } : {}),
        },
      }),
      db.reportApproval.create({
        data: {
          reportId: id,
          userId,
          action: approvalAction,
          comment: comment ?? null,
        },
      }),
      ...(notifyUserId
        ? [
            db.notification.create({
              data: {
                userId: notifyUserId,
                title: notificationTitle,
                message: notificationMessage,
                type: "REPORT",
                link: `/reports/${id}`,
              },
            }),
          ]
        : []),
    ]);

    // ── Fire-and-forget emails ─────────────────────────────────────────────
    const period = `${getMonthName(report.reportingMonth)} ${report.reportingYear}`;
    const reportUrl = `${process.env.NEXTAUTH_URL ?? ""}/reports/${id}`;

    if (action === "SUBMIT" && notifyUserId) {
      const rm = await db.user.findUnique({ where: { id: notifyUserId }, select: { name: true, email: true } });
      if (rm?.email) {
        sendReportSubmittedEmail({
          to: rm.email,
          rmName: rm.name ?? "Manager",
          icrName: report.icr.name ?? "",
          institutionName: report.institution.name,
          period,
          reportUrl,
        });
      }
    } else if ((action === "APPROVE" || action === "FINAL_APPROVE" || action === "RETURN") && report.icr.email) {
      const emailAction =
        action === "APPROVE" ? "REGIONAL_APPROVED" :
        action === "FINAL_APPROVE" ? "FINAL_APPROVED" :
        "RETURNED";
      sendReportStatusEmail({
        to: report.icr.email,
        icrName: report.icr.name ?? "",
        institutionName: report.institution.name,
        period,
        action: emailAction,
        comment,
        reportUrl,
      });
    }

    return NextResponse.json(updatedReport);
  } catch (error) {
    console.error("[reports/id/approve] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function getMonthName(month: number): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[month - 1] ?? String(month);
}
