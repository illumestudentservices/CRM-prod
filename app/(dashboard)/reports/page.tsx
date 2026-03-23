import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ReportQueueClient } from "./_components/report-queue-client";
import { effectiveHasPermission } from "@/lib/effective-permissions";
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
    : role === "REGIONAL_MANAGER" ? (regionId ? { regionId } : {})
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

  const pageTitle = isICR ? "My Reports" : isRM ? "Regional Reports" : "HQ Report Queue";
  const pageDescription = isICR
    ? "Create and manage your monthly activity reports"
    : isRM
    ? "Review and approve ICR monthly reports for your region"
    : "Final review and approval of regionally approved reports";

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
      <PageHeader
        title={pageTitle}
        description={pageDescription}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports" }]}
        actions={
          <div className="flex items-center gap-2">
            {canCreate && (
              <Button asChild className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white">
                <Link href="/reports/new">
                  <Plus className="h-4 w-4 mr-2" />
                  New Report
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <ReportQueueClient
        userRole={role}
        isHQ={isHQ}
        isRM={isRM}
        isICR={isICR}
        isSuperAdmin={role === "SUPER_ADMIN"}
        summary={summary}
      />
    </div>
  );
}
