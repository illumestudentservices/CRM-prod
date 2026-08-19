import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { regionScope } from "@/lib/region-scope";
import { PageHeader } from "@/components/shared/page-header";
import { NoRegionBanner } from "@/components/shared/no-region-banner";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, BarChart3 } from "lucide-react";
import { ReportQueueClient } from "./_components/report-queue-client";
import { ReportsTabs } from "./_components/reports-tabs";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { canViewWeeklyActivities } from "@/lib/weekly-activities";
import type { Role } from "@/lib/permissions";

const REPORT_EXPORT_COLUMNS = [
  { key: "icr",         header: "ICR" },
  { key: "institution", header: "Institution" },
  { key: "period",      header: "Period" },
  { key: "status",      header: "Status" },
  { key: "submittedAt", header: "Submitted At" },
  { key: "approvedAt",  header: "Approved At" },
];

async function getSummary(role: Role, userId: string, regionId: string | null) {
  const scopeFilter =
    role === "ICR" ? { icrId: userId }
    // No region means no reports, not every report. See lib/region-scope.ts.
    : role === "REGIONAL_MANAGER" ? regionScope(regionId)
    : {};

  const base = { ...scopeFilter, deletedAt: null };
  const [draft, pendingReview, regionalApproved, hqReview, finalApproved, returned] = await Promise.all([
    db.monthlyReport.count({ where: { ...base, status: "DRAFT" } }),
    db.monthlyReport.count({ where: { ...base, status: "PENDING_REVIEW" } }),
    db.monthlyReport.count({ where: { ...base, status: "REGIONAL_APPROVED" } }),
    db.monthlyReport.count({ where: { ...base, status: "HQ_REVIEW" } }),
    db.monthlyReport.count({ where: { ...base, status: "FINAL_APPROVED" } }),
    db.monthlyReport.count({ where: { ...base, status: "RETURNED" } }),
  ]);
  return { draft, pendingReview, regionalApproved, hqReview, finalApproved, returned };
}

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { role, id: userId, regionId } = session.user as {
    role: Role;
    id: string;
    regionId: string | null;
  };

  const isICR = role === "ICR";
  const isRM = role === "REGIONAL_MANAGER";
  const isHQ = ["HQ_EXECUTIVE", "HQ_ANALYTICS", "SUPER_ADMIN"].includes(role);

  const [summary, canCreate] = await Promise.all([
    getSummary(role, userId, regionId),
    effectiveHasPermission(role, "reports", "write"),
  ]);

  const showWeeklyTab = canViewWeeklyActivities(role);

  const pageTitle = isICR ? "My Reports" : isRM ? "Regional Reports" : "All Reports";
  const pageDescription = isICR
    ? "Generate, review and send your monthly reports"
    : isRM
    ? "Review and approve your team's monthly reports"
    : "View all monthly reports across regions";

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
      <NoRegionBanner role={role} regionId={regionId} />
      <PageHeader
        title={pageTitle}
        description={pageDescription}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports" }]}
        actions={
          // When the weekly tab is shown, the action moves into ReportsTabs so it
          // only appears on the Monthly Reports tab.
          showWeeklyTab ? undefined : (
            <div className="flex items-center gap-2">
              {isHQ && (
                <Button variant="outline" asChild>
                  <Link href="/reports/qbr">
                    <BarChart3 className="h-4 w-4 mr-2" />
                    QBR
                  </Link>
                </Button>
              )}
              {canCreate && (
                <Button asChild className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white">
                  <Link href="/reports/new">
                    <Plus className="h-4 w-4 mr-2" />
                    New Report
                  </Link>
                </Button>
              )}
            </div>
          )
        }
      />

      {showWeeklyTab ? (
        <ReportsTabs
          userRole={role}
          isHQ={isHQ}
          isRM={isRM}
          isICR={isICR}
          isSuperAdmin={role === "SUPER_ADMIN"}
          canCreate={canCreate}
          summary={summary}
        />
      ) : (
        <ReportQueueClient
          userRole={role}
          isHQ={isHQ}
          isRM={isRM}
          isICR={isICR}
          isSuperAdmin={role === "SUPER_ADMIN"}
          summary={summary}
        />
      )}
    </div>
  );
}
