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
import type { Role } from "@prisma/client";

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
}

async function getStats() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [total, thisMonth, byType] = await Promise.all([
    db.activity.count({ where: { deletedAt: null } }),
    db.activity.count({ where: { deletedAt: null, date: { gte: startOfMonth } } }),
    db.activity.groupBy({ by: ["type"], where: { deletedAt: null }, _count: true }),
  ]);
  return { total, thisMonth, byType: byType.map((b) => ({ type: b.type, count: b._count })) };
}

// Spec §6 (Field Operations) — Lookup Before Create. Load the option lists
// server-side so the client renders real dropdowns.
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
  ]);
  return { institutions, schools, sources };
}

export default async function FieldOperationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(await effectiveHasPermission(session.user.role as any, "field_operations", "read"))) {
    redirect("/dashboard");
  }
  const [activities, stats, lookups] = await Promise.all([
    getActivities(),
    getStats(),
    getLookups(),
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
      <ActivitiesClient activities={activities} stats={stats} lookups={lookups} />
    </div>
  );
}
