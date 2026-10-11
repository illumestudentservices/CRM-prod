"use client";

import * as React from "react";
import { EmailLink } from "@/components/shared/email-link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/utils";
import { School as SchoolIcon, Users as UsersIcon, Search as SearchIcon } from "lucide-react";
import { SchoolForm } from "./school-form";
import { CounsellorForm } from "./counsellor-form";

interface SchoolRow {
  id: string;
  name: string;
  country: string;
  city: string | null;
  type: string;
  relationshipStatus: string;
  studentVolume: number | null;
  lastVisitDate: Date | string | null;
  _count?: { counsellors: number };
}

interface CounsellorRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  influenceScore: number | null;
  school: { id: string; name: string };
}

const REL_BADGE: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30",
  DEVELOPING: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
  DORMANT: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
  AT_RISK: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  INACTIVE: "bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
  NEW: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
};

export function StakeholdersTabs({
  schools,
  counsellors,
  markets,
  defaultTab,
}: {
  schools: SchoolRow[];
  counsellors: CounsellorRow[];
  markets: Array<{ id: string; name: string }>;
  defaultTab: "schools" | "counsellors";
}) {
  const [tab, setTab] = React.useState<"schools" | "counsellors">(defaultTab);
  // Neither table had any way to find a row. Both are hand-rolled, so they
  // never got the search the shared DataTable provides.
  const [search, setSearch] = React.useState("");
  const q = search.trim().toLowerCase();

  const shownSchools = React.useMemo(
    () => (!q ? schools : schools.filter((s) =>
      [s.name, s.country, s.city ?? "", s.type, s.relationshipStatus]
        .join(" ").toLowerCase().includes(q))),
    [schools, q],
  );
  const shownCounsellors = React.useMemo(
    () => (!q ? counsellors : counsellors.filter((c) =>
      [c.name, c.email ?? "", c.phone ?? "", c.position ?? "", c.school.name]
        .join(" ").toLowerCase().includes(q))),
    [counsellors, q],
  );

  const schoolOptions = React.useMemo(
    () => schools.map((s) => ({ id: s.id, name: s.name })),
    [schools]
  );

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "schools" | "counsellors")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="schools" className="gap-1.5">
            <SchoolIcon className="h-3.5 w-3.5" /> Schools ({schools.length})
          </TabsTrigger>
          <TabsTrigger value="counsellors" className="gap-1.5">
            <UsersIcon className="h-3.5 w-3.5" /> Counsellors ({counsellors.length})
          </TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2 ml-auto">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "schools"
                ? "Search schools, country, city…"
                : "Search counsellors, school, email…"}
              className="pl-9 h-9 w-72 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A5F]"
            />
          </div>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {tab === "schools"
              ? `${shownSchools.length} of ${schools.length}`
              : `${shownCounsellors.length} of ${counsellors.length}`}
          </span>
          {tab === "schools" ? (
            <SchoolForm markets={markets} />
          ) : (
            <CounsellorForm schools={schoolOptions} />
          )}
        </div>
      </div>

      <TabsContent value="schools" className="mt-4">
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Country / City</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Relationship</th>
                <th className="text-right p-2">Counsellors</th>
                <th className="text-right p-2">Volume</th>
                <th className="text-left p-2">Last Visit</th>
              </tr>
            </thead>
            <tbody>
              {shownSchools.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    {q
                      ? <>No schools match &ldquo;{search}&rdquo;.</>
                      : <>No schools yet. Click <strong>Add School</strong> to create the first one.</>}
                  </td>
                </tr>
              ) : (
                shownSchools.map((s) => (
                  <tr key={s.id} className="border-t hover:bg-muted/50">
                    <td className="p-2 font-medium">{s.name}</td>
                    <td className="p-2">
                      {s.country}
                      {s.city && <span className="text-muted-foreground"> · {s.city}</span>}
                    </td>
                    <td className="p-2 text-muted-foreground">{s.type}</td>
                    <td className="p-2">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border ${REL_BADGE[s.relationshipStatus] ?? REL_BADGE.NEW}`}
                      >
                        {s.relationshipStatus.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-2 text-right">{s._count?.counsellors ?? 0}</td>
                    <td className="p-2 text-right">{s.studentVolume ?? "—"}</td>
                    <td className="p-2 text-muted-foreground">
                      {s.lastVisitDate ? formatDate(s.lastVisitDate) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </TabsContent>

      <TabsContent value="counsellors" className="mt-4">
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">School</th>
                <th className="text-left p-2">Position</th>
                <th className="text-left p-2">Email</th>
                <th className="text-left p-2">Phone</th>
                <th className="text-right p-2">Influence</th>
              </tr>
            </thead>
            <tbody>
              {shownCounsellors.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    {q
                      ? <>No counsellors match &ldquo;{search}&rdquo;.</>
                      : <>No counsellors yet. Add a school first, then create counsellors under it.</>}
                  </td>
                </tr>
              ) : (
                shownCounsellors.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-muted/50">
                    <td className="p-2 font-medium">{c.name}</td>
                    <td className="p-2 text-muted-foreground">{c.school.name}</td>
                    <td className="p-2">{c.position ?? "—"}</td>
                    <td className="p-2 text-muted-foreground">
                    <EmailLink email={c.email} kind="business" />
                  </td>
                    <td className="p-2 text-muted-foreground">{c.phone ?? "—"}</td>
                    <td className="p-2 text-right">{c.influenceScore ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </TabsContent>
    </Tabs>
  );
}
