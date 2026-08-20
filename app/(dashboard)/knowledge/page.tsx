import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { KnowledgeClient } from "./_components/knowledge-client";
import { KB_WRITE_ROLES } from "@/lib/kb-access";

async function getGeneralArticles() {
  return db.knowledgeBase.findMany({
    where: { knowledgeType: "GENERAL", deletedAt: null, isPublished: true },
    orderBy: { views: "desc" },
    take: 50,
    include: {
      attachments: {
        select: { id: true, name: true, mimeType: true, size: true },
        orderBy: { createdAt: "asc" },
      },
    },
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
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function getProposalArticles() {
  return db.knowledgeBase.findMany({
    where: { knowledgeType: "PROPOSAL", deletedAt: null, isPublished: true },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      attachments: {
        select: { id: true, name: true, mimeType: true, size: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export default async function KnowledgePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await effectiveHasPermission(session.user.role, "knowledge", "read"))) redirect("/dashboard");

  const [generalArticles, institutions, markets, proposalArticles] = await Promise.all([
    getGeneralArticles(),
    getInstitutions(),
    getMarkets(),
    getProposalArticles(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge Base"
        description="Institution-specific KB, market intelligence, and proposal library"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Knowledge Base" }]}
      />
      <KnowledgeClient
        generalArticles={JSON.parse(JSON.stringify(generalArticles))}
        institutions={institutions}
        markets={markets}
        proposalArticles={JSON.parse(JSON.stringify(proposalArticles))}
        canWriteGeneral={KB_WRITE_ROLES.includes(session.user.role)}
        canWriteInstitutions={await effectiveHasPermission(session.user.role, "institutions", "write")}
        canWriteMarkets={await effectiveHasPermission(session.user.role, "markets", "write")}
      />
    </div>
  );
}
