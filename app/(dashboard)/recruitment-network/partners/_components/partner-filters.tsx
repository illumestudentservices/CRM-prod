"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelectFilter, type MultiSelectOption } from "@/components/shared/multi-select-filter";

/**
 * Filters for the recruitment partners list.
 *
 * ── WHY THESE FILTER ON THE SERVER, UNLIKE INSTITUTIONS AND STUDENTS ────────
 *
 * Those two pages load every row and filter the array in the browser. That is
 * fine for them. It is not fine here, because this page caps its query at 300
 * rows — the test database already holds 259 partners. Filtering the loaded
 * page in the browser would quietly search only the first 300 by name, so a
 * partner sitting at position 301 would be reported as not existing. A list
 * that confidently shows "no matches" is worse than a slow one.
 *
 * So every filter is a URL parameter and the query runs against the database.
 * The cost is a round trip per change; the page is already `force-dynamic` and
 * server-filtered by tab and search, so this is the grain of the page rather
 * than a new pattern.
 *
 * ── WHY THE SEARCH BOX IS NEW BUT THE SEARCH IS NOT ─────────────────────────
 *
 * The page has honoured a `q` parameter for a long time, matching name,
 * country, city and contact person — but nothing ever rendered an input, so it
 * could only be reached by typing the URL by hand. The box below is wired to
 * the parameter that was already there.
 */

export interface PartnerFilterOptions {
  /** Countries actually present on partner records, not the whole world. */
  countries: string[];
  /** Agreement statuses actually present, so the list cannot go stale. */
  agreements: string[];
  regions: { id: string; name: string }[];
}

const ALL = "all";

const AGREEMENT_LABELS: Record<string, string> = {
  SIGNED: "Signed",
  PENDING: "Pending",
  IN_NEGOTIATION: "In negotiation",
  EXPIRED: "Expired",
  NONE: "None",
};

const TIERS = ["PLATINUM", "GOLD", "SILVER", "EMERGING", "INACTIVE"];

/** Title-cases an unknown stored value so a legacy entry still reads sensibly. */
function humanise(v: string): string {
  return (
    AGREEMENT_LABELS[v] ??
    v
      .toLowerCase()
      .split(/[_\s]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

export function PartnerFilters({ countries, agreements, regions }: PartnerFilterOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const get = (k: string) => params.get(k) ?? ALL;
  // A multi-select param is comma-separated; empty means "no filter".
  const getMany = (k: string) =>
    (params.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const setMany = (k: string, next: string[]) => apply({ [k]: next.length ? next.join(",") : null });
  const [search, setSearch] = React.useState(params.get("q") ?? "");

  // Keep the box in step when the URL changes from somewhere else — clearing
  // the filters, or the back button.
  const urlQ = params.get("q") ?? "";
  React.useEffect(() => setSearch(urlQ), [urlQ]);

  /** Writes one parameter and keeps the rest, so the tab is never lost. */
  const apply = React.useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === "" || v === ALL) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router]
  );

  // Debounced: pushing on every keystroke is a request per character.
  React.useEffect(() => {
    if (search === urlQ) return;
    const t = setTimeout(() => apply({ q: search }), 400);
    return () => clearTimeout(t);
  }, [search, urlQ, apply]);

  const active =
    urlQ !== "" ||
    ["country", "agreement", "region", "tier", "status"].some(
      (k) => params.get(k) && params.get(k) !== ALL
    );

  const clear = () => {
    // Everything except the tab, which is a place in the page rather than a
    // filter — clearing filters should not also throw you back to All Partners.
    const next = new URLSearchParams();
    const tab = params.get("type");
    if (tab) next.set("type", tab);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px] max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
        <Input
          placeholder="Search name, country, city, contact…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9 text-sm"
          aria-label="Search partners"
        />
      </div>

      {countries.length > 0 && (
        <MultiSelectFilter
          allLabel="All countries"
          noun="countries"
          options={countries.map((c): MultiSelectOption => ({ value: c, label: c }))}
          selected={getMany("country")}
          onChange={(n) => setMany("country", n)}
          className="h-9 w-[150px]"
          ariaLabel="Country"
        />
      )}

      {agreements.length > 0 && (
        <MultiSelectFilter
          allLabel="All agreements"
          noun="agreements"
          options={agreements.map((a): MultiSelectOption => ({ value: a, label: humanise(a) }))}
          selected={getMany("agreement")}
          onChange={(n) => setMany("agreement", n)}
          className="h-9 w-[165px]"
          ariaLabel="Agreement status"
        />
      )}

      {regions.length > 0 && (
        <MultiSelectFilter
          allLabel="All regions"
          noun="regions"
          options={regions.map((r): MultiSelectOption => ({ value: r.id, label: r.name }))}
          selected={getMany("region")}
          onChange={(n) => setMany("region", n)}
          className="h-9 w-[150px]"
          ariaLabel="Region"
        />
      )}

      {/* Tier lives on the agent profile, so picking one necessarily hides every
          partner that is not an agent. Labelled "Agent tier" rather than "Tier"
          so that is obvious before it is clicked, not after. */}
      <MultiSelectFilter
        allLabel="All tiers"
        noun="tiers"
        options={TIERS.map((t): MultiSelectOption => ({ value: t, label: humanise(t) }))}
        selected={getMany("tier")}
        onChange={(n) => setMany("tier", n)}
        className="h-9 w-[150px]"
        ariaLabel="Agent tier"
      />

      {/* Deactivated partners were previously unreachable: the query hard-coded
          isActive true and nothing offered a way past it. Active stays the
          default so the page opens as it always has. */}
      <Select value={params.get("status") ?? "active"} onValueChange={(v) => apply({ status: v })}>
        <SelectTrigger className="h-9 w-[140px] text-sm" aria-label="Active status">
          <SelectValue placeholder="Active" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Active only</SelectItem>
          <SelectItem value="inactive">Inactive only</SelectItem>
          <SelectItem value={ALL}>Active and inactive</SelectItem>
        </SelectContent>
      </Select>

      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clear}
          className="h-9 gap-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
