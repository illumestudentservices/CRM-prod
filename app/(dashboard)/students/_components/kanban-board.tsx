"use client";

import * as React from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { LeadCard, type LeadWithRelations } from "./lead-card";
import type { LeadStage } from "@prisma/client";

// ─── Constants ────────────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  APPLICATION_SENT: "Application Sent",
  DOCUMENTS_RECEIVED: "Documents Received",
  OFFER_ISSUED: "Offer Issued",
  ENROLLED: "Enrolled",
  DEFERRED: "Deferred",
  REJECTED: "Rejected",
  LOST: "Lost",
};

const STAGE_ORDER: LeadStage[] = [
  "NEW",
  "CONTACTED",
  "APPLICATION_SENT",
  "DOCUMENTS_RECEIVED",
  "OFFER_ISSUED",
  "ENROLLED",
  "DEFERRED",
  "REJECTED",
  "LOST",
];

const COLUMN_CONFIG: Record<
  LeadStage,
  { label: string; headerBg: string; headerText: string; countBg: string; countText: string; borderColor: string }
> = {
  NEW: {
    label: "New",
    headerBg: "bg-slate-50",
    headerText: "text-slate-700",
    countBg: "bg-slate-200",
    countText: "text-slate-700",
    borderColor: "border-slate-200",
  },
  CONTACTED: {
    label: "Contacted",
    headerBg: "bg-blue-50",
    headerText: "text-blue-700",
    countBg: "bg-blue-200",
    countText: "text-blue-800",
    borderColor: "border-blue-200",
  },
  APPLICATION_SENT: {
    label: "Application Sent",
    headerBg: "bg-indigo-50",
    headerText: "text-indigo-700",
    countBg: "bg-indigo-200",
    countText: "text-indigo-800",
    borderColor: "border-indigo-200",
  },
  DOCUMENTS_RECEIVED: {
    label: "Docs Received",
    headerBg: "bg-violet-50",
    headerText: "text-violet-700",
    countBg: "bg-violet-200",
    countText: "text-violet-800",
    borderColor: "border-violet-200",
  },
  OFFER_ISSUED: {
    label: "Offer Issued",
    headerBg: "bg-amber-50",
    headerText: "text-amber-700",
    countBg: "bg-amber-200",
    countText: "text-amber-800",
    borderColor: "border-amber-200",
  },
  ENROLLED: {
    label: "Enrolled",
    headerBg: "bg-green-50",
    headerText: "text-green-700",
    countBg: "bg-green-200",
    countText: "text-green-800",
    borderColor: "border-green-200",
  },
  DEFERRED: {
    label: "Deferred",
    headerBg: "bg-orange-50",
    headerText: "text-orange-700",
    countBg: "bg-orange-200",
    countText: "text-orange-800",
    borderColor: "border-orange-200",
  },
  REJECTED: {
    label: "Rejected",
    headerBg: "bg-red-50",
    headerText: "text-red-700",
    countBg: "bg-red-200",
    countText: "text-red-800",
    borderColor: "border-red-200",
  },
  LOST: {
    label: "Lost",
    headerBg: "bg-gray-50",
    headerText: "text-gray-600",
    countBg: "bg-gray-200",
    countText: "text-gray-700",
    borderColor: "border-gray-200",
  },
};

// ─── Column component ─────────────────────────────────────────────────────────

interface KanbanColumnProps {
  stage: LeadStage;
  leads: LeadWithRelations[];
  isOver?: boolean;
}

function KanbanColumn({ stage, leads, isOver }: KanbanColumnProps) {
  const config = COLUMN_CONFIG[stage];
  const { setNodeRef } = useDroppable({ id: stage });
  const leadIds = leads.map((l) => l.id);

  return (
    <div
      className={cn(
        "flex flex-col w-64 shrink-0 rounded-xl border",
        config.borderColor,
        "bg-white/80 backdrop-blur-sm",
        isOver && "ring-2 ring-[#1E3A5F] ring-offset-1"
      )}
    >
      {/* Column header */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2.5 rounded-t-xl border-b",
          config.headerBg,
          config.borderColor
        )}
      >
        <span className={cn("text-xs font-semibold uppercase tracking-wide", config.headerText)}>
          {config.label}
        </span>
        <span
          className={cn(
            "inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums",
            config.countBg,
            config.countText
          )}
        >
          {leads.length}
        </span>
      </div>

      {/* Cards list */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px] max-h-[calc(100vh-240px)]",
          "scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent",
          isOver && "bg-slate-50/60"
        )}
      >
        <SortableContext items={leadIds} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
            Drop cards here
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main KanbanBoard ─────────────────────────────────────────────────────────

interface KanbanBoardProps {
  initialLeads: LeadWithRelations[];
}

type LeadsByStage = Record<LeadStage, LeadWithRelations[]>;

function groupByStage(leads: LeadWithRelations[]): LeadsByStage {
  const result = Object.fromEntries(STAGE_ORDER.map((s) => [s, []])) as unknown as LeadsByStage;
  for (const lead of leads) {
    result[lead.stage].push(lead);
  }
  return result;
}

export function KanbanBoard({ initialLeads }: KanbanBoardProps) {
  const [leadsByStage, setLeadsByStage] = React.useState<LeadsByStage>(() =>
    groupByStage(initialLeads)
  );
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overColumnId, setOverColumnId] = React.useState<LeadStage | null>(null);

  // Sync board when filtered leads change (filter/search applied in parent)
  React.useEffect(() => {
    setLeadsByStage(groupByStage(initialLeads));
  }, [initialLeads]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const activeLead = React.useMemo(() => {
    if (!activeId) return null;
    for (const stage of STAGE_ORDER) {
      const found = leadsByStage[stage].find((l) => l.id === activeId);
      if (found) return found;
    }
    return null;
  }, [activeId, leadsByStage]);

  function findLeadStage(leadId: string): LeadStage | null {
    for (const stage of STAGE_ORDER) {
      if (leadsByStage[stage].some((l) => l.id === leadId)) return stage;
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id as string | undefined;
    if (!overId) {
      setOverColumnId(null);
      return;
    }
    // Check if over a column directly
    if (STAGE_ORDER.includes(overId as LeadStage)) {
      setOverColumnId(overId as LeadStage);
    } else {
      // Over a card — find its stage
      const stage = findLeadStage(overId);
      setOverColumnId(stage);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setOverColumnId(null);

    if (!over) return;

    const activeLeadId = active.id as string;
    const overId = over.id as string;

    const fromStage = findLeadStage(activeLeadId);
    if (!fromStage) return;

    // Determine target stage
    let toStage: LeadStage;
    if (STAGE_ORDER.includes(overId as LeadStage)) {
      toStage = overId as LeadStage;
    } else {
      const found = findLeadStage(overId);
      if (!found) return;
      toStage = found;
    }

    if (fromStage === toStage) {
      // Reorder within same column
      const items = [...leadsByStage[fromStage]];
      const oldIndex = items.findIndex((l) => l.id === activeLeadId);
      const newIndex = items.findIndex((l) => l.id === overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        setLeadsByStage((prev) => ({
          ...prev,
          [fromStage]: arrayMove(items, oldIndex, newIndex),
        }));
      }
      return;
    }

    // Move to different column
    const lead = leadsByStage[fromStage].find((l) => l.id === activeLeadId);
    if (!lead) return;

    // Optimistic update
    setLeadsByStage((prev) => {
      const newFrom = prev[fromStage].filter((l) => l.id !== activeLeadId);
      const updatedLead = { ...lead, stage: toStage };

      const toItems = [...prev[toStage]];
      const overIndex = toItems.findIndex((l) => l.id === overId);
      if (overIndex !== -1) {
        toItems.splice(overIndex, 0, updatedLead);
      } else {
        toItems.push(updatedLead);
      }

      return { ...prev, [fromStage]: newFrom, [toStage]: toItems };
    });

    // Persist to API
    fetch(`/api/leads/${activeLeadId}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: toStage }),
    }).catch(() => {
      // Revert on error
      setLeadsByStage((prev) => {
        const revertedLead = { ...lead, stage: fromStage };
        const newTo = prev[toStage].filter((l) => l.id !== activeLeadId);
        const fromItems = [...prev[fromStage]];
        fromItems.push(revertedLead);
        return { ...prev, [fromStage]: fromItems, [toStage]: newTo };
      });
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 pt-1 px-0.5 -mx-0.5">
        {STAGE_ORDER.map((stage) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            leads={leadsByStage[stage]}
            isOver={overColumnId === stage && activeId !== null}
          />
        ))}
      </div>

      {/* Drag overlay — shows floating card while dragging */}
      <DragOverlay dropAnimation={null}>
        {activeLead ? (
          <div style={{ transform: "rotate(3deg)" }}>
            <LeadCard lead={activeLead} isDragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
