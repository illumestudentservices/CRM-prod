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
import type { AccountStatus } from "@prisma/client";

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
  regionId: string | null;
  regionName: string | null;
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
      if (regionFilter !== "all" && inst.regionId !== regionFilter) return false;
      if (countryFilter !== "all" && inst.country !== countryFilter) return false;
      if (accountManagerFilter !== "all" && inst.accountManagerId !== accountManagerFilter) return false;
      return true;
    });
  }, [institutions, search, statusFilter, typeFilter, regionFilter, countryFilter, accountManagerFilter]);

  const statCards = [
    { title: "Total Clients", value: stats.total,      icon: "Building2" as const, iconColor: "text-[#1E3A5F]",  iconBg: "bg-[#1E3A5F]/10", status: "all" },
    { title: "Active",        value: stats.active,     icon: "CheckCircle" as const, iconColor: "text-green-600", iconBg: "bg-green-50",   status: "ACTIVE" },
    // Spec §1 — Renewal Due is a computed alert from contract dates, not a
    // client status. Clicking the card no longer filters by a RENEWAL_DUE
    // enum value; it's information-only.
    { title: "Renewal Due",   value: stats.renewalDue, icon: "AlertCircle" as const, iconColor: "text-amber-600", iconBg: "bg-amber-50",   status: null as string | null },
    { title: "Prospects",     value: stats.prospects,  icon: "XCircle" as const,     iconColor: "text-slate-500", iconBg: "bg-slate-50",   status: "PROSPECT" },
    // Spec §9 — Open Issues card (Clients module).
    ...(stats.openIssues !== undefined
      ? [{ title: "Open Issues", value: stats.openIssues, icon: "AlertCircle" as const, iconColor: "text-rose-600", iconBg: "bg-rose-50", status: null as string | null }]
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

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
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

      {/* Results count */}
      {(search || statusFilter !== "all" || typeFilter !== "all" || regionFilter !== "all") && (
        <p className="text-xs text-slate-500">
          Showing {filtered.length} of {institutions.length} institutions
        </p>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-full text-center py-16 text-slate-400">
            <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No institutions match your filters</p>
            <p className="text-xs mt-1">Try adjusting your search or filter criteria.</p>
          </div>
        ) : (
          filtered.map((institution) => (
            <InstitutionCard key={institution.id} institution={institution} />
          ))
        )}
      </div>
    </div>
  );
}
