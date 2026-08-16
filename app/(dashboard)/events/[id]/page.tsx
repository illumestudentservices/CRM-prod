import * as React from "react";
import { redirect, notFound } from "next/navigation";
import { CalendarDays, MapPin } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatDate, formatCurrency } from "@/lib/utils";
import { EventForm } from "../_components/event-form";
import { ROICard } from "./_components/roi-card";
import { ExpenseForm } from "./_components/expense-form";
import { ParticipationPanel } from "./_components/participation-panel";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
import { type EventStatus } from "@prisma/client";
import Link from "next/link";
import { displayName } from "@/lib/person-name";

const STATUS_BADGE: Record<EventStatus, string> = {
  PLANNED: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  CONFIRMED: "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30",
  IN_PROGRESS: "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30",
  COMPLETED: "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300 border-green-200 dark:border-green-500/30",
  CLOSED: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30",
  CANCELLED: "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30",
};

const STATUS_LABEL: Record<EventStatus, string> = {
  PLANNED: "Planned",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

async function getEvent(id: string) {
  // Spec §7 — Read from `participations` (rich per-institution ICR / status /
  // notes). `institutions` (flat join) is being retired.
  const event = await db.event.findUnique({
    where: { id },
    include: {
      region: { select: { id: true, name: true } },
      assignedICR: { select: { id: true, name: true } },
      participations: {
        include: {
          institution: { select: { id: true, name: true } },
          assignedICR: { select: { id: true, name: true } },
        },
      },
      expenses: { orderBy: { createdAt: "asc" } },
      leads: {
        where: { deletedAt: null },
        include: {
          assignedICR: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });
  if (event?.deletedAt) return null;
  return event;
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

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  // Resolved server-side and passed down, so the panel never decides its own
  // permissions. Participation writes are gated on recruitment_network:write,
  // matching /api/event-participations.
  const canWriteParticipation = session?.user
    ? await effectiveHasPermission(session.user.role as Role, "recruitment_network", "write")
    : false;
  if (!session?.user) redirect("/login");

  const { id } = await params;

  const [event, regions, icrs, institutions] = await Promise.all([
    getEvent(id),
    getRegions(),
    getICRs(),
    getInstitutions(),
  ]);

  if (!event) notFound();

  const enrolledLeads = event.leads.filter((l) => l.stage === "ENROLLED");
  const totalExpenses = event.expenses.reduce((sum, e) => sum + e.amount, 0);

  // Spec §10 — Cost Breakdown grouped by category with subtotals. Categories
  // that aren't populated on existing rows fall into "Other".
  const CANONICAL_CATEGORIES = [
    "REGISTRATION_FEE",
    "TRAVEL",
    "ACCOMMODATION",
    "MARKETING_MATERIALS",
    "SHIPPING",
    "MEALS",
    "LOCAL_TRANSPORT",
    "OTHER",
  ] as const;
  const categoryTotals = new Map<string, number>();
  for (const exp of event.expenses) {
    const key = (exp.category ?? "OTHER").toUpperCase().replace(/\s+/g, "_");
    const bucket = (CANONICAL_CATEGORIES as readonly string[]).includes(key) ? key : "OTHER";
    categoryTotals.set(bucket, (categoryTotals.get(bucket) ?? 0) + exp.amount);
  }
  const categoryLabel: Record<string, string> = {
    REGISTRATION_FEE: "Registration Fee",
    TRAVEL: "Travel",
    ACCOMMODATION: "Accommodation",
    MARKETING_MATERIALS: "Marketing Materials",
    SHIPPING: "Shipping",
    MEALS: "Meals",
    LOCAL_TRANSPORT: "Local Transport",
    OTHER: "Other",
  };
  const budgetVariance = event.budget != null ? event.budget - totalExpenses : null;

  // Spec §9 — Objectives are stored as JSON.
  type ObjectiveRow = {
    target: string;
    metric?: string;
    goal?: number;
    achieved?: number;
    notes?: string;
  };
  const objectives: ObjectiveRow[] = Array.isArray(event.objectives)
    ? (event.objectives as ObjectiveRow[]).filter(
        (o) => o && typeof o.target === "string" && o.target.length > 0
      )
    : [];

  // Spec §14 — Event Timeline derived from existing rows. Sorted freshest last
  // so the render reads top-to-bottom in chronological order.
  type TimelineRow = { at: Date; label: string; detail?: string };
  const timeline: TimelineRow[] = [];
  timeline.push({ at: event.createdAt, label: "Event created" });
  for (const p of event.participations) {
    // createdAt on EventParticipation is when the institution joined; on the
    // flat legacy join we don't have per-row timestamps, so use event.createdAt.
    const at = p.createdAt ?? event.createdAt;
    timeline.push({
      at,
      label: "Institution joined",
      detail: p.institution.name,
    });
  }
  for (const exp of event.expenses) {
    timeline.push({
      at: exp.createdAt,
      label: "Expense recorded",
      detail: `${categoryLabel[(exp.category ?? "OTHER").toUpperCase()] ?? exp.category ?? "Other"} · ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(exp.amount)}`,
    });
  }
  for (const lead of event.leads) {
    timeline.push({
      at: lead.createdAt,
      label: "Lead captured",
      detail: displayName(lead),
    });
  }
  if (event.status === "COMPLETED" || event.status === "CLOSED") {
    timeline.push({
      at: event.updatedAt,
      label: event.status === "CLOSED" ? "Event closed" : "Event completed",
    });
  }
  timeline.sort((a, b) => a.at.getTime() - b.at.getTime());
  // Keep the last 12 events so it stays scannable on a busy fair.
  const timelineTail = timeline.slice(-12);

  return (
    <div className="space-y-6">
      <PageHeader
        title={event.name}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Events", href: "/events" },
          { label: event.name },
        ]}
        actions={
          <EventForm
            event={{
              id: event.id,
              name: event.name,
              type: event.type,
              date: event.date,
              city: event.city,
              country: event.country,
              status: event.status,
              budget: event.budget,
              notes: event.notes,
              region: event.region,
              assignedICRId: event.assignedICRId,
              // The edit form still expects the flat {institutionId,
               // institution:{...}} shape. Reshape participations to match so
               // we don't have to touch the form component in this PR.
              institutions: event.participations.map((p) => ({
                institutionId: p.institutionId,
                institution: p.institution,
              })),
            }}
            regions={regions}
            icrs={icrs}
            institutions={institutions}
            mode="edit"
          />
        }
      />

      {/* Header info */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium border",
            STATUS_BADGE[event.status]
          )}
        >
          {STATUS_LABEL[event.status]}
        </span>
        <span className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
          <CalendarDays className="h-3.5 w-3.5" />
          {formatDate(event.date)}
        </span>
        <span className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
          <MapPin className="h-3.5 w-3.5" />
          {event.city}, {event.country}
        </span>
        {event.assignedICR && (
          <span className="text-sm text-slate-500 dark:text-slate-400">ICR: {event.assignedICR.name}</span>
        )}
      </div>

      {/* 3-col layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main (2/3) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Spec §9 — Event Objectives */}
          {objectives.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Objectives</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {objectives.map((o, i) => {
                  const pct =
                    o.goal && o.goal > 0 && typeof o.achieved === "number"
                      ? Math.min(100, Math.round((o.achieved / o.goal) * 100))
                      : null;
                  return (
                    <div key={i} className="rounded border border-slate-200 dark:border-slate-800 p-3 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-medium text-slate-800 dark:text-slate-200">{o.target}</p>
                        {typeof o.achieved === "number" && typeof o.goal === "number" && (
                          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                            {o.achieved} / {o.goal}
                            {pct !== null && <span className="ml-1">({pct}%)</span>}
                          </span>
                        )}
                      </div>
                      {pct !== null && (
                        <div className="mt-1.5 h-1.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={cn(
                              "h-full transition-all",
                              pct >= 100 ? "bg-green-500" : pct >= 70 ? "bg-blue-500" : "bg-amber-500"
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                      {o.notes && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{o.notes}</p>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Participation — spec §7. EventParticipation carries the assigned
              consultant, attendance, outcome notes and cost per institution and
              had no interface at all, so none of it could be recorded. Placed
              above Cost Breakdown because participation cost feeds it. */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Participating Institutions</CardTitle>
            </CardHeader>
            <CardContent>
              <ParticipationPanel eventId={event.id} canWrite={canWriteParticipation} />
            </CardContent>
          </Card>

          {/* Cost Breakdown — spec §10 grouped by category with planned-vs-actual variance */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Cost Breakdown</CardTitle>
              <ExpenseForm eventId={event.id} />
            </CardHeader>
            <CardContent className="p-0">
              {/* Category subtotals — spec §10 categories */}
              {categoryTotals.size > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 border-b bg-slate-50/80 dark:bg-slate-900/40">
                  {CANONICAL_CATEGORIES.map((cat) => {
                    const amt = categoryTotals.get(cat) ?? 0;
                    if (amt === 0) return null;
                    return (
                      <div key={cat} className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{categoryLabel[cat]}</p>
                        <p className="text-sm font-semibold tabular-nums">{formatCurrency(amt)}</p>
                      </div>
                    );
                  })}
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/40">
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {event.expenses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-slate-400 dark:text-slate-500 py-6">
                        No expenses recorded yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {event.expenses.map((exp) => (
                        <TableRow key={exp.id}>
                          <TableCell>{exp.description}</TableCell>
                          <TableCell>
                            <span className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/40 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800">
                              {exp.category ?? "Other"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(exp.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {event.budget != null && (
                        <TableRow className="bg-slate-50/50 dark:bg-slate-900/30 text-slate-600 dark:text-slate-300 text-xs">
                          <TableCell colSpan={2}>Planned budget</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(event.budget)}
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow className="bg-slate-50 dark:bg-slate-900/40 font-semibold">
                        <TableCell colSpan={2}>Total actual</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(totalExpenses)}
                        </TableCell>
                      </TableRow>
                      {budgetVariance !== null && (
                        <TableRow className={cn(
                          "bg-slate-50 dark:bg-slate-900/40 text-xs font-medium",
                          budgetVariance < 0 ? "text-red-700 dark:text-red-300" : "text-green-700 dark:text-green-300"
                        )}>
                          <TableCell colSpan={2}>Variance ({budgetVariance >= 0 ? "under" : "over"} budget)</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(Math.abs(budgetVariance))}
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Spec §14 — Event Timeline (last 12 activity rows) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {timelineTail.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6">
                  No timeline events yet.
                </p>
              ) : (
                <ol className="relative border-l border-slate-200 dark:border-slate-800 pl-4 space-y-2">
                  {timelineTail.map((t, i) => (
                    <li key={i} className="text-sm">
                      <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" />
                      <p>
                        <span className="font-medium text-slate-800 dark:text-slate-200">{t.label}</span>
                        {t.detail && <span className="text-slate-600 dark:text-slate-400"> — {t.detail}</span>}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">{formatDate(t.at)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Attachments — collateral, banners, receipts, event flyers, etc. */}
          <AttachmentsPanel parentType="RECRUITMENT_EVENT" parentId={event.id} />

          {/* Linked Leads */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Linked Leads ({event.leads.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/40">
                    <TableHead>Name</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Assigned ICR</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {event.leads.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-400 dark:text-slate-500 py-6">
                        No leads linked to this event yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    event.leads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell>
                          <Link
                            href={`/students/${lead.id}`}
                            className="font-medium text-[#1E3A5F] dark:text-blue-400 hover:underline"
                          >
                            {displayName(lead)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              lead.stage === "ENROLLED"
                                ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300 border-green-200 dark:border-green-500/30"
                                : "bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                            )}
                          >
                            {lead.stage}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300 text-sm">
                          {lead.assignedICR?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-slate-500 dark:text-slate-400 text-sm">
                          {formatDate(lead.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Post-event notes (read only; saved via PATCH) */}
          {event.postEventNotes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Post-Event Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {event.postEventNotes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right (1/3) */}
        <div className="space-y-4">
          <ROICard
            totalCost={totalExpenses}
            leadsCount={event.leads.length}
            enrollmentsCount={enrolledLeads.length}
            budget={event.budget}
          />

          {/* Linked Institutions */}
          {event.participations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Linked Institutions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {event.participations.map((ei) => (
                    <li key={ei.institutionId}>
                      <Link
                        href={`/institutions/${ei.institutionId}`}
                        className="text-sm text-[#1E3A5F] dark:text-blue-400 hover:underline"
                      >
                        {ei.institution.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
