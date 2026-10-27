// Field Operations is the redesign's name for the old Activities module.
// Route redirects (/activities → /field-operations) live in next.config.ts;
// this page re-uses the existing ActivitiesClient so behaviour is identical
// until the code-level rename PR ships.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { ActivitiesClient } from "../activities/_components/activities-client";
import { RoleDashboard } from "./_components/role-dashboard";
import { activityVisibilityWhere } from "@/lib/activity-scope";
import type { Role } from "@prisma/client";

async function getActivities(
  sourceId?: string | null,
  scope: { userId?: string } = {}
) {
  return db.activity.findMany({
    // `scope` limits the list to what the viewer may see (own activities only,
    // unless they are a field-ops supervisor). Source filter applied here (not
    // client-side) so a partner's older activities are not lost behind the cap.
    where: { deletedAt: null, ...scope, ...(sourceId ? { sourceId } : {}) },
    include: {
      user: { select: { id: true, name: true, image: true } },
      institution: { select: { id: true, name: true } },
      market: { select: { id: true, name: true } },
      school: { select: { id: true, name: true } },
      _count: { select: { attendees: true } },
    },
    orderBy: { date: "desc" },
    take: 100,
  });
}

async function getStats(scope: { userId?: string } = {}) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  // Counts are scoped the same way as the list, or the tiles would say "500"
  // over a list the viewer can only see three rows of.
  const [total, thisMonth, byType] = await Promise.all([
    db.activity.count({ where: { deletedAt: null, ...scope } }),
    db.activity.count({ where: { deletedAt: null, ...scope, date: { gte: startOfMonth } } }),
    db.activity.groupBy({ by: ["type"], where: { deletedAt: null, ...scope }, _count: true }),
  ]);
  return { total, thisMonth, byType: byType.map((b) => ({ type: b.type, count: b._count })) };
}

// Spec §6 (Field Operations) — Lookup Before Create. Load the option lists
// server-side so the client renders real dropdowns.
async function getLookups() {
  // Kept in step with app/(dashboard)/activities/page.tsx — both render
  // ActivitiesClient, so both must supply all six linkable entities or the form
  // offers different options depending on which route you came in through.
  const [institutions, schools, sources, markets, campaigns, leads, events] = await Promise.all([
    db.institution.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, country: true },
      orderBy: { name: "asc" },
    }),
    db.school.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, country: true },
      orderBy: { name: "asc" },
    }),
    db.recruitmentPartner.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        type: {
          in: ["AGENT", "PARTNER", "REFERRAL_PARTNER", "EDUCATION_PARTNER"] as never,
        },
      },
      select: { id: true, name: true, country: true, type: true },
      orderBy: { name: "asc" },
    }),
    db.market.findMany({
      select: { id: true, name: true, countryCode: true },
      orderBy: { name: "asc" },
    }),
    db.campaign.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 300,
    }),
    db.lead.findMany({
      where: { deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    db.event.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, country: true },
      orderBy: { date: "desc" },
      take: 300,
    }),
  ]);
  return {
    institutions,
    schools,
    sources,
    markets: markets.map((m) => ({ id: m.id, name: m.name, country: m.countryCode ?? null })),
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, country: null })),
    students: leads.map((l) => ({
      id: l.id,
      name: `${l.firstName} ${l.lastName}`.trim() || l.email || "Unnamed student",
      country: null,
    })),
    events: events.map((e) => ({ id: e.id, name: e.name, country: e.country ?? null })),
  };
}

export default async function FieldOperationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ source?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(await effectiveHasPermission(session.user.role as any, "field_operations", "read"))) {
    redirect("/dashboard");
  }
  // Pre-applied source (recruitment partner) filter, e.g. from a partner's
  // "Field Ops" tile. "all" treated as absent.
  const sp = (await searchParams) ?? {};
  const sourceFilter = sp.source && sp.source !== "all" ? sp.source : null;

  // Field activity is personal: individual contributors (e.g. ICR) see only
  // what they logged; supervisors (managers, Super Admin, HQ) see everyone's.
  const scope = activityVisibilityWhere(session.user.role as Role, session.user.id);

  const [activities, stats, lookups, sourcePartner] = await Promise.all([
    getActivities(sourceFilter, scope),
    getStats(scope),
    getLookups(),
    sourceFilter
      ? db.recruitmentPartner.findUnique({ where: { id: sourceFilter }, select: { name: true } })
      : Promise.resolve(null),
  ]);
  return (
    <div className="p-6">
      <PageHeader
        title="Field Operations"
        description="Planned service-delivery activities linked to Clients, Recruitment Partners, Events and Markets."
      />
      {/* Spec §13 — role-scoped dashboard sits above the shared activity
          list. ICR sees a personal panel, RM sees a per-ICR breakdown,
          senior management sees org-wide aggregates. */}
      <RoleDashboard
        userId={session.user.id}
        role={session.user.role as Role}
        regionId={session.user.regionId ?? null}
      />
      <ActivitiesClient
        activities={activities}
        stats={stats}
        lookups={lookups}
        sourceFilter={
          sourceFilter
            ? { id: sourceFilter, name: sourcePartner?.name ?? "selected partner" }
            : null
        }
      />
    </div>
  );
}
