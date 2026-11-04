"use client";

import * as React from "react";
import { Building2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MultiSelectFilter, type MultiSelectOption } from "@/components/shared/multi-select-filter";
import { StatCard } from "@/components/shared/stat-card";
import { InstitutionCard } from "./institution-card";
import { cn } from "@/lib/utils";
import { HEALTH_LABELS, HEALTH_ORDER, HEALTH_PILL } from "@/lib/account-health";
import type { AccountStatus, AccountHealth } from "@prisma/client";

const STATUS_OPTIONS: MultiSelectOption[] = [
  { value: "PROSPECT", label: "Prospect" },
  { value: "ONBOARDING", label: "Onboarding" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "CLOSED", label: "Closed" },
];

const TYPE_OPTIONS: MultiSelectOption[] = [
  { value: "University", label: "University" },
  { value: "College", label: "College" },
  { value: "Institute", label: "Institute" },
  { value: "Other", label: "Other" },
];

// ─── Types ─────────────────────────────────────────────────────────────────

export interface InstitutionRow {
  id: string;
  name: string;
  country: string;
  type: string;
  logoUrl: string | null;
  accountStatus: AccountStatus;
  leadsCount: number;
  contractsCount: number;
  usersCount: number;
  openIssuesCount?: number;
  accountHealth?: string | null;
  renewalDate?: string | null;
  /// Set server-side with the same rule as the "Renewal Due" card (ACTIVE
  /// contract expiring within 90 days) so the card and its filter agree.
  renewalDue?: boolean;
  regionId: string | null;
  regionName: string | null;
  /// Every region worked, primary first. Drives both the card's region line and
  /// the region filter — see the note on the filter below.
  regionIds?: string[];
  regionNames?: string[];
  website?: string | null;
  /// Spec §1 (Clients) — Account Manager column supports the AM filter.
  accountManagerId?: string | null;
  accountManagerName?: string | null;
}

interface InstitutionStats {
  total: number;
  active: number;
  renewalDue: number;
  prospects: number;
  /// Spec §9 — Open Issues stat card.
  openIssues?: number;
  /// Client HPI counts, by rating. Optional so an older caller still renders.
  health?: Record<AccountHealth, number>;
}

interface InstitutionsClientProps {
  institutions: InstitutionRow[];
  regions: { id: string; name: string }[];
  /// Spec §1 (Clients) — AM filter dropdown.
  accountManagers?: { id: string; name: string | null }[];
  /// Spec §1 (Clients) — Country filter dropdown (derived from the institutions list).
  stats: InstitutionStats;
  /// When false, the figures (summary stat cards, health breakdown, and the
  /// per-client counts/status) are hidden — read-only roles like ICR see the
  /// client list and details only, not the commercial numbers.
  showFigures?: boolean;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function InstitutionsClient({
  institutions,
  regions,
  accountManagers = [],
  stats,
  showFigures = true,
}: InstitutionsClientProps) {
  // Each filter holds the picked values; an empty array means "no filter"
  // (show everything), so several statuses, regions, countries, etc. can be
  // ticked at once.
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);
  const [typeFilter, setTypeFilter] = React.useState<string[]>([]);
  const [regionFilter, setRegionFilter] = React.useState<string[]>([]);
  const [countryFilter, setCountryFilter] = React.useState<string[]>([]);
  const [accountManagerFilter, setAccountManagerFilter] = React.useState<string[]>([]);
  const [healthFilter, setHealthFilter] = React.useState<string[]>([]);
  // Two card-driven toggles that aren't account statuses: "Renewal Due" (a
  // computed contract alert) and "Open Issues" (clients with >0 open issues).
  const [renewalDueOnly, setRenewalDueOnly] = React.useState(false);
  const [openIssuesOnly, setOpenIssuesOnly] = React.useState(false);

  // Derived country list from the loaded institutions — keeps the filter
  // tight to what's actually present.
  const countries = React.useMemo(() => {
    const uniq = new Set<string>();
    institutions.forEach((i) => i.country && uniq.add(i.country));
    return Array.from(uniq).sort();
  }, [institutions]);

  const regionOptions = React.useMemo<MultiSelectOption[]>(
    () => regions.map((r) => ({ value: r.id, label: r.name })),
    [regions]
  );
  const countryOptions = React.useMemo<MultiSelectOption[]>(
    () => countries.map((c) => ({ value: c, label: c })),
    [countries]
  );
  const healthOptions = React.useMemo<MultiSelectOption[]>(
    () => HEALTH_ORDER.map((h) => ({ value: h, label: HEALTH_LABELS[h].sentiment })),
    []
  );
  const accountManagerOptions = React.useMemo<MultiSelectOption[]>(
    () => accountManagers.map((am) => ({ value: am.id, label: am.name ?? am.id })),
    [accountManagers]
  );

  const filtered = React.useMemo(() => {
    const q = search.toLowerCase();
    return institutions.filter((inst) => {
      if (q && !inst.name.toLowerCase().includes(q) && !inst.country.toLowerCase().includes(q)) {
        return false;
      }
      if (statusFilter.length && !statusFilter.includes(inst.accountStatus)) return false;
      if (typeFilter.length && !typeFilter.includes(inst.type)) return false;
      // Matches ANY region the client is worked in, not only the primary one.
      // Filtering on the primary meant a Regional Manager for Southeast Asia
      // could not see Acadia — a client their region actively works — because
      // Africa happened to be the first region ticked when it was imported.
      // Falls back to the primary for rows that predate the join table.
      if (regionFilter.length) {
        const worked = inst.regionIds?.length ? inst.regionIds : [inst.regionId];
        if (!worked.some((w) => w && regionFilter.includes(w))) return false;
      }
      if (countryFilter.length && !countryFilter.includes(inst.country)) return false;
      if (
        accountManagerFilter.length &&
        !(inst.accountManagerId && accountManagerFilter.includes(inst.accountManagerId))
      )
        return false;
      if (healthFilter.length && !healthFilter.includes(inst.accountHealth ?? "GREY")) return false;
      if (renewalDueOnly && !inst.renewalDue) return false;
      if (openIssuesOnly && !((inst.openIssuesCount ?? 0) > 0)) return false;
      return true;
    });
  }, [institutions, search, statusFilter, typeFilter, regionFilter, countryFilter, accountManagerFilter, healthFilter, renewalDueOnly, openIssuesOnly]);

  // Each card is one of four kinds:
  //  clear  — Total Clients: drop every card filter (was broken: it set the
  //           status to the non-existent value "all", emptying the grid).
  //  status — Active / Prospects: toggle an account-status filter.
  //  renewal — Renewal Due: toggle the computed renewal-due filter.
  //  issues — Open Issues: toggle "clients with open issues".
  const statCards = [
    { title: "Total Clients", value: stats.total,      icon: "Building2" as const,   iconColor: "text-[#1E3A5F] dark:text-blue-300",  iconBg: "bg-[#1E3A5F]/10 dark:bg-blue-500/15", kind: "clear" as const },
    { title: "Active",        value: stats.active,     icon: "CheckCircle" as const, iconColor: "text-green-600 dark:text-green-300",  iconBg: "bg-green-50 dark:bg-green-500/15",   kind: "status" as const, status: "ACTIVE" },
    { title: "Renewal Due",   value: stats.renewalDue, icon: "AlertCircle" as const, iconColor: "text-amber-600 dark:text-amber-300",  iconBg: "bg-amber-50 dark:bg-amber-500/15",   kind: "renewal" as const },
    { title: "Prospects",     value: stats.prospects,  icon: "XCircle" as const,     iconColor: "text-slate-500 dark:text-slate-300", iconBg: "bg-slate-50 dark:bg-slate-800",      kind: "status" as const, status: "PROSPECT" },
    ...(stats.openIssues !== undefined
      ? [{ title: "Open Issues", value: stats.openIssues, icon: "AlertCircle" as const, iconColor: "text-rose-600 dark:text-rose-300", iconBg: "bg-rose-50 dark:bg-rose-500/15", kind: "issues" as const }]
      : []),
  ];

  function cardActive(card: (typeof statCards)[number]): boolean {
    switch (card.kind) {
      case "clear":   return statusFilter.length === 0 && !renewalDueOnly && !openIssuesOnly;
      case "status":  return !renewalDueOnly && !openIssuesOnly && statusFilter.includes(card.status);
      case "renewal": return renewalDueOnly;
      case "issues":  return openIssuesOnly;
    }
  }
  function cardClick(card: (typeof statCards)[number]) {
    switch (card.kind) {
      case "clear":
        setStatusFilter([]); setRenewalDueOnly(false); setOpenIssuesOnly(false); break;
      case "status":
        setRenewalDueOnly(false); setOpenIssuesOnly(false);
        setStatusFilter((prev) => (prev.length === 1 && prev[0] === card.status ? [] : [card.status]));
        break;
      case "renewal":
        setStatusFilter([]); setOpenIssuesOnly(false); setRenewalDueOnly((v) => !v); break;
      case "issues":
        setStatusFilter([]); setRenewalDueOnly(false); setOpenIssuesOnly((v) => !v); break;
    }
  }

  return (
    <div className="space-y-4">
      {/* Stat Cards — figures, hidden from read-only roles like ICR. */}
      {showFigures && (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <StatCard
            key={card.title}
            title={card.title}
            value={card.value}
            icon={card.icon}
            iconColor={card.iconColor}
            iconBg={card.iconBg}
            className={cn(
              "cursor-pointer transition-all",
              cardActive(card) && "ring-2 ring-[#1E3A5F] ring-offset-1"
            )}
            onClick={() => cardClick(card)}
          />
        ))}
      </div>
      )}

      {/*
        How the book of business is feeling, as a single strip.

        Four more StatCards would have pushed the real ones onto a second row
        and given equal visual weight to "12 clients are fine" and "35 clients
        exist". This reads left to right as a health bar, and each segment is a
        filter — clicking "Concerned" shows exactly those clients, which is the
        question this data gets opened for.
      */}
      {showFigures && stats.health && (
        <div className="flex flex-wrap items-center gap-2" data-testid="health-summary">
          {HEALTH_ORDER.map((h) => {
            const count = stats.health![h];
            if (!count) return null;
            const on = healthFilter.includes(h);
            return (
              <button
                key={h}
                type="button"
                onClick={() =>
                  setHealthFilter((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]))
                }
                aria-pressed={on}
                title={HEALTH_LABELS[h].hint}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                  HEALTH_PILL[h],
                  on ? "ring-2 ring-[#1E3A5F] dark:ring-blue-400 ring-offset-1 dark:ring-offset-slate-950" : "hover:opacity-80"
                )}
              >
                <span className="tabular-nums font-semibold">{count}</span>
                {HEALTH_LABELS[h].sentiment}
              </button>
            );
          })}
          {healthFilter.length > 0 && (
            <button
              type="button"
              onClick={() => setHealthFilter([])}
              className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <Input
            placeholder="Search by name or country…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        <MultiSelectFilter
          allLabel="All Statuses"
          noun="statuses"
          options={STATUS_OPTIONS}
          selected={statusFilter}
          onChange={setStatusFilter}
          className="h-9 w-[150px]"
          ariaLabel="Filter by status"
        />

        <MultiSelectFilter
          allLabel="All Types"
          noun="types"
          options={TYPE_OPTIONS}
          selected={typeFilter}
          onChange={setTypeFilter}
          className="h-9 w-[140px]"
          ariaLabel="Filter by type"
        />

        {regionOptions.length > 0 && (
          <MultiSelectFilter
            allLabel="All Regions"
            noun="regions"
            options={regionOptions}
            selected={regionFilter}
            onChange={setRegionFilter}
            className="h-9 w-[150px]"
            ariaLabel="Filter by region"
          />
        )}

        {countryOptions.length > 0 && (
          <MultiSelectFilter
            allLabel="All Countries"
            noun="countries"
            options={countryOptions}
            selected={countryFilter}
            onChange={setCountryFilter}
            className="h-9 w-[150px]"
            ariaLabel="Filter by country"
          />
        )}

        {/* The strip above is the quick way in; this exists so the health filter
            is discoverable in the same place as every other filter, and so it
            can select Not assessed, which the strip hides when nobody holds it. */}
        <MultiSelectFilter
          allLabel="All HPI"
          noun="HPI"
          options={healthOptions}
          selected={healthFilter}
          onChange={setHealthFilter}
          className="h-9 w-[160px]"
          ariaLabel="Filter by client HPI"
        />

        {accountManagerOptions.length > 0 && (
          <MultiSelectFilter
            allLabel="All Account Managers"
            noun="managers"
            options={accountManagerOptions}
            selected={accountManagerFilter}
            onChange={setAccountManagerFilter}
            className="h-9 w-[170px]"
            ariaLabel="Filter by account manager"
          />
        )}
      </div>

      {/* Results count. Every filter has to be listed here — country, account
          manager and health were all able to shrink the grid without saying so,
          which reads as missing data rather than an active filter. */}
      {(search ||
        statusFilter.length > 0 ||
        typeFilter.length > 0 ||
        regionFilter.length > 0 ||
        countryFilter.length > 0 ||
        accountManagerFilter.length > 0 ||
        healthFilter.length > 0 ||
        renewalDueOnly ||
        openIssuesOnly) && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Showing {filtered.length} of {institutions.length} clients
          {renewalDueOnly && " · renewal due"}
          {openIssuesOnly && " · with open issues"}
        </p>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-full text-center py-16 text-slate-400 dark:text-slate-500">
            <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No institutions match your filters</p>
            <p className="text-xs mt-1">Try adjusting your search or filter criteria.</p>
          </div>
        ) : (
          filtered.map((institution) => (
            <InstitutionCard
              key={institution.id}
              institution={{
                ...institution,
                // The Client Relations owner from the client list is stored as
                // the account manager, which is the field the rest of the app
                // already treats as "who owns this client".
                ownerName: institution.accountManagerName ?? null,
              }}
              showFigures={showFigures}
            />
          ))
        )}
      </div>
    </div>
  );
}
