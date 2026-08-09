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
import { type EventStatus } from "@prisma/client";
import Link from "next/link";
import { displayName } from "@/lib/person-name";

const STATUS_BADGE: Record<EventStatus, string> = {
  PLANNED: "bg-slate-100 text-slate-600 border-slate-200",
  CONFIRMED: "bg-blue-100 text-blue-700 border-blue-200",
  IN_PROGRESS: "bg-violet-100 text-violet-700 border-violet-200",
  COMPLETED: "bg-green-100 text-green-700 border-green-200",
  CLOSED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  CANCELLED: "bg-red-100 text-red-700 border-red-200",
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
  const event = await db.event.findUnique({
    where: { id },
    include: {
      region: { select: { id: true, name: true } },
      assignedICR: { select: { id: true, name: true } },
      institutions: {
        include: { institution: { select: { id: true, name: true } } },
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
              institutions: event.institutions,
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
        <span className="inline-flex items-center gap-1 text-sm text-slate-500">
          <CalendarDays className="h-3.5 w-3.5" />
          {formatDate(event.date)}
        </span>
        <span className="inline-flex items-center gap-1 text-sm text-slate-500">
          <MapPin className="h-3.5 w-3.5" />
          {event.city}, {event.country}
        </span>
        {event.assignedICR && (
          <span className="text-sm text-slate-500">ICR: {event.assignedICR.name}</span>
        )}
      </div>

      {/* 3-col layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main (2/3) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Cost Breakdown */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Cost Breakdown</CardTitle>
              <ExpenseForm eventId={event.id} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {event.expenses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-slate-400 py-6">
                        No expenses recorded yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {event.expenses.map((exp) => (
                        <TableRow key={exp.id}>
                          <TableCell>{exp.description}</TableCell>
                          <TableCell>
                            <span className="text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                              {exp.category ?? "Other"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(exp.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-slate-50 font-semibold">
                        <TableCell colSpan={2}>Total</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(totalExpenses)}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

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
                  <TableRow className="bg-slate-50/80">
                    <TableHead>Name</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Assigned ICR</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {event.leads.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-400 py-6">
                        No leads linked to this event yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    event.leads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell>
                          <Link
                            href={`/students/${lead.id}`}
                            className="font-medium text-[#1E3A5F] hover:underline"
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
                                ? "bg-green-50 text-green-700 border-green-200"
                                : "bg-slate-50 text-slate-600 border-slate-200"
                            )}
                          >
                            {lead.stage}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-600 text-sm">
                          {lead.assignedICR?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-slate-500 text-sm">
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
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
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
          {event.institutions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Linked Institutions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {event.institutions.map((ei) => (
                    <li key={ei.institutionId}>
                      <Link
                        href={`/institutions/${ei.institutionId}`}
                        className="text-sm text-[#1E3A5F] hover:underline"
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
