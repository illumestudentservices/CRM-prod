"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Filters for the quarterly plans list.
 *
 * ── SERVER-SIDE, LIKE THE PARTNERS LIST ─────────────────────────────────────
 *
 * The plans query is capped with `take: 100`. Filtering the fetched rows in the
 * browser would search only that page and report anything past the cap as not
 * existing, which is worse than no filter at all.
 *
 * ── THE OPTIONS ARE NOT A FIXED LIST ────────────────────────────────────────
 *
 * Years, ICRs, clients and markets are all passed in from the server, and the
 * server derives them from THE ROWS THAT USER IS ALLOWED TO SEE. The plans list
 * is row-scoped — an ICR sees only their own plans, a regional manager only
 * their region — so building these lists from every plan in the database would
 * leak the names of clients and colleagues through a dropdown to someone who
 * cannot open a single one of those records.
 */

export interface PlanFilterOptions {
  statuses: { value: string; label: string }[];
  years: number[];
  /** Empty for an ICR, who only ever sees their own plans. */
  icrs: { id: string; name: string }[];
  institutions: { id: string; name: string }[];
  markets: { id: string; name: string }[];
}

const ALL = "all";
const QUARTERS = [1, 2, 3, 4];

export function PlanFilters({
  statuses,
  years,
  icrs,
  institutions,
  markets,
}: PlanFilterOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const get = (k: string) => params.get(k) ?? ALL;

  const apply = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === ALL) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const KEYS = ["status", "year", "quarter", "icr", "institution", "market"];
  const active = KEYS.some((k) => params.get(k) && params.get(k) !== ALL);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={get("status")} onValueChange={(v) => apply("status", v)}>
        <SelectTrigger className="h-9 w-[165px] text-sm" aria-label="Plan status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {statuses.map((s) => (
            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {years.length > 0 && (
        <Select value={get("year")} onValueChange={(v) => apply("year", v)}>
          <SelectTrigger className="h-9 w-[120px] text-sm" aria-label="Plan year">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All years</SelectItem>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={get("quarter")} onValueChange={(v) => apply("quarter", v)}>
        <SelectTrigger className="h-9 w-[130px] text-sm" aria-label="Plan quarter">
          <SelectValue placeholder="Quarter" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All quarters</SelectItem>
          {QUARTERS.map((q) => (
            <SelectItem key={q} value={String(q)}>{`Q${q}`}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Absent for an ICR: they only ever see their own plans, so the control
          would offer exactly one choice and filter nothing. */}
      {icrs.length > 0 && (
        <Select value={get("icr")} onValueChange={(v) => apply("icr", v)}>
          <SelectTrigger className="h-9 w-[160px] text-sm" aria-label="Plan ICR">
            <SelectValue placeholder="ICR" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All ICRs</SelectItem>
            {icrs.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {institutions.length > 0 && (
        <Select value={get("institution")} onValueChange={(v) => apply("institution", v)}>
          <SelectTrigger className="h-9 w-[170px] text-sm" aria-label="Plan client">
            <SelectValue placeholder="Client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All clients</SelectItem>
            {institutions.map((i) => (
              <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {markets.length > 0 && (
        <Select value={get("market")} onValueChange={(v) => apply("market", v)}>
          <SelectTrigger className="h-9 w-[160px] text-sm" aria-label="Plan market">
            <SelectValue placeholder="Market" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All markets</SelectItem>
            {markets.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(pathname)}
          className="h-9 gap-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
