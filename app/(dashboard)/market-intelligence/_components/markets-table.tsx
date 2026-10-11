"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/**
 * The markets table, with a way to find a row.
 *
 * Extracted from the page so it can hold state: the page is a server
 * component and the table had no search, no filters and no empty state — on a
 * screen that lists every country Illume recruits from.
 */

export interface MarketRow {
  id: string;
  name: string;
  countryCode: string | null;
  priority: string | null;
  potential: string | null;
  politicalRiskLevel: string;
  regionalManager: { id: string; name: string | null } | null;
  schools: number;
  activities: number;
  pendingUpdates: number;
}

const ANY = "__any__";

function priorityClass(p: string | null) {
  if (p === "HIGH") return "text-xs px-2 py-0.5 bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300 rounded";
  if (p === "MEDIUM") return "text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 dark:bg-amber-500/15 dark:text-amber-300 rounded";
  return "text-xs px-2 py-0.5 bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-200 rounded";
}

export function MarketsTable({ markets }: { markets: MarketRow[] }) {
  const [search, setSearch] = React.useState("");
  const [priority, setPriority] = React.useState(ANY);
  const [risk, setRisk] = React.useState(ANY);

  const priorities = React.useMemo(
    () => [...new Set(markets.map((m) => m.priority).filter(Boolean) as string[])].sort(),
    [markets],
  );
  const risks = React.useMemo(
    () => [...new Set(markets.map((m) => m.politicalRiskLevel).filter(Boolean))].sort(),
    [markets],
  );

  const q = search.trim().toLowerCase();
  const shown = React.useMemo(
    () => markets.filter((m) => {
      if (priority !== ANY && m.priority !== priority) return false;
      if (risk !== ANY && m.politicalRiskLevel !== risk) return false;
      if (!q) return true;
      return [
        m.name, m.countryCode ?? "", m.priority ?? "", m.potential ?? "",
        m.politicalRiskLevel, m.regionalManager?.name ?? "",
      ].join(" ").toLowerCase().includes(q);
    }),
    [markets, q, priority, risk],
  );

  const filtersOn = priority !== ANY || risk !== ANY;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search market, country, manager…"
            className="pl-9 h-9 w-72"
          />
        </div>

        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="h-9 w-[160px]">
            <SelectValue placeholder="All priorities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All priorities</SelectItem>
            {priorities.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={risk} onValueChange={setRisk}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="All risk levels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All risk levels</SelectItem>
            {risks.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>

        {(filtersOn || q) && (
          <button
            type="button"
            className="h-9 px-3 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => { setSearch(""); setPriority(ANY); setRisk(ANY); }}
          >
            Clear
          </button>
        )}

        <span className="text-sm text-muted-foreground ml-auto">
          {shown.length} of {markets.length}
        </span>
      </div>

      <table className="w-full text-sm border">
        <thead className="bg-muted">
          <tr>
            <th className="text-left p-2">Market</th>
            <th className="text-left p-2">Country</th>
            <th className="text-left p-2">Priority</th>
            <th className="text-left p-2">Potential</th>
            <th className="text-left p-2">Risk</th>
            <th className="text-left p-2">RM</th>
            <th className="text-left p-2">Schools</th>
            <th className="text-left p-2">Field Ops</th>
            <th className="text-left p-2">Pending updates</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={9} className="p-8 text-center text-muted-foreground">
                {markets.length === 0
                  ? "No markets yet."
                  : `No markets match${q ? ` “${search}”` : " these filters"}.`}
              </td>
            </tr>
          ) : shown.map((m) => (
            <tr key={m.id} className="border-t hover:bg-muted/50">
              <td className="p-2">
                <Link href={`/market-intelligence/${m.id}`} className="text-blue-600 hover:underline">
                  {m.name}
                </Link>
              </td>
              <td className="p-2">{m.countryCode ?? "—"}</td>
              <td className="p-2"><span className={priorityClass(m.priority)}>{m.priority ?? "—"}</span></td>
              <td className="p-2">{m.potential ?? "—"}</td>
              <td className="p-2">{m.politicalRiskLevel}</td>
              <td className="p-2">{m.regionalManager?.name ?? "—"}</td>
              <td className="p-2">{m.schools}</td>
              <td className="p-2">{m.activities}</td>
              <td className="p-2">
                {m.pendingUpdates > 0 && (
                  <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-sky-500/15 dark:text-sky-300 rounded">
                    {m.pendingUpdates}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
