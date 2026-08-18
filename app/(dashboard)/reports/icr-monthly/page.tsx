import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { PageHeader } from "@/components/shared/page-header";
import { IcrReportListClient } from "./_components/icr-report-list-client";

export const metadata = {
  title: "ICR Monthly Reports | Illume Student Advisory Services",
};

/**
 * Scope. Unlike the institution report there is no "everyone sees drafts"
 * shortcut: a draft is a rep thinking out loud, and it belongs to them until
 * they submit it. Managers see their own region; HQ reads everything.
 */
function scopeFilter(role: Role, userId: string, regionId: string | null) {
  switch (role) {
    case "ICR":
      return { icrId: userId };
    case "REGIONAL_MANAGER":
      return { regionId: regionId ?? "__no_region__" };
    case "SUPER_ADMIN":
    case "HQ_EXECUTIVE":
    case "HQ_ANALYTICS":
    case "VP_GLOBAL_SALES":
      return {};
    default:
      return { id: "__no_access__" };
  }
}

export default async function IcrMonthlyReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { role, id: userId, regionId } = session.user as {
    role: Role;
    id: string;
    regionId: string | null;
  };

  if (!(await effectiveHasPermission(role, "reports", "read"))) redirect("/dashboard");

  const where = { ...scopeFilter(role, userId, regionId), deletedAt: null };

  const reports = await db.icrMonthlyReport.findMany({
    where,
    orderBy: [{ reportingYear: "desc" }, { reportingMonth: "desc" }],
    take: 50,
    select: {
      id: true,
      reportingMonth: true,
      reportingYear: true,
      status: true,
      intakesCovered: true,
      submittedAt: true,
      finalApprovedAt: true,
      updatedAt: true,
      icr: { select: { id: true, name: true, email: true } },
      region: { select: { name: true } },
    },
  });

  const canCreate =
    (role === "ICR" || role === "SUPER_ADMIN") &&
    (await effectiveHasPermission(role, "reports", "write"));

  // Which periods the rep has not filed yet. Offering "September" when
  // September is already filed is the fastest way to a duplicate-key error the
  // rep cannot act on.
  const taken = new Set(reports.filter((r) => r.icr.id === userId).map((r) => `${r.reportingYear}-${r.reportingMonth}`));

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="ICR Monthly Reports"
        description="One report per representative per month, pre-filled from the CRM and sent to your Regional Manager for approval."
      />
      <IcrReportListClient
        reports={reports.map((r) => ({
          ...r,
          submittedAt: r.submittedAt?.toISOString() ?? null,
          finalApprovedAt: r.finalApprovedAt?.toISOString() ?? null,
          updatedAt: r.updatedAt.toISOString(),
        }))}
        canCreate={canCreate}
        takenPeriods={[...taken]}
      />
    </div>
  );
}
