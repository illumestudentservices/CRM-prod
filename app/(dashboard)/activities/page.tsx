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
  const [institutions, schools, sources] = await Promise.all([
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
    db.source.findMany({
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
  ]);
  return { institutions, schools, sources };
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
