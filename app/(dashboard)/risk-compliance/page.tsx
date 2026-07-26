import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { RiskComplianceClient } from "./_components/risk-compliance-client";

async function getRisks() {
  return db.riskRegister.findMany({
    include: {
      owner: { select: { id: true, name: true } },
      institution: { select: { id: true, name: true } },
      market: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function getComplianceItems() {
  return db.complianceItem.findMany({
    include: {
      assignedTo: { select: { id: true, name: true } },
      institution: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function getUsers() {
  return db.user.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function getInstitutions() {
  return db.institution.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function getMarkets() {
  return db.market.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export default async function RiskCompliancePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (
    !(await effectiveHasPermission(session.user.role, "risk_compliance", "read"))
  )
    redirect("/dashboard");

  const [risks, complianceItems, users, institutions, markets] =
    await Promise.all([
      getRisks(),
      getComplianceItems(),
      getUsers(),
      getInstitutions(),
      getMarkets(),
    ]);

  const canWrite = await effectiveHasPermission(
    session.user.role,
    "risk_compliance",
    "write"
  );
  const canDelete = await effectiveHasPermission(
    session.user.role,
    "risk_compliance",
    "delete"
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk & Compliance"
        description="Manage risk registers, compliance tracking, and regulatory requirements"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Risk & Compliance" },
        ]}
      />
      <RiskComplianceClient
        risks={risks}
        complianceItems={complianceItems}
        users={users}
        institutions={institutions}
        markets={markets}
        canWrite={canWrite}
        canDelete={canDelete}
      />
    </div>
  );
}
