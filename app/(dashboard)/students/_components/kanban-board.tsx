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
import { ALL_STAGES, STAGE_LABELS as PIPELINE_STAGE_LABELS } from "@/lib/lead-pipeline";
import { useToast } from "@/hooks/use-toast";

// ─── Constants ────────────────────────────────────────────────────────────────

// Stage order and labels come from lib/lead-pipeline.ts. Local copies are what
// let a previous rename compile cleanly while rendering nothing.
export { STAGE_LABELS } from "@/lib/lead-pipeline";

const STAGE_ORDER: readonly LeadStage[] = ALL_STAGES;

const COLUMN_CONFIG: Record<
  LeadStage,
  { headerBg: string; headerText: string; countBg: string; countText: string; borderColor: string }
> = {
  NEW_LEAD:              { headerBg: "bg-slate-50 dark:bg-slate-800/60",   headerText: "text-slate-700 dark:text-slate-300",   countBg: "bg-slate-200 dark:bg-slate-700",   countText: "text-slate-700 dark:text-slate-200",   borderColor: "border-slate-200 dark:border-slate-800" },
  CONTACTED:             { headerBg: "bg-sky-50 dark:bg-sky-500/10",     headerText: "text-sky-700 dark:text-sky-300",     countBg: "bg-sky-200 dark:bg-sky-500/25",     countText: "text-sky-800 dark:text-sky-200",     borderColor: "border-sky-200 dark:border-sky-500/30" },
  QUALIFIED:             { headerBg: "bg-cyan-50 dark:bg-cyan-500/10",    headerText: "text-cyan-700 dark:text-cyan-300",    countBg: "bg-cyan-200 dark:bg-cyan-500/25",    countText: "text-cyan-800 dark:text-cyan-200",    borderColor: "border-cyan-200 dark:border-cyan-500/30" },
  APPLICATION_SUBMITTED: { headerBg: "bg-indigo-50 dark:bg-indigo-500/10",  headerText: "text-indigo-700 dark:text-indigo-300",  countBg: "bg-indigo-200 dark:bg-indigo-500/25",  countText: "text-indigo-800 dark:text-indigo-200",  borderColor: "border-indigo-200 dark:border-indigo-500/30" },
  AWAITING_DECISION:     { headerBg: "bg-violet-50 dark:bg-violet-500/10",  headerText: "text-violet-700 dark:text-violet-300",  countBg: "bg-violet-200 dark:bg-violet-500/25",  countText: "text-violet-800 dark:text-violet-200",  borderColor: "border-violet-200 dark:border-violet-500/30" },
  OFFER_RECEIVED:        { headerBg: "bg-blue-50 dark:bg-blue-500/10",    headerText: "text-blue-700 dark:text-blue-300",    countBg: "bg-blue-200 dark:bg-blue-500/25",    countText: "text-blue-800 dark:text-blue-200",    borderColor: "border-blue-200 dark:border-blue-500/30" },
  DEPOSIT_PAID:          { headerBg: "bg-teal-50 dark:bg-teal-500/10",    headerText: "text-teal-700 dark:text-teal-300",    countBg: "bg-teal-200 dark:bg-teal-500/25",    countText: "text-teal-800 dark:text-teal-200",    borderColor: "border-teal-200 dark:border-teal-500/30" },
  ENROLLED:              { headerBg: "bg-green-50 dark:bg-green-500/10",   headerText: "text-green-700 dark:text-green-300",   countBg: "bg-green-200 dark:bg-green-500/25",   countText: "text-green-800 dark:text-green-200",   borderColor: "border-green-200 dark:border-green-500/30" },
  LOST:                  { headerBg: "bg-gray-50 dark:bg-slate-800/60",    headerText: "text-gray-600 dark:text-slate-400",    countBg: "bg-gray-200 dark:bg-slate-700",    countText: "text-gray-700 dark:text-slate-300",    borderColor: "border-gray-200 dark:border-slate-800" },
  DEFERRED:              { headerBg: "bg-orange-50 dark:bg-orange-500/10",  headerText: "text-orange-700 dark:text-orange-300",  countBg: "bg-orange-200 dark:bg-orange-500/25",  countText: "text-orange-800 dark:text-orange-200",  borderColor: "border-orange-200 dark:border-orange-500/30" },
  APPLICATION_REJECTED:  { headerBg: "bg-red-50 dark:bg-red-500/10",     headerText: "text-red-700 dark:text-red-300",     countBg: "bg-red-200 dark:bg-red-500/25",     countText: "text-red-800 dark:text-red-200",     borderColor: "border-red-200 dark:border-red-500/30" },
  WITHDRAWN:             { headerBg: "bg-zinc-50 dark:bg-zinc-500/10",    headerText: "text-zinc-700 dark:text-zinc-300",    countBg: "bg-zinc-200 dark:bg-zinc-500/25",    countText: "text-zinc-800 dark:text-zinc-200",    borderColor: "border-zinc-200 dark:border-zinc-500/30" },
  VISA_REFUSED:          { headerBg: "bg-rose-50 dark:bg-rose-500/10",    headerText: "text-rose-700 dark:text-rose-300",    countBg: "bg-rose-200 dark:bg-rose-500/25",    countText: "text-rose-800 dark:text-rose-200",    borderColor: "border-rose-200 dark:border-rose-500/30" },
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
        "bg-white/80 dark:bg-slate-900/60 backdrop-blur-sm",
        isOver && "ring-2 ring-[#1E3A5F] dark:ring-sky-500 ring-offset-1 dark:ring-offset-slate-950"
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
          {PIPELINE_STAGE_LABELS[stage]}
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
          "scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700 scrollbar-track-transparent",
          isOver && "bg-slate-50/60 dark:bg-slate-800/40"
        )}
      >
        <SortableContext items={leadIds} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
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
    // Defensive: a lead carrying a stage the board doesn't know about would
    // otherwise throw and blank the entire page.
    const bucket = result[lead.stage];
    if (bucket) bucket.push(lead);
    else console.warn(`[kanban] unknown stage "${lead.stage}" on lead ${lead.id}`);
  }
  return result;
}

export function KanbanBoard({ initialLeads }: KanbanBoardProps) {
  const [leadsByStage, setLeadsByStage] = React.useState<LeadsByStage>(() =>
    groupByStage(initialLeads)
  );
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overColumnId, setOverColumnId] = React.useState<LeadStage | null>(null);
  const { toast } = useToast();

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

    // Persist to API.
    //
    // `fetch` only rejects on network failure, so a 4xx from the stage gate
    // resolves normally. Checking `res.ok` is what makes a refused move
    // actually snap back instead of silently appearing to succeed.
    const revert = () =>
      setLeadsByStage((prev) => {
        const revertedLead = { ...lead, stage: fromStage };
        const newTo = prev[toStage].filter((l) => l.id !== activeLeadId);
        const fromItems = [...prev[fromStage]];
        fromItems.push(revertedLead);
        return { ...prev, [fromStage]: fromItems, [toStage]: newTo };
      });

    (async () => {
      try {
        const res = await fetch(`/api/leads/${activeLeadId}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: toStage }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          revert();
          toast({
            title: `Can't move to ${PIPELINE_STAGE_LABELS[toStage]}`,
            description:
              (Array.isArray(data.blockers) && data.blockers.length
                ? data.blockers.map((b: { message: string }) => b.message).join(" · ")
                : data.error) ?? "The move was rejected.",
            variant: "destructive",
          });
        }
      } catch {
        revert();
        toast({ title: "Connection lost", description: "The move was not saved.", variant: "destructive" });
      }
    })();
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
