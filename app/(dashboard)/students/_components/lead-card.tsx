"use client";

import * as React from "react";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GripVertical } from "lucide-react";
import { cn, getInitials, getMonthName } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Lead, User, Institution, Source } from "@prisma/client";

export type LeadWithRelations = Lead & {
  assignedICR: Pick<User, "id" | "name" | "image"> | null;
  institution: Pick<Institution, "id" | "name"> | null;
  source: Pick<Source, "id" | "name"> | null;
};

const STUDY_LEVEL_LABELS: Record<string, string> = {
  UNDERGRADUATE: "UG",
  POSTGRADUATE: "PG",
  PATHWAY: "Pathway",
  FOUNDATION: "Foundation",
};

const STUDY_LEVEL_COLORS: Record<string, string> = {
  UNDERGRADUATE: "bg-blue-50 text-blue-700",
  POSTGRADUATE: "bg-purple-50 text-purple-700",
  PATHWAY: "bg-amber-50 text-amber-700",
  FOUNDATION: "bg-emerald-50 text-emerald-700",
};

// Very small nationality → flag emoji lookup (common ones)
function getFlagEmoji(nationality: string): string {
  const map: Record<string, string> = {
    Nigerian: "🇳🇬",
    Ghanaian: "🇬🇭",
    Kenyan: "🇰🇪",
    South_African: "🇿🇦",
    Egyptian: "🇪🇬",
    Moroccan: "🇲🇦",
    Tanzanian: "🇹🇿",
    Ugandan: "🇺🇬",
    Ethiopian: "🇪🇹",
    Zimbabwean: "🇿🇼",
    Zambian: "🇿🇲",
    Indian: "🇮🇳",
    Pakistani: "🇵🇰",
    Bangladeshi: "🇧🇩",
    Chinese: "🇨🇳",
    Malaysian: "🇲🇾",
    Indonesian: "🇮🇩",
    Vietnamese: "🇻🇳",
    Filipino: "🇵🇭",
    Thai: "🇹🇭",
    Brazilian: "🇧🇷",
    Colombian: "🇨🇴",
    Mexican: "🇲🇽",
    American: "🇺🇸",
    British: "🇬🇧",
    Canadian: "🇨🇦",
    Australian: "🇦🇺",
    German: "🇩🇪",
    French: "🇫🇷",
    Spanish: "🇪🇸",
    Saudi: "🇸🇦",
    Emirati: "🇦🇪",
    Qatari: "🇶🇦",
    Kuwaiti: "🇰🇼",
  };
  return map[nationality] ?? "🌍";
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative bg-white rounded-lg border border-slate-200 shadow-sm",
        "hover:border-slate-300 hover:shadow-md transition-all duration-150",
        isDragging && "rotate-2 shadow-xl border-slate-300"
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className={cn(
          "absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded",
          "text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100",
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
          <p className="text-sm font-semibold text-slate-900 leading-tight line-clamp-1 flex-1">
            {lead.fullName}
          </p>
          {lead.isDuplicate && (
            <span title="Possible duplicate" className="shrink-0 mt-0.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            </span>
          )}
        </div>

        {/* Nationality + country */}
        <p className="text-xs text-slate-500 mb-2 flex items-center gap-1">
          <span>{getFlagEmoji(lead.nationality)}</span>
          <span className="truncate">{lead.countryOfResidence}</span>
        </p>

        {/* Program + level */}
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-xs text-slate-600 truncate max-w-[120px]">
            {lead.interestedProgram}
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold shrink-0",
              STUDY_LEVEL_COLORS[lead.studyLevel] ?? "bg-slate-100 text-slate-600"
            )}
          >
            {STUDY_LEVEL_LABELS[lead.studyLevel] ?? lead.studyLevel}
          </span>
        </div>

        {/* Meta row: intake + source */}
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
          <span className="truncate">
            {lead.source?.name ?? "—"} · {getMonthName(lead.intakeMonth).slice(0, 3)}{" "}
            {lead.intakeYear}
          </span>
        </div>

        {/* Footer: institution + ICR avatar */}
        {(lead.institution || lead.assignedICR) && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
            <span className="text-[11px] text-slate-400 truncate flex-1">
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
