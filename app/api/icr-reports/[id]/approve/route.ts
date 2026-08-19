import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { inRegion } from "@/lib/region-scope";
import { logActivity } from "@/lib/activity-logger";
import type { Role } from "@/lib/permissions";
import { sendIcrReportSubmittedEmail, sendIcrReportStatusEmail } from "@/lib/email";
import type { InstitutionRow } from "@/lib/icr-monthly-report";
import { hasCapability } from "@/lib/granular-permissions";

/**
 * The approval chain, which is the same one the institution report uses: the
 * rep submits, their Regional Manager either approves it or sends it back with
 * a reason. HQ reads but does not gate.
 */
const actionSchema = z.object({
  action: z.enum(["SUBMIT", "APPROVE", "RETURN"]),
  comment: z.string().max(5000).optional(),
});

const MONTHS = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    const { id } = await params;
    const report = await db.icrMonthlyReport.findFirst({
      where: { id, deletedAt: null },
      include: { icr: { select: { id: true, name: true, email: true } } },
    });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const parsed = actionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }
    const { action, comment } = parsed.data;

    let newStatus: "PENDING_REVIEW" | "FINAL_APPROVED" | "RETURNED";
    let approvalAction: "SUBMITTED" | "APPROVED" | "RETURNED";
    let notifyUserId: string | null = null;
    let notifyTitle = "";
    let notifyMessage = "";

    const period = `${MONTHS[report.reportingMonth]} ${report.reportingYear}`;

    if (action === "SUBMIT") {
      if (!((role === "ICR" || role === "SUPER_ADMIN") && report.icrId === userId)) {
        return NextResponse.json({ error: "Only the report owner can submit" }, { status: 403 });
      }
      if (report.status !== "DRAFT" && report.status !== "RETURNED") {
        return NextResponse.json(
          { error: "Only a draft or returned report can be submitted" },
          { status: 400 }
        );
      }
      // The template's whole purpose is the judgement the CRM cannot supply. A
      // report with every narrative section blank is a data dump, and asking a
      // manager to approve one wastes the review.
      const written = [report.keyHighlights, report.keyChallenges, report.demandTrends,
        report.priorityOne, report.supportRequested].filter((v) => v && v.trim().length > 0);
      if (written.length === 0) {
        return NextResponse.json(
          { error: "Add at least one written section before submitting — the CRM figures alone are not a report" },
          { status: 400 }
        );
      }

      newStatus = "PENDING_REVIEW";
      approvalAction = "SUBMITTED";

      const rm = await db.user.findFirst({
        where: { role: "REGIONAL_MANAGER", regionId: report.regionId ?? undefined, isActive: true },
        select: { id: true },
      });
      if (rm) {
        notifyUserId = rm.id;
        notifyTitle = "Monthly report submitted for review";
        notifyMessage = `${report.icr.name ?? "An ICR"} submitted their monthly report for ${period}`;
      }
    } else if (action === "APPROVE") {
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
        return NextResponse.json({ error: "Report is not awaiting approval" }, { status: 400 });
      }
      // inRegion(), not `!==`. Both columns are nullable and `null !== null` is
      // false, so a manager with no region matched a report with no region and
      // could approve it. A manager with no region belongs to no region — see
      // lib/region-scope.ts.
      if (role === "REGIONAL_MANAGER" && !inRegion(report, regionId)) {
        return NextResponse.json({ error: "You can only approve reports in your region" }, { status: 403 });
      }
      newStatus = "FINAL_APPROVED";
      approvalAction = "APPROVED";
      notifyUserId = report.icrId;
      notifyTitle = "Monthly report approved";
      notifyMessage = `Your monthly report for ${period} has been approved`;
    } else {
      if (role !== "REGIONAL_MANAGER" && role !== "SUPER_ADMIN") {
        return NextResponse.json({ error: "Only Regional Managers can return a report" }, { status: 403 });
      }
      if (report.status !== "PENDING_REVIEW") {
        return NextResponse.json({ error: "Only a report awaiting approval can be returned" }, { status: 400 });
      }
      // inRegion(), not `!==`. Both columns are nullable and `null !== null` is
      // false, so a manager with no region matched a report with no region and
      // could approve it. A manager with no region belongs to no region — see
      // lib/region-scope.ts.
      if (role === "REGIONAL_MANAGER" && !inRegion(report, regionId)) {
        return NextResponse.json({ error: "You can only return reports in your region" }, { status: 403 });
      }
      // Returning without saying why sends the rep back to a blank wall.
      if (!comment?.trim()) {
        return NextResponse.json({ error: "A comment is required when returning a report" }, { status: 400 });
      }
      newStatus = "RETURNED";
      approvalAction = "RETURNED";
      notifyUserId = report.icrId;
      notifyTitle = "Monthly report returned for revision";
      notifyMessage = `Your monthly report for ${period} was returned: ${comment}`;
    }

    const [updated] = await db.$transaction([
      db.icrMonthlyReport.update({
        where: { id },
        data: {
          status: newStatus,
          ...(action === "SUBMIT" ? { submittedAt: new Date() } : {}),
          ...(action === "APPROVE" ? { finalApprovedAt: new Date() } : {}),
        },
      }),
      db.icrReportApproval.create({
        data: { reportId: id, userId, action: approvalAction, comment: comment ?? null },
      }),
      ...(notifyUserId
        ? [
            db.notification.create({
              data: {
                userId: notifyUserId,
                title: notifyTitle,
                message: notifyMessage,
                type: "REPORT",
                link: `/reports/icr-monthly/${id}`,
              },
            }),
          ]
        : []),
    ]);

    // ── Email, fire and forget ─────────────────────────────────────────────
    const reportUrl = `${process.env.NEXTAUTH_URL ?? ""}/reports/icr-monthly/${id}`;
    if (action === "SUBMIT" && notifyUserId) {
      const rm = await db.user.findUnique({
        where: { id: notifyUserId },
        select: { name: true, email: true },
      });
      if (rm?.email) {
        const institutions = (report.institutionBreakdown ?? []) as unknown as InstitutionRow[];
        void sendIcrReportSubmittedEmail({
          to: rm.email,
          rmName: rm.name ?? "Manager",
          icrName: report.icr.name ?? "An ICR",
          period,
          institutionCount: Array.isArray(institutions) ? institutions.length : 0,
          reportUrl,
        });
      }
    } else if (report.icr.email) {
      void sendIcrReportStatusEmail({
        to: report.icr.email,
        icrName: report.icr.name ?? "",
        period,
        action: action === "APPROVE" ? "APPROVED" : "RETURNED",
        comment,
        reportUrl,
      });
    }

    void logActivity(userId, `ICR_REPORT_${action}`, "IcrMonthlyReport", id, {
      from: report.status,
      to: updated.status,
      ...(comment ? { comment } : {}),
    }, req);

    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (error) {
    console.error("[icr-reports/id/approve] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
