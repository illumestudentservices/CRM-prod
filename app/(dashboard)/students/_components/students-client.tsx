"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, LayoutGrid, List, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KanbanBoard } from "./kanban-board";
import { LeadListView } from "./lead-list-view";
import { LeadForm } from "./lead-form";
import type { LeadWithRelations } from "./lead-card";
import type { Source, Institution, User } from "@prisma/client";
import type { LeadStage } from "@prisma/client";
import { ALL_STAGES, STAGE_LABELS } from "@/lib/lead-pipeline";
import { ExportButton } from "@/components/shared/export-button";
import { displayName } from "@/lib/person-name";

const LEAD_EXPORT_COLUMNS = [
  { key: "fullName",          header: "Full Name" },
  { key: "email",             header: "Email" },
  { key: "interestedProgram", header: "Program" },
  { key: "studyLevel",        header: "Study Level" },
  { key: "stage",             header: "Stage" },
  { key: "nationality",       header: "Nationality" },
  { key: "countryOfResidence",header: "Country of Residence" },
  { key: "institutionName",   header: "Institution" },
  { key: "sourceName",        header: "Source" },
  { key: "icrName",           header: "Assigned ICR" },
  { key: "intakeMonth",       header: "Intake Month" },
  { key: "intakeYear",        header: "Intake Year" },
  { key: "createdAt",         header: "Created At" },
];

const STAGE_OPTIONS: { value: LeadStage | "ALL"; label: string }[] = [
  { value: "ALL", label: "All Stages" },
  ...ALL_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] })),
]

type Tab = "kanban" | "list";

interface StudentsClientPageProps {
  initialLeads: LeadWithRelations[];
  sources: Pick<Source, "id" | "name">[];
  institutions: Pick<Institution, "id" | "name">[];
  icrUsers: Pick<User, "id" | "name" | "image">[];
  isManager: boolean;
}

export function StudentsClientPage({
  initialLeads,
  sources,
  institutions,
  icrUsers,
  isManager,
}: StudentsClientPageProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState<Tab>("kanban");
  const [search, setSearch] = React.useState("");
  const [stageFilter, setStageFilter] = React.useState<LeadStage | "ALL">("ALL");
  const [institutionFilter, setInstitutionFilter] = React.useState<string>("ALL");
  const [icrFilter, setIcrFilter] = React.useState<string>("ALL");
  const [addModalOpen, setAddModalOpen] = React.useState(false);

  // Filtered leads
  const filteredLeads = React.useMemo(() => {
    return initialLeads.filter((lead) => {
      if (search) {
        const q = search.toLowerCase();
        const matches =
          displayName(lead).toLowerCase().includes(q) ||
          (lead.email?.toLowerCase().includes(q) ?? false) ||
          lead.interestedProgram.toLowerCase().includes(q) ||
          lead.nationality.toLowerCase().includes(q) ||
          lead.countryOfResidence.toLowerCase().includes(q) ||
          (lead.institution?.name ?? "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (stageFilter !== "ALL" && lead.stage !== stageFilter) return false;
      if (institutionFilter !== "ALL" && lead.institutionId !== institutionFilter) return false;
      if (icrFilter !== "ALL" && lead.assignedICRId !== icrFilter) return false;
      return true;
    });
  }, [initialLeads, search, stageFilter, institutionFilter, icrFilter]);

  const hasActiveFilters =
    search !== "" ||
    stageFilter !== "ALL" ||
    institutionFilter !== "ALL" ||
    icrFilter !== "ALL";

  const exportData = React.useMemo(
    () =>
      filteredLeads.map((l) => ({
        fullName:           displayName(l),
        email:              l.email,
        interestedProgram:  l.interestedProgram,
        studyLevel:         l.studyLevel ?? "",
        stage:              l.stage.replace(/_/g, " "),
        nationality:        l.nationality,
        countryOfResidence: l.countryOfResidence,
        institutionName:    l.institution?.name ?? "",
        sourceName:         l.source?.name ?? "",
        icrName:            l.assignedICR?.name ?? "",
        intakeMonth:        l.intakeMonth ?? "",
        intakeYear:         l.intakeYear ?? "",
        createdAt:          new Date(l.createdAt).toLocaleDateString("en-GB"),
      })),
    [filteredLeads]
  );

  function clearFilters() {
    setSearch("");
    setStageFilter("ALL");
    setInstitutionFilter("ALL");
    setIcrFilter("ALL");
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        {/* Tab switcher */}
        <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 gap-0.5 w-fit">
          <button
            onClick={() => setActiveTab("kanban")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
              activeTab === "kanban"
                ? "bg-[#1E3A5F] text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50"
            )}
          >
            <LayoutGrid className="h-4 w-4" />
            Kanban
          </button>
          <button
            onClick={() => setActiveTab("list")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
              activeTab === "list"
                ? "bg-[#1E3A5F] text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50"
            )}
          >
            <List className="h-4 w-4" />
            List
          </button>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-2 sm:ml-auto">
          <ExportButton
            data={exportData}
            columns={LEAD_EXPORT_COLUMNS}
            filename="students_pipeline"
            title="Student Pipeline"
          />
          <Button onClick={() => setAddModalOpen(true)} className="gap-2" size="sm">
            <Plus className="h-4 w-4" />
            Add Lead
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm bg-white"
          />
        </div>

        {/* Stage filter */}
        <Select
          value={stageFilter}
          onValueChange={(v) => setStageFilter(v as LeadStage | "ALL")}
        >
          <SelectTrigger className="h-8 w-[160px] text-sm bg-white">
            <SelectValue placeholder="All Stages" />
          </SelectTrigger>
          <SelectContent>
            {STAGE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Institution filter */}
        {institutions.length > 0 && (
          <Select value={institutionFilter} onValueChange={setInstitutionFilter}>
            <SelectTrigger className="h-8 w-[180px] text-sm bg-white">
              <SelectValue placeholder="All Institutions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Institutions</SelectItem>
              {institutions.map((inst) => (
                <SelectItem key={inst.id} value={inst.id}>
                  {inst.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* ICR filter (managers only) */}
        {isManager && icrUsers.length > 0 && (
          <Select value={icrFilter} onValueChange={setIcrFilter}>
            <SelectTrigger className="h-8 w-[160px] text-sm bg-white">
              <SelectValue placeholder="All ICRs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All ICRs</SelectItem>
              {icrUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 gap-1.5 text-slate-500 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        )}

        {/* Result count */}
        <span className="text-xs text-slate-500 ml-1">
          {filteredLeads.length} lead{filteredLeads.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Views */}
      {activeTab === "kanban" ? (
        <KanbanBoard initialLeads={filteredLeads} />
      ) : (
        <LeadListView leads={filteredLeads} icrUsers={icrUsers} />
      )}

      {/* Add Lead modal */}
      <LeadForm
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        sources={sources}
        institutions={institutions}
        icrUsers={icrUsers}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
