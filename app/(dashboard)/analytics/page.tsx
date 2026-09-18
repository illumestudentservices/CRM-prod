import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { ExecutiveDashboard } from "./_components/executive-dashboard";
import { RegionalDashboard } from "./_components/regional-dashboard";
import { ICRDashboard } from "./_components/icr-dashboard";
import type { Role } from "@/lib/permissions";

export const metadata = {
  title: "Analytics | Illume Student Advisory Services",
};

export default async function AnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role;

  // Roles with no analytics access
  if (role === "HR_MANAGER" || role === "EMPLOYEE") {
    redirect("/dashboard");
  }

  const isExecutive = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS"].includes(role);
  const isRM = role === "REGIONAL_MANAGER";
  const isICR = role === "ICR" || role === "INSTITUTION_CLIENT";

  /**
   * Option lists for the executive filter bar, fetched here rather than from
   * the browser — the same shape the students page uses.
   *
   * Only loaded for the executive view, so the other two dashboards do not pay
   * three queries for controls they never render.
   */
  const [regions, institutions, icrs] = isExecutive
    ? await Promise.all([
        db.region.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
        db.institution.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        db.user.findMany({
          where: { role: "ICR", deletedAt: null, isActive: true },
          select: { id: true, name: true, email: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], [], []];

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
      <PageHeader
        title="Analytics"
        description={
          isExecutive
            ? "Executive overview of enrollment pipeline, market performance, and partner metrics"
            : isRM
            ? "Regional pipeline, ICR performance, and upcoming activities"
            : "Your personal lead pipeline, activity overview, and report status"
        }
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Analytics" }]}
      />

      {isExecutive && (
        <ExecutiveDashboard
          regions={regions}
          institutions={institutions}
          // An account with no display name would otherwise render a blank row.
          icrs={icrs.map((u) => ({ id: u.id, name: u.name ?? u.email }))}
          canFilterRegion
        />
      )}
      {isRM && <RegionalDashboard />}
      {isICR && <ICRDashboard />}
    </div>
  );
}
