"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, LayoutGrid, List, Search, X, AlertTriangle, CloudOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelectFilter, type MultiSelectOption } from "@/components/shared/multi-select-filter";
import { KanbanBoard } from "./kanban-board";
import { LeadListView } from "./lead-list-view";
import { LeadForm } from "./lead-form";
import type { LeadWithRelations } from "./lead-card";
import type { RecruitmentPartner, Institution, User } from "@prisma/client";
import { ALL_STAGES, STAGE_LABELS } from "@/lib/lead-pipeline";
import { NO_REGION } from "@/lib/region-scope";
import { ExportButton } from "@/components/shared/export-button";
import { displayName } from "@/lib/person-name";
import { OFFLINE_CAPTURE_WARNING } from "@/lib/offline-capture";

const LEAD_EXPORT_COLUMNS = [
  // Two columns, not one: the export feeds university application forms, which
  // ask for given and family name separately. Recombining here would throw
  // away the split the record already holds.
  { key: "firstName",         header: "First Name" },
  { key: "lastName",          header: "Last Name" },
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

const STAGE_OPTIONS: MultiSelectOption[] = ALL_STAGES.map((s) => ({
  value: s,
  label: STAGE_LABELS[s],
}));

// Sentinel for "no ICR assigned". Never "" — Radix reserves the empty string for
// the cleared state and throws when it is used as an item value.
const UNASSIGNED = "UNASSIGNED";

type Tab = "kanban" | "list";

interface StudentsClientPageProps {
  initialLeads: LeadWithRelations[];
  sources: Pick<RecruitmentPartner, "id" | "name">[];
  institutions: Pick<Institution, "id" | "name">[];
  icrUsers: Pick<User, "id" | "name" | "image">[];
  isManager: boolean;
  /** Pre-applied source (recruitment partner) filter, e.g. from a partner's
   *  "Leads" tile. Null when no source was requested. */
  initialSourceId?: string | null;
}

export function StudentsClientPage({
  initialLeads,
  sources,
  institutions,
  icrUsers,
  isManager,
  initialSourceId = null,
}: StudentsClientPageProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState<Tab>("kanban");
  const [search, setSearch] = React.useState("");
  // Each filter holds the picked values. An empty array means "no filter"
  // (show everything), so a user can tick several stages, regions, etc. at once.
  const [stageFilter, setStageFilter] = React.useState<string[]>([]);
  const [institutionFilter, setInstitutionFilter] = React.useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = React.useState<string[]>(
    initialSourceId ? [initialSourceId] : []
  );
  const [icrFilter, setIcrFilter] = React.useState<string[]>([]);
  const [regionFilter, setRegionFilter] = React.useState<string[]>([]);
  const [addModalOpen, setAddModalOpen] = React.useState(false);

  // Source options. A source arriving in the URL (e.g. from a partner's Leads
  // tile) may be an inactive partner not in the `sources` list; keep it as an
  // option, named from the leads themselves, so it can be seen and un-ticked.
  const sourceOptions = React.useMemo<MultiSelectOption[]>(() => {
    const nameById = new Map<string, string>();
    for (const s of sources) nameById.set(s.id, s.name);
    for (const l of initialLeads) if (l.source) nameById.set(l.source.id, l.source.name);
    const known = new Set(sources.map((s) => s.id));
    const opts: MultiSelectOption[] = sources.map((s) => ({ value: s.id, label: s.name }));
    for (const id of sourceFilter) {
      if (!known.has(id)) opts.push({ value: id, label: nameById.get(id) ?? "Selected source" });
    }
    return opts;
  }, [sources, initialLeads, sourceFilter]);

  const institutionOptions = React.useMemo<MultiSelectOption[]>(
    () => institutions.map((i) => ({ value: i.id, label: i.name })),
    [institutions]
  );

  // ICR and Region options are derived from the leads themselves rather than
  // from a passed-in list: a lead owned by a deactivated ICR, or sitting in a
  // region the viewer isn't the manager of, must still be filterable, and the
  // control must not vanish just because no active user holds that exact role.
  const { icrOptions, hasUnassigned, regionOptions, hasNoRegion } = React.useMemo(() => {
    const icrById = new Map<string, string>();
    const regionById = new Map<string, string>();
    let unassigned = false;
    let noRegion = false;
    for (const lead of initialLeads) {
      if (lead.assignedICRId) {
        if (!icrById.has(lead.assignedICRId)) {
          icrById.set(lead.assignedICRId, lead.assignedICR?.name ?? "Unknown user");
        }
      } else {
        unassigned = true;
      }
      if (lead.regionId && lead.region) {
        if (!regionById.has(lead.regionId)) regionById.set(lead.regionId, lead.region.name);
      } else {
        noRegion = true;
      }
    }
    const sortByName = (a: { label: string }, b: { label: string }) =>
      a.label.localeCompare(b.label);
    return {
      icrOptions: [...icrById.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort(sortByName),
      hasUnassigned: unassigned,
      regionOptions: [...regionById.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort(sortByName),
      hasNoRegion: noRegion,
    };
  }, [initialLeads]);

  const icrSelectOptions = React.useMemo<MultiSelectOption[]>(
    () => (hasUnassigned ? [...icrOptions, { value: UNASSIGNED, label: "Unassigned" }] : icrOptions),
    [icrOptions, hasUnassigned]
  );
  const regionSelectOptions = React.useMemo<MultiSelectOption[]>(
    () => (hasNoRegion ? [...regionOptions, { value: NO_REGION, label: "No region" }] : regionOptions),
    [regionOptions, hasNoRegion]
  );

  // Filtered leads. Every array filter is "match any of the picked values";
  // an empty array leaves that dimension unfiltered.
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
      if (stageFilter.length && !stageFilter.includes(lead.stage)) return false;
      if (institutionFilter.length && !(lead.institutionId && institutionFilter.includes(lead.institutionId)))
        return false;
      if (sourceFilter.length && !(lead.sourceId && sourceFilter.includes(lead.sourceId))) return false;
      if (icrFilter.length && !icrFilter.includes(lead.assignedICRId ?? UNASSIGNED)) return false;
      if (regionFilter.length && !regionFilter.includes(lead.regionId ?? NO_REGION)) return false;
      return true;
    });
  }, [initialLeads, search, stageFilter, institutionFilter, sourceFilter, icrFilter, regionFilter]);

  const hasActiveFilters =
    search !== "" ||
    stageFilter.length > 0 ||
    institutionFilter.length > 0 ||
    sourceFilter.length > 0 ||
    icrFilter.length > 0 ||
    regionFilter.length > 0;

  const exportData = React.useMemo(
    () =>
      filteredLeads.map((l) => ({
        firstName:          l.firstName,
        lastName:           l.lastName,
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
    setStageFilter([]);
    setInstitutionFilter([]);
    setSourceFilter([]);
    setIcrFilter([]);
    setRegionFilter([]);
  }

  // Show the Region filter only when more than one region is actually present
  // on screen — a single-region viewer gains nothing from a one-entry control.
  const showRegionFilter = regionSelectOptions.length > 1;
  const showSourceFilter = sourceOptions.length > 0 || sourceFilter.length > 0;
  const showIcrFilter = isManager && icrSelectOptions.length > 0;

  return (
    <div className="space-y-4">
      {/* Offline capture limit. Shown to everyone rather than only when a queue
          exists: an ICR needs to know the ceiling before they leave for an
          event, which is exactly when they have nothing queued yet. */}
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 px-3.5 py-2.5">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
          {OFFLINE_CAPTURE_WARNING}
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        {/* Tab switcher */}
        <div className="flex items-center rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-0.5 gap-0.5 w-fit">
          <button
            onClick={() => setActiveTab("kanban")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
              activeTab === "kanban"
                ? "bg-[#1E3A5F] text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
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
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
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
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <Link href="/students/offline">
              <CloudOff className="h-4 w-4" />
              Offline Capture
            </Link>
          </Button>
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
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <Input
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm bg-white dark:bg-slate-900"
          />
        </div>

        {/* Stage filter */}
        <MultiSelectFilter
          allLabel="All Stages"
          noun="stages"
          options={STAGE_OPTIONS}
          selected={stageFilter}
          onChange={setStageFilter}
          className="w-[160px]"
          ariaLabel="Filter by stage"
        />

        {/* Institution filter */}
        {institutionOptions.length > 0 && (
          <MultiSelectFilter
            allLabel="All Institutions"
            noun="institutions"
            options={institutionOptions}
            selected={institutionFilter}
            onChange={setInstitutionFilter}
            className="w-[180px]"
            ariaLabel="Filter by institution"
          />
        )}

        {/* Region filter (only when several regions are in view) */}
        {showRegionFilter && (
          <MultiSelectFilter
            allLabel="All Regions"
            noun="regions"
            options={regionSelectOptions}
            selected={regionFilter}
            onChange={setRegionFilter}
            className="w-[160px]"
            ariaLabel="Filter by region"
          />
        )}

        {/* Source filter. Rendered whenever a source filter is in effect (e.g.
            arriving from a partner's Leads tile) even if that partner is not in
            the active-partner list, so it can always be seen and cleared. */}
        {showSourceFilter && (
          <MultiSelectFilter
            allLabel="All Sources"
            noun="sources"
            options={sourceOptions}
            selected={sourceFilter}
            onChange={setSourceFilter}
            className="w-[180px]"
            ariaLabel="Filter by source"
          />
        )}

        {/* ICR filter (managers only — an ICR is already scoped to their own
            leads, so the dropdown would have exactly one entry for them) */}
        {showIcrFilter && (
          <MultiSelectFilter
            allLabel="All ICRs"
            noun="ICRs"
            options={icrSelectOptions}
            selected={icrFilter}
            onChange={setIcrFilter}
            className="w-[160px]"
            ariaLabel="Filter by assigned ICR"
          />
        )}

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 gap-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        )}

        {/* Result count */}
        <span className="text-xs text-slate-500 dark:text-slate-400 ml-1">
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
