import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { ActivitiesClient } from "./_components/activities-client";

async function getActivities() {
  return db.activity.findMany({
    where: { deletedAt: null },
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
  // NOTE: `status` is on the activity by default now (added in migration 019),
  // so it's selected automatically by findMany without an explicit include.
}

// Spec §6 (Field Operations) — "Lookup Before Create". Every ID picker on the
// activity form loads its options here, server-side, so the client renders a
// real dropdown instead of asking users to type a UUID they don't have.
async function getLookups() {
  // Spec §1 names six linkable entities — Client, Recruitment Partner, School,
  // Campaign, Market and Student. Only the first three were loaded, so the form
  // could not offer the rest and most activity types had no link available at
  // all. Events are included too: the model carries eventId and the
  // Event Preparation / Event Follow-up types are meaningless without it.
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
    // Agent-type sources for the AGENT_MEETING picker; other partner types
    // (referral partners, education partners) show up too so the same picker
    // works for a Partner Meeting.
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
    // Capped and newest-first: a full student list would be unusable in a
    // dropdown, and field work is normally logged against a student who has
    // been touched recently.
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

async function getActivityStats() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, thisMonth, byType] = await Promise.all([
    db.activity.count({ where: { deletedAt: null } }),
    db.activity.count({ where: { deletedAt: null, date: { gte: startOfMonth } } }),
    db.activity.groupBy({
      by: ["type"],
      where: { deletedAt: null },
      _count: true,
    }),
  ]);

  return {
    total,
    thisMonth,
    byType: byType.map((b) => ({ type: b.type, count: b._count })),
  };
}

export default async function ActivitiesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await effectiveHasPermission(session.user.role, "activities", "read"))) redirect("/dashboard");

  const [activities, stats, lookups] = await Promise.all([
    getActivities(),
    getActivityStats(),
    getLookups(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Field Operations"
        description="School visits, agent meetings, client meetings, and other field work"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Field Operations" },
        ]}
      />
      <ActivitiesClient activities={activities} stats={stats} lookups={lookups} />
    </div>
  );
}
