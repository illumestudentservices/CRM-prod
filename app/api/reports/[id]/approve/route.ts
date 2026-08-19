import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { inRegion } from "@/lib/region-scope";
import { logActivity } from "@/lib/activity-logger";
import type { Role } from "@/lib/permissions";
import { sendReportSubmittedEmail, sendReportStatusEmail } from "@/lib/email";
import { hasCapability } from "@/lib/granular-permissions";
// ReportStatus is used as a string union locally
type ReportStatus = "DRAFT" | "PENDING_REVIEW" | "REGIONAL_APPROVED" | "HQ_REVIEW" | "FINAL_APPROVED" | "RETURNED";

const approveSchema = z.object({
  // Simplified flow: ICR SUBMIT → Regional Manager APPROVE (final) or RETURN.
  // (HQ is no longer part of the approval chain — view-only.)
  action: z.enum(["SUBMIT", "APPROVE", "RETURN"]),
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
      // Regional Manager (or Super Admin) gives the single, final approval.
      // reports.approve_final was declared in the capability registry and read
      // by nothing, so the Security screen offered a switch that changed
      // nothing. Its default is the pair this replaces, so nobody gains or
      // loses the approval today — it is now simply withdrawable.
      if (!(await hasCapability(role as Role, "reports.approve_final"))) {
        return NextResponse.json(
          { error: "Your role is not permitted to give final report approval" },
          { status: 403 }
        );
      }
      if (report.status !== "PENDING_REVIEW") {
        return NextResponse.json({ error: "Report must be awaiting approval" }, { status: 400 });
      }
      // inRegion(), not `!==`. Both columns are nullable and `null !== null` is
      // false, so a manager with no region matched a report with no region and
      // could approve it. A manager with no region belongs to no region — see
      // lib/region-scope.ts.
      if (role === "REGIONAL_MANAGER" && !inRegion(report, regionId)) {
        return NextResponse.json({ error: "You can only approve reports in your region" }, { status: 403 });
      }
      // Single-step approval is final now that HQ is out of the chain.
      newStatus = "FINAL_APPROVED";
      approvalAction = "APPROVED";

      // Notify ICR
      notifyUserId = report.icrId;
      notificationTitle = "Report Approved";
      notificationMessage = `Your report for ${report.institution.name} (${getMonthName(report.reportingMonth)} ${report.reportingYear}) has been approved`;
    } else if (action === "RETURN") {
      if (role !== "REGIONAL_MANAGER" && role !== "SUPER_ADMIN") {
        return NextResponse.json({ error: "Only Regional Managers can return a report" }, { status: 403 });
      }
      if (report.status !== "PENDING_REVIEW") {
        return NextResponse.json({ error: "Only reports awaiting approval can be returned" }, { status: 400 });
      }
      // inRegion(), not `!==`. Both columns are nullable and `null !== null` is
      // false, so a manager with no region matched a report with no region and
      // could approve it. A manager with no region belongs to no region — see
      // lib/region-scope.ts.
      if (role === "REGIONAL_MANAGER" && !inRegion(report, regionId)) {
        return NextResponse.json({ error: "You can only return reports in your region" }, { status: 403 });
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
          ...(action === "APPROVE" ? { finalApprovedAt: new Date() } : {}),
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
    } else if ((action === "APPROVE" || action === "RETURN") && report.icr.email) {
      const emailAction = action === "APPROVE" ? "FINAL_APPROVED" : "RETURNED";
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

    // Approval is what releases a report to a partner, and returning one sends it
    // back to the ICR. Neither was recorded anywhere.
    void logActivity(userId, `REPORT_${action}`, "MonthlyReport", id, {
      from: report.status,
      to: updatedReport.status,
      ...(comment ? { comment } : {}),
    }, req);

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
