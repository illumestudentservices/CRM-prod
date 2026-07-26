import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { ReportEditor } from "../_components/report-editor";
import type { Role } from "@/lib/permissions";

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Edit Report ${id} | Illume Student Advisory Services` };
}

export default async function EditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

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
      institution: { select: { id: true, name: true, country: true } },
      region: { select: { id: true, name: true } },
      approvals: {
        where: { action: "RETURNED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { comment: true },
      },
    },
  });

  if (!report) notFound();

  // Access control
  if (role === "ICR" && report.icrId !== userId) redirect("/reports");
  if (role === "REGIONAL_MANAGER" && report.regionId !== regionId) redirect("/reports");

  // Can only edit DRAFT or RETURNED
  if (!["DRAFT", "RETURNED"].includes(report.status)) {
    redirect(`/reports/${id}`);
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title={`Edit Report — ${report.institution.name}`}
        description={`${MONTH_NAMES[report.reportingMonth]} ${report.reportingYear} · ${report.status === "RETURNED" ? "Returned for revision" : "Draft"}`}
        breadcrumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Reports", href: "/reports" },
          { label: report.institution.name, href: `/reports/${id}` },
          { label: "Edit" },
        ]}
      />

      <ReportEditor
        report={{
          id: report.id,
          icrId: report.icrId,
          institutionId: report.institutionId,
          reportingMonth: report.reportingMonth,
          reportingYear: report.reportingYear,
          status: report.status as "DRAFT" | "RETURNED",
          kpiSummary: report.kpiSummary as never,
          engagementNotes: report.engagementNotes,
          challengesOpportunities: report.challengesOpportunities,
          successStories: report.successStories,
          marketInsights: report.marketInsights,
          nextMonthPlan: report.nextMonthPlan,
          icr: report.icr,
          institution: report.institution,
          returnComment: report.approvals[0]?.comment ?? null,
        }}
      />
    </div>
  );
}
