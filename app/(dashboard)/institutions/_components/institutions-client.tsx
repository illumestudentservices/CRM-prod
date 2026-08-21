"use client";

import * as React from "react";
import { Building2, Search, CheckCircle, AlertCircle, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/shared/stat-card";
import { InstitutionCard } from "./institution-card";
import { cn } from "@/lib/utils";
import { HEALTH_LABELS, HEALTH_ORDER, HEALTH_PILL } from "@/lib/account-health";
import type { AccountStatus, AccountHealth } from "@prisma/client";

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
}

// ─── Component ─────────────────────────────────────────────────────────────

export function InstitutionsClient({
  institutions,
  regions,
  accountManagers = [],
  stats,
}: InstitutionsClientProps) {
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [typeFilter, setTypeFilter] = React.useState("all");
  const [regionFilter, setRegionFilter] = React.useState("all");
  const [countryFilter, setCountryFilter] = React.useState("all");
  const [accountManagerFilter, setAccountManagerFilter] = React.useState("all");
  const [healthFilter, setHealthFilter] = React.useState("all");

  // Derived country list from the loaded institutions — keeps the filter
  // tight to what's actually present.
  const countries = React.useMemo(() => {
    const uniq = new Set<string>();
    institutions.forEach((i) => i.country && uniq.add(i.country));
    return Array.from(uniq).sort();
  }, [institutions]);

  const filtered = React.useMemo(() => {
    const q = search.toLowerCase();
    return institutions.filter((inst) => {
      if (q && !inst.name.toLowerCase().includes(q) && !inst.country.toLowerCase().includes(q)) {
        return false;
      }
      if (statusFilter !== "all" && inst.accountStatus !== statusFilter) return false;
      if (typeFilter !== "all" && inst.type !== typeFilter) return false;
      // Matches ANY region the client is worked in, not only the primary one.
      // Filtering on the primary meant a Regional Manager for Southeast Asia
      // could not see Acadia — a client their region actively works — because
      // Africa happened to be the first region ticked when it was imported.
      // Falls back to the primary for rows that predate the join table.
      if (regionFilter !== "all") {
        const worked = inst.regionIds?.length ? inst.regionIds : [inst.regionId];
        if (!worked.includes(regionFilter)) return false;
      }
      if (countryFilter !== "all" && inst.country !== countryFilter) return false;
      if (accountManagerFilter !== "all" && inst.accountManagerId !== accountManagerFilter) return false;
      if (healthFilter !== "all" && (inst.accountHealth ?? "GREY") !== healthFilter) return false;
      return true;
    });
  }, [institutions, search, statusFilter, typeFilter, regionFilter, countryFilter, accountManagerFilter, healthFilter]);

  const statCards = [
    { title: "Total Clients", value: stats.total,      icon: "Building2" as const, iconColor: "text-[#1E3A5F] dark:text-blue-300",  iconBg: "bg-[#1E3A5F]/10 dark:bg-blue-500/15", status: "all" },
    { title: "Active",        value: stats.active,     icon: "CheckCircle" as const, iconColor: "text-green-600 dark:text-green-300", iconBg: "bg-green-50 dark:bg-green-500/15",   status: "ACTIVE" },
    // Spec §1 — Renewal Due is a computed alert from contract dates, not a
    // client status. Clicking the card no longer filters by a RENEWAL_DUE
    // enum value; it's information-only.
    { title: "Renewal Due",   value: stats.renewalDue, icon: "AlertCircle" as const, iconColor: "text-amber-600 dark:text-amber-300", iconBg: "bg-amber-50 dark:bg-amber-500/15",   status: null as string | null },
    { title: "Prospects",     value: stats.prospects,  icon: "XCircle" as const,     iconColor: "text-slate-500 dark:text-slate-300", iconBg: "bg-slate-50 dark:bg-slate-800",   status: "PROSPECT" },
    // Spec §9 — Open Issues card (Clients module).
    ...(stats.openIssues !== undefined
      ? [{ title: "Open Issues", value: stats.openIssues, icon: "AlertCircle" as const, iconColor: "text-rose-600 dark:text-rose-300", iconBg: "bg-rose-50 dark:bg-rose-500/15", status: null as string | null }]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Stat Cards */}
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
              card.status !== null && "cursor-pointer transition-all",
              card.status !== null && statusFilter === card.status && "ring-2 ring-[#1E3A5F] ring-offset-1"
            )}
            onClick={
              card.status !== null
                ? () => setStatusFilter(statusFilter === card.status ? "all" : (card.status ?? "all"))
                : undefined
            }
          />
        ))}
      </div>

      {/*
        How the book of business is feeling, as a single strip.

        Four more StatCards would have pushed the real ones onto a second row
        and given equal visual weight to "12 clients are fine" and "35 clients
        exist". This reads left to right as a health bar, and each segment is a
        filter — clicking "Concerned" shows exactly those clients, which is the
        question this data gets opened for.
      */}
      {stats.health && (
        <div className="flex flex-wrap items-center gap-2" data-testid="health-summary">
          {HEALTH_ORDER.map((h) => {
            const count = stats.health![h];
            if (!count) return null;
            const on = healthFilter === h;
            return (
              <button
                key={h}
                type="button"
                onClick={() => setHealthFilter(on ? "all" : h)}
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
          {healthFilter !== "all" && (
            <button
              type="button"
              onClick={() => setHealthFilter("all")}
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

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[150px] text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="PROSPECT">Prospect</SelectItem>
            <SelectItem value="ONBOARDING">Onboarding</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
            <SelectItem value="SUSPENDED">Suspended</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-9 w-[140px] text-sm">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="University">University</SelectItem>
            <SelectItem value="College">College</SelectItem>
            <SelectItem value="Institute">Institute</SelectItem>
            <SelectItem value="Other">Other</SelectItem>
          </SelectContent>
        </Select>

        {regions.length > 0 && (
          <Select value={regionFilter} onValueChange={setRegionFilter}>
            <SelectTrigger className="h-9 w-[150px] text-sm">
              <SelectValue placeholder="Region" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Regions</SelectItem>
              {regions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {countries.length > 0 && (
          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger className="h-9 w-[150px] text-sm">
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Countries</SelectItem>
              {countries.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* The strip above is the quick way in; this exists so the health filter
            is discoverable in the same place as every other filter, and so it
            can select Not assessed, which the strip hides when nobody holds it. */}
        <Select value={healthFilter} onValueChange={setHealthFilter}>
          <SelectTrigger className="h-9 w-[160px] text-sm">
            <SelectValue placeholder="Client HPI" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All HPI</SelectItem>
            {HEALTH_ORDER.map((h) => (
              <SelectItem key={h} value={h}>
                {HEALTH_LABELS[h].sentiment}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {accountManagers.length > 0 && (
          <Select value={accountManagerFilter} onValueChange={setAccountManagerFilter}>
            <SelectTrigger className="h-9 w-[170px] text-sm">
              <SelectValue placeholder="Account Manager" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Account Managers</SelectItem>
              {accountManagers.map((am) => (
                <SelectItem key={am.id} value={am.id}>
                  {am.name ?? am.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Results count. Every filter has to be listed here — country, account
          manager and health were all able to shrink the grid without saying so,
          which reads as missing data rather than an active filter. */}
      {(search ||
        statusFilter !== "all" ||
        typeFilter !== "all" ||
        regionFilter !== "all" ||
        countryFilter !== "all" ||
        accountManagerFilter !== "all" ||
        healthFilter !== "all") && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Showing {filtered.length} of {institutions.length} clients
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
            />
          ))
        )}
      </div>
    </div>
  );
}
