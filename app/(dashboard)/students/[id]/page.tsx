import * as React from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  Mail,
  Phone,
  Globe,
  GraduationCap,
  Calendar,
  MapPin,
  Building2,
  User,
  FileText,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { cn, formatDate, getInitials, getMonthName } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StageSelector } from "./_components/stage-selector";
import { ActivityTimeline, type ActivityItem } from "./_components/activity-timeline";
import { ActivitiesPanel } from "./_components/activities-panel";
import { ChecklistPanel } from "./_components/checklist-panel";
import { ApplicationPanel } from "./_components/application-panel";
import { AddNoteForm } from "./_components/add-note-form";
import { LeadDetailClient } from "./_components/lead-detail-client";


// ─── Stage display helpers ─────────────────────────────────────────────────────

import {
  STAGE_BADGE_CLASSES as STAGE_COLORS,
  STAGE_LABELS,
  ALL_STAGES,
  CLOSED_STAGES,
} from "@/lib/lead-pipeline";
import { evaluateStageGate, canOverrideGate } from "@/lib/lead-gate";
import { loadLeadForGate } from "@/lib/lead-access";
export { STAGE_COLORS, STAGE_LABELS };

// ─── Detail row ───────────────────────────────────────────────────────────────

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5">
      <div className="h-7 w-7 rounded-md bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="h-3.5 w-3.5 text-slate-500" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-slate-800 mt-0.5 break-words">{value}</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;

  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      assignedICR: { select: { id: true, name: true, image: true, email: true } },
      institution: {
        select: {
          id: true,
          name: true,
          country: true,
          type: true,
          website: true,
          primaryContact: true,
          accountStatus: true,
        },
      },
      source: { select: { id: true, name: true, type: true, country: true, contactPerson: true } },
      activities: {
        include: {
          user: { select: { id: true, name: true, image: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      notesLog: {
        orderBy: { createdAt: "desc" },
      },
      documents: {
        orderBy: { uploadedAt: "desc" },
      },
    },
  });

  if (!lead || lead.deletedAt) notFound();

  // Fetch note authors separately
  const authorIds = [...new Set(lead.notesLog.map((n) => n.authorId))];
  const noteAuthors = authorIds.length
    ? await db.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true, image: true },
      })
    : [];

  const authorMap = Object.fromEntries(noteAuthors.map((u) => [u.id, u]));

  const notesWithAuthors = lead.notesLog.map((note) => ({
    ...note,
    author: authorMap[note.authorId] ?? null,
  }));

  // Fetch ICR users and related data for the edit form
  const [sources, institutions, icrUsers] = await Promise.all([
    db.source.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.institution.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { isActive: true, role: "ICR" },
      select: { id: true, name: true, image: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Stage gates, evaluated here rather than fetched by the client.
  //
  // It has to be per-request: the "a future activity is scheduled" rule depends
  // on the current time, so a cached answer goes wrong on its own. Computing it
  // in the server component also means every router.refresh() — after an edit,
  // a logged activity, a ticked checklist item — delivers a fresh blocker list,
  // which is what stops a warning lingering until the page is reloaded.
  const gateLead = await loadLeadForGate(id);
  const gates = gateLead
    ? ALL_STAGES.filter(
        (s) => s !== gateLead.stage && !(CLOSED_STAGES as readonly string[]).includes(s)
      ).map((s) => {
        const result = evaluateStageGate(gateLead, s, gateLead.activities, {
          application: gateLead.applications[0] ?? null,
          checklist: gateLead.checklistItems,
        });
        return { stage: s, canProgress: result.canProgress, blockers: result.blockers };
      })
    : [];

  const activities: ActivityItem[] = lead.activities.map((a) => ({
    id: a.id,
    type: a.type,
    description: a.description,
    createdAt: a.createdAt,
    // Null for automated entries written by the pipeline cron.
    user: a.user
      ? { id: a.user.id, name: a.user.name, image: a.user.image }
      : { id: "system", name: "Automation", image: null },
  }));

  const currentUser = {
    id: session.user.id,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
  };

  const STUDY_LEVEL_LABELS: Record<string, string> = {
    UNDERGRADUATE: "Undergraduate",
    POSTGRADUATE: "Postgraduate",
    PATHWAY: "Pathway",
    FOUNDATION: "Foundation",
  };

  return (
    <div className="space-y-6">
      {/* Back button + header */}
      <div className="flex items-start gap-4">
        <Link
          href="/students"
          className="h-8 w-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center hover:bg-slate-50 transition-colors shrink-0 mt-0.5"
        >
          <ArrowLeft className="h-4 w-4 text-slate-600" />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{lead.fullName}</h1>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                STAGE_COLORS[lead.stage]
              )}
            >
              {STAGE_LABELS[lead.stage]}
            </span>
            {lead.isDuplicate && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium border border-amber-200">
                <AlertTriangle className="h-3 w-3" />
                Possible duplicate
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500">
            Added {formatDate(lead.createdAt)}
            {lead.institution && ` · ${lead.institution.name}`}
          </p>
        </div>

        {/* Edit button (client component handles modal) */}
        <LeadDetailClient
          lead={lead}
          sources={sources}
          institutions={institutions}
          icrUsers={icrUsers}
        />
      </div>

      {/* 3-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left 2/3 ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stage timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800">Pipeline Stage</CardTitle>
            </CardHeader>
            <CardContent>
              <StageSelector
                leadId={lead.id}
                currentStage={lead.stage}
                stageEnteredAt={lead.stageEnteredAt.toISOString()}
                gates={gates}
                canOverride={canOverrideGate(session.user.role)}
              />
            </CardContent>
          </Card>

          {/* Engagements — these are what satisfy the pipeline gates */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800">
                Activities &amp; Follow-ups
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ActivitiesPanel leadId={lead.id} />
            </CardContent>
          </Card>

          {/* Applications — Stages 4, 6 and 7 read their required fields here */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800">Applications</CardTitle>
            </CardHeader>
            <CardContent>
              <ApplicationPanel
                leadId={lead.id}
                institutions={institutions}
                defaultProgram={lead.interestedProgram}
              />
            </CardContent>
          </Card>

          {/* Checklists, generated on reaching Qualified and Deposit Paid */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800">Checklists</CardTitle>
            </CardHeader>
            <CardContent>
              <ChecklistPanel leadId={lead.id} />
            </CardContent>
          </Card>

          {/* Audit trail */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800">History</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline activities={activities} />
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <AddNoteForm
                leadId={lead.id}
                initialNotes={notesWithAuthors}
                currentUser={currentUser}
              />
            </CardContent>
          </Card>

          {/* Documents */}
          {lead.documents.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-800">
                  Documents ({lead.documents.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {lead.documents.map((doc) => (
                    <a
                      key={doc.id}
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      <div className="h-8 w-8 rounded-md bg-[#1E3A5F]/10 flex items-center justify-center shrink-0">
                        <FileText className="h-4 w-4 text-[#1E3A5F]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{doc.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {doc.type} · {formatDate(doc.uploadedAt)}
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Right 1/3 ── */}
        <div className="space-y-4">
          {/* Lead details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800">Lead Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DetailRow icon={Mail} label="Email" value={lead.email} />
              <DetailRow icon={Phone} label="Phone" value={lead.phone} />
              <DetailRow icon={Globe} label="Nationality" value={lead.nationality} />
              <DetailRow
                icon={MapPin}
                label="Country of Residence"
                value={lead.countryOfResidence}
              />
              <DetailRow
                icon={GraduationCap}
                label="Program"
                value={lead.interestedProgram}
              />
              {lead.faculty && (
                <DetailRow icon={GraduationCap} label="Faculty" value={lead.faculty} />
              )}
              <DetailRow
                icon={GraduationCap}
                label="Study Level"
                value={STUDY_LEVEL_LABELS[lead.studyLevel] ?? lead.studyLevel}
              />
              <DetailRow
                icon={Calendar}
                label="Intake"
                value={`${getMonthName(lead.intakeMonth)} ${lead.intakeYear}`}
              />
              {lead.lastContactedAt && (
                <DetailRow
                  icon={Calendar}
                  label="Last Contacted"
                  value={formatDate(lead.lastContactedAt)}
                />
              )}
            </CardContent>
          </Card>

          {/* Source info */}
          {lead.source && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-800">Source</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-md bg-[#0EA5E9]/10 flex items-center justify-center shrink-0">
                    <Building2 className="h-3.5 w-3.5 text-[#0EA5E9]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{lead.source.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {lead.source.type.replace(/_/g, " ")} · {lead.source.country}
                    </p>
                  </div>
                </div>
                {lead.source.contactPerson && (
                  <DetailRow icon={User} label="Contact Person" value={lead.source.contactPerson} />
                )}
              </CardContent>
            </Card>
          )}

          {/* Institution info */}
          {lead.institution && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-800">Institution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-md bg-violet-100 flex items-center justify-center shrink-0">
                    <Building2 className="h-4 w-4 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{lead.institution.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {lead.institution.type} · {lead.institution.country}
                    </p>
                  </div>
                </div>
                {lead.institution.website && (
                  <a
                    href={
                      lead.institution.website.startsWith("http")
                        ? lead.institution.website
                        : `https://${lead.institution.website}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#0EA5E9] hover:underline flex items-center gap-1"
                  >
                    <Globe className="h-3 w-3" />
                    {lead.institution.website}
                  </a>
                )}
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    lead.institution.accountStatus === "ACTIVE"
                      ? "bg-green-100 text-green-700"
                      : "bg-slate-100 text-slate-600"
                  )}
                >
                  {lead.institution.accountStatus}
                </span>
              </CardContent>
            </Card>
          )}

          {/* Assigned ICR */}
          {lead.assignedICR ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-800">Assigned ICR</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    {lead.assignedICR.image && (
                      <AvatarImage src={lead.assignedICR.image} alt={lead.assignedICR.name ?? ""} />
                    )}
                    <AvatarFallback>{getInitials(lead.assignedICR.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{lead.assignedICR.name}</p>
                    <p className="text-xs text-slate-500">{lead.assignedICR.email}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-slate-400 text-center">No ICR assigned</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
