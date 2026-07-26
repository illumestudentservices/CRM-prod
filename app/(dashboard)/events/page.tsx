import * as React from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { EventList } from "./_components/event-list";
import { EventForm } from "./_components/event-form";
import { ExportButton } from "@/components/shared/export-button";

const EVENT_EXPORT_COLUMNS = [
  { key: "name",             header: "Event Name" },
  { key: "type",             header: "Type" },
  { key: "date",             header: "Date" },
  { key: "city",             header: "City" },
  { key: "country",          header: "Country" },
  { key: "status",           header: "Status" },
  { key: "budget",           header: "Budget (USD)" },
  { key: "totalCost",        header: "Total Cost (USD)" },
  { key: "leadsCount",       header: "Leads" },
  { key: "enrollmentsCount", header: "Enrollments" },
  { key: "roi",              header: "ROI (%)" },
  { key: "institutions",     header: "Institutions" },
];

const AVG_LEAD_VALUE = 5000;

async function getEventStats() {
  const now = new Date();

  const [total, upcoming, events] = await Promise.all([
    db.event.count({ where: { deletedAt: null } }),
    db.event.count({
      where: { deletedAt: null, date: { gte: now }, status: { not: "CANCELLED" } },
    }),
    db.event.findMany({
      where: { deletedAt: null, status: "COMPLETED" },
      include: {
        leads: { where: { deletedAt: null }, select: { stage: true } },
      },
    }),
  ]);

  const totalLeadsFromEvents = events.reduce((sum, e) => sum + e.leads.length, 0);

  const rois = events
    .filter((e) => e.totalCost > 0)
    .map((e) => {
      const enrolled = e.leads.filter((l) => l.stage === "ENROLLED").length;
      return ((enrolled * AVG_LEAD_VALUE - e.totalCost) / e.totalCost) * 100;
    });
  const avgROI = rois.length > 0 ? rois.reduce((a, b) => a + b, 0) / rois.length : null;

  return { total, upcoming, totalLeadsFromEvents, avgROI };
}

async function getEvents() {
  return db.event.findMany({
    where: { deletedAt: null },
    include: {
      institutions: {
        include: { institution: { select: { id: true, name: true } } },
      },
      _count: { select: { leads: true } },
      leads: {
        where: { deletedAt: null },
        select: { stage: true },
      },
    },
    orderBy: { date: "desc" },
  });
}

async function getRegions() {
  return db.region.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

async function getICRs() {
  return db.user.findMany({
    where: { role: "ICR", isActive: true },
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

export default async function EventsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await effectiveHasPermission(session.user.role, "events", "read"))) redirect("/dashboard");

  const [stats, events, regions, icrs, institutions] = await Promise.all([
    getEventStats(),
    getEvents(),
    getRegions(),
    getICRs(),
    getInstitutions(),
  ]);

  const eventsWithStats = events.map((e) => {
    const leadsCount = e._count.leads;
    const enrollmentsCount = e.leads.filter((l) => l.stage === "ENROLLED").length;
    const roi =
      e.totalCost > 0
        ? ((enrollmentsCount * AVG_LEAD_VALUE - e.totalCost) / e.totalCost) * 100
        : null;
    return {
      ...e,
      leadsCount,
      enrollmentsCount,
      roi,
      institutionNames: e.institutions.map((ei) => ei.institution.name),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        description="Manage education fairs, campus visits, webinars and more"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Events" }]}
        actions={
          <div className="flex items-center gap-2">
            <ExportButton
              data={eventsWithStats.map((e) => ({
                name:             e.name,
                type:             e.type.replace(/_/g, " "),
                date:             new Date(e.date).toLocaleDateString("en-GB"),
                city:             e.city,
                country:          e.country,
                status:           e.status,
                budget:           e.budget,
                totalCost:        e.totalCost,
                leadsCount:       e.leadsCount,
                enrollmentsCount: e.enrollmentsCount,
                roi:              e.roi !== null ? e.roi.toFixed(1) : "N/A",
                institutions:     e.institutionNames.join("; "),
              }))}
              columns={EVENT_EXPORT_COLUMNS}
              filename="events"
              title="Events Report"
            />
            <EventForm regions={regions} icrs={icrs} institutions={institutions} />
          </div>
        }
      />

      {/* Events List (includes stat cards) */}
      <EventList events={eventsWithStats} stats={stats} />
    </div>
  );
}
