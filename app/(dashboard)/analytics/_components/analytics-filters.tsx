"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Filters for the executive analytics dashboard.
 *
 * ── MOST OF THIS WAS ALREADY BUILT ──────────────────────────────────────────
 *
 * /api/analytics/overview has accepted `regionId` and `institutionId` for a
 * long time and nothing ever sent them, so the only filter anyone could reach
 * was the date range. Same pattern as the partners, events and campaigns lists,
 * where a `q` parameter was honoured by the query with no input on screen.
 *
 * `icrId` is genuinely new. The route refuses it for an ICR, whose scope
 * already pins the query to their own leads — honouring it there would let one
 * ICR read a colleague's numbers.
 *
 * ── WHY REGION IS HIDDEN FROM SOME ROLES ────────────────────────────────────
 *
 * The API only honours `regionId` for SUPER_ADMIN and the two HQ roles. A
 * Regional Manager is already pinned to their own region, so offering them the
 * control would be a box that appears to work and changes nothing.
 */

export type Option = { id: string; name: string };

export const DATE_RANGES = [
  { value: "30d", label: "Last 30 Days" },
  { value: "3m", label: "Last 3 Months" },
  { value: "6m", label: "Last 6 Months" },
  { value: "ytd", label: "Year to Date" },
  { value: "1y", label: "Last Year" },
  { value: "custom", label: "Custom range…" },
];

export interface AnalyticsFilterState {
  dateRange: string;
  /** Only meaningful while dateRange is "custom". */
  from: string;
  to: string;
  regionId: string;
  institutionId: string;
  icrId: string;
}

export const EMPTY_FILTERS: AnalyticsFilterState = {
  dateRange: "ytd",
  from: "",
  to: "",
  regionId: "all",
  institutionId: "all",
  icrId: "all",
};

export function AnalyticsFilters({
  value,
  onChange,
  regions,
  institutions,
  icrs,
  canFilterRegion,
}: {
  value: AnalyticsFilterState;
  onChange: (next: AnalyticsFilterState) => void;
  regions: Option[];
  institutions: Option[];
  icrs: Option[];
  /** False for a Regional Manager, who is already pinned to one region. */
  canFilterRegion: boolean;
}) {
  const set = (patch: Partial<AnalyticsFilterState>) => onChange({ ...value, ...patch });

  const dirty =
    value.dateRange !== EMPTY_FILTERS.dateRange ||
    value.regionId !== "all" ||
    value.institutionId !== "all" ||
    value.icrId !== "all";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value.dateRange} onValueChange={(v) => set({ dateRange: v })}>
        <SelectTrigger className="w-44" aria-label="Date range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_RANGES.map((r) => (
            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Only while "Custom range…" is chosen, so the bar stays short the rest
          of the time. */}
      {value.dateRange === "custom" && (
        <div className="flex items-center gap-1.5">
          <Label htmlFor="an-from" className="text-xs text-muted-foreground">From</Label>
          <Input
            id="an-from"
            type="date"
            value={value.from}
            onChange={(e) => set({ from: e.target.value })}
            className="h-9 w-[150px] text-sm"
            aria-label="From date"
          />
          <Label htmlFor="an-to" className="text-xs text-muted-foreground">To</Label>
          <Input
            id="an-to"
            type="date"
            value={value.to}
            onChange={(e) => set({ to: e.target.value })}
            className="h-9 w-[150px] text-sm"
            aria-label="To date"
          />
        </div>
      )}

      {canFilterRegion && regions.length > 0 && (
        <Select value={value.regionId} onValueChange={(v) => set({ regionId: v })}>
          <SelectTrigger className="h-9 w-[150px] text-sm" aria-label="Region">
            <SelectValue placeholder="Region" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            {regions.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {institutions.length > 0 && (
        <Select value={value.institutionId} onValueChange={(v) => set({ institutionId: v })}>
          <SelectTrigger className="h-9 w-[170px] text-sm" aria-label="Client">
            <SelectValue placeholder="Client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {institutions.map((i) => (
              <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {icrs.length > 0 && (
        <Select value={value.icrId} onValueChange={(v) => set({ icrId: v })}>
          <SelectTrigger className="h-9 w-[160px] text-sm" aria-label="ICR">
            <SelectValue placeholder="ICR" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ICRs</SelectItem>
            {icrs.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {dirty && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="h-9 gap-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
