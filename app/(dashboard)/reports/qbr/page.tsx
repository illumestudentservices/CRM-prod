import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import type { Role } from "@/lib/permissions";
import { QBRClient } from "./_components/qbr-client";

export const metadata = {
  title: "Quarterly Business Reviews | Illume Student Advisory Services",
};

export default async function QBRPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { role } = session.user as { role: Role; id: string };

  const canGenerate = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER"].includes(role);

  // Fetch institutions for the generate form
  const institutions = canGenerate
    ? await db.institution.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
      <PageHeader
        title="Quarterly Business Reviews"
        description="Generate, view, and manage QBRs for each institution"
        breadcrumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Reports", href: "/reports" },
          { label: "QBR" },
        ]}
      />

      <QBRClient
        canGenerate={canGenerate}
        institutions={institutions}
      />
    </div>
  );
}
