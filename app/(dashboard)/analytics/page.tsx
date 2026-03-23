import { redirect } from "next/navigation";
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

      {isExecutive && <ExecutiveDashboard />}
      {isRM && <RegionalDashboard />}
      {isICR && <ICRDashboard />}
    </div>
  );
}
