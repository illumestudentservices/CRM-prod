import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { Role } from "@/lib/permissions";
import { StakeholdersTabs } from "./_components/stakeholders-tabs";

export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<{ tab?: string }>;
}

/**
 * Stakeholders — schools we visit and the counsellors inside them.
 *
 * Existed as `POST /api/stakeholders/*` since day one but had no UI, so
 * schools/counsellors could only be seeded by hand. This page surfaces both
 * as tabs with create dialogs so they can be managed from the browser.
 *
 * Note: the "Agents" leg lives on the partner detail page (Agent Profile
 * section) because an AgentProfile is a 1:1 sub-record of an existing
 * RecruitmentPartner, not a standalone stakeholder.
 */
export default async function StakeholdersPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (
    !(await effectiveHasPermission(session.user.role as Role, "stakeholders", "read"))
  ) {
    redirect("/dashboard");
  }

  const sp = (await searchParams) ?? {};
  const defaultTab = sp.tab === "counsellors" ? "counsellors" : "schools";

  const [schools, counsellors, markets] = await Promise.all([
    db.school.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { counsellors: true } } },
      orderBy: [{ country: "asc" }, { name: "asc" }],
      take: 300,
    }),
    db.counsellor.findMany({
      include: { school: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
      take: 500,
    }),
    db.market.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Stakeholders</h2>
        <p className="text-sm text-muted-foreground">
          High-schools and their counsellors — the direct-source recruitment
          network alongside partners and agents.
        </p>
      </div>
      <StakeholdersTabs
        schools={schools}
        counsellors={counsellors}
        markets={markets}
        defaultTab={defaultTab}
      />
    </div>
  );
}
