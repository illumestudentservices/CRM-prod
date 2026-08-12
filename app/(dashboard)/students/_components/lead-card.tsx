"use client";

import * as React from "react";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GripVertical, Clock } from "lucide-react";
import { cn, getInitials, getMonthName } from "@/lib/utils";
import { countryFlag } from "@/lib/country";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  daysSince,
  isInactiveStage,
  INACTIVITY_REMINDER_DAYS,
  INACTIVITY_ESCALATION_DAYS,
} from "@/lib/lead-pipeline";
import type { Lead, User, Institution, RecruitmentPartner } from "@prisma/client";
import { displayName } from "@/lib/person-name";

export type LeadWithRelations = Lead & {
  assignedICR: Pick<User, "id" | "name" | "image"> | null;
  institution: Pick<Institution, "id" | "name"> | null;
  source: Pick<RecruitmentPartner, "id" | "name"> | null;
};

const STUDY_LEVEL_LABELS: Record<string, string> = {
  UNDERGRADUATE: "UG",
  POSTGRADUATE: "PG",
  PATHWAY: "Pathway",
  FOUNDATION: "Foundation",
};

const STUDY_LEVEL_COLORS: Record<string, string> = {
  UNDERGRADUATE: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  POSTGRADUATE: "bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  PATHWAY: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  FOUNDATION: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

// Nationality → flag. Was a local map of ~30 demonyms with a globe fallback, so
// eight of the values actually in the data fell through to 🌍 — including
// "Saudi Arabian" and "UAE National", which the map held as "Saudi" and
// "Emirati", plus Turkish, Iranian, Japanese, Omani, Senegalese and Korean.
// lib/country.ts resolves demonyms, country names and ISO codes in one place.
function getFlagEmoji(nationality: string): string {
  return countryFlag(nationality) || "🌍";
}

interface LeadCardProps {
  lead: LeadWithRelations;
  isDragging?: boolean;
}

export function LeadCard({ lead, isDragging = false }: LeadCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: lead.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.4 : 1,
  };

  // How long this student has sat in their current stage. Closed and enrolled
  // records are excluded — they are meant to stop moving.
  const daysInStage = daysSince(lead.stageEnteredAt);
  const overdue = daysInStage !== null && daysInStage >= INACTIVITY_REMINDER_DAYS;
  const escalated = daysInStage !== null && daysInStage >= INACTIVITY_ESCALATION_DAYS;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm",
        "hover:border-slate-300 hover:shadow-md dark:hover:border-slate-700 transition-all duration-150",
        isDragging && "rotate-2 shadow-xl border-slate-300 dark:border-slate-700"
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className={cn(
          "absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded",
          "text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400 opacity-0 group-hover:opacity-100",
          "cursor-grab active:cursor-grabbing transition-opacity focus:outline-none focus:opacity-100"
        )}
        aria-label="Drag lead"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <Link
        href={`/students/${lead.id}`}
        className="block p-3 pl-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A5F] rounded-lg"
        onClick={(e) => {
          // Prevent navigation if dragging
          if (isSortableDragging) e.preventDefault();
        }}
      >
        {/* Header row: name + duplicate */}
        <div className="flex items-start justify-between gap-1 mb-1.5">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-tight line-clamp-1 flex-1">
            {displayName(lead)}
          </p>
          {lead.isDuplicate && (
            <span title="Possible duplicate" className="shrink-0 mt-0.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            </span>
          )}
        </div>

        {/* Nationality + country */}
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1">
          <span>{getFlagEmoji(lead.nationality)}</span>
          <span className="truncate">{lead.countryOfResidence}</span>
        </p>

        {/* Program + level */}
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-xs text-slate-600 dark:text-slate-400 truncate max-w-[120px]">
            {lead.interestedProgram}
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold shrink-0",
              STUDY_LEVEL_COLORS[lead.studyLevel] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
            )}
          >
            {STUDY_LEVEL_LABELS[lead.studyLevel] ?? lead.studyLevel}
          </span>
        </div>

        {/* Meta row: intake + source, and how long this card has sat here */}
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 dark:text-slate-500">
          <span className="truncate">
            {lead.source?.name ?? "—"} · {getMonthName(lead.intakeMonth).slice(0, 3)}{" "}
            {lead.intakeYear}
          </span>
          {daysInStage !== null && !isInactiveStage(lead.stage) && (
            <span
              className={cn(
                "shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium tabular-nums",
                escalated
                  ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                  : overdue
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                    : "text-slate-400 dark:text-slate-500"
              )}
              title={
                escalated
                  ? `No progress for ${daysInStage} days — escalated to management`
                  : overdue
                    ? `No progress for ${daysInStage} days`
                    : `${daysInStage} days in this stage`
              }
            >
              <Clock className="h-3 w-3" />
              {daysInStage}d
            </span>
          )}
        </div>

        {/* Footer: institution + ICR avatar */}
        {(lead.institution || lead.assignedICR) && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate flex-1">
              {lead.institution?.name ?? ""}
            </span>
            {lead.assignedICR && (
              <Avatar className="h-5 w-5 shrink-0 ml-1">
                {lead.assignedICR.image && (
                  <AvatarImage src={lead.assignedICR.image} alt={lead.assignedICR.name ?? ""} />
                )}
                <AvatarFallback className="text-[9px]">
                  {getInitials(lead.assignedICR.name)}
                </AvatarFallback>
              </Avatar>
            )}
          </div>
        )}
      </Link>
    </div>
  );
}
