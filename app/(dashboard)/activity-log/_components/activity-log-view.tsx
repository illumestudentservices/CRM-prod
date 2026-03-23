"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Search, ChevronLeft, ChevronRight, Activity, Users, Calendar,
  TrendingUp, ChevronDown, ChevronUp, X, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface LogUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

interface GeoLocation {
  city: string;
  country: string;
  countryCode: string;
  region: string;
}

interface LogEntry {
  id: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  changes: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: LogUser;
  geoLocation: GeoLocation | null;
}

interface Stats {
  total: number;
  today: number;
  activeUsersToday: number;
  topEntity: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ENTITY_OPTIONS = [
  "LEAD", "EMPLOYEE", "USER", "INSTITUTION", "EVENT", "REPORT",
  "KB_ARTICLE", "KB_ATTACHMENT", "ANNOUNCEMENT", "SOURCE",
  "LEAVE", "TASK", "ATTENDANCE", "ASSET", "SETTING",
];

const ACTION_OPTIONS = [
  "CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT",
  "APPROVE", "REJECT", "UPLOAD", "DOWNLOAD", "STAGE_CHANGE", "PASSWORD_RESET",
];

const ACTION_STYLES: Record<string, string> = {
  CREATE:         "text-emerald-700",
  UPDATE:         "text-blue-700",
  DELETE:         "text-red-700",
  LOGIN:          "text-violet-700",
  LOGOUT:         "text-slate-600",
  APPROVE:        "text-teal-700",
  REJECT:         "text-orange-700",
  UPLOAD:         "text-indigo-700",
  DOWNLOAD:       "text-cyan-700",
  STAGE_CHANGE:   "text-amber-700",
  PASSWORD_RESET: "text-rose-700",
};

const ROLE_STYLES: Record<string, string> = {
  SUPER_ADMIN:        "bg-red-100 text-red-700",
  HQ_EXECUTIVE:       "bg-purple-100 text-purple-700",
  HQ_ANALYTICS:       "bg-blue-100 text-blue-700",
  REGIONAL_MANAGER:   "bg-indigo-100 text-indigo-700",
  ICR:                "bg-teal-100 text-teal-700",
  HR_MANAGER:         "bg-orange-100 text-orange-700",
  EMPLOYEE:           "bg-slate-100 text-slate-600",
  INSTITUTION_CLIENT: "bg-yellow-100 text-yellow-700",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fullTime(date: string) {
  return new Date(date).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function formatLabel(str: string) {
  return str.charAt(0) + str.slice(1).toLowerCase().replace(/_/g, " ");
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

function getInitials(name: string | null, email: string) {
  if (name) return name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ActivityLogView({ stats }: { stats: Stats }) {
  const [logs, setLogs]       = useState<LogEntry[]>([]);
  const [total, setTotal]     = useState(stats.total);
  const [pages, setPages]     = useState(1);
  const [loading, setLoading] = useState(true);

  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState("");
  const [searchInput,  setSearchInput]  = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");
  const [expandedRow,  setExpandedRow]  = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (search)       params.set("search", search);
    if (entityFilter) params.set("entity", entityFilter);
    if (actionFilter) params.set("action", actionFilter);
    if (dateFrom)     params.set("from", dateFrom);
    if (dateTo)       params.set("to", dateTo);

    try {
      const res  = await fetch(`/api/activity-log?${params}`);
      const data = await res.json();
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
      setPages(data.pages ?? 1);
    } finally {
      setLoading(false);
    }
  }, [page, search, entityFilter, actionFilter, dateFrom, dateTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  }

  function clearFilters() {
    setSearchInput(""); setSearch("");
    setEntityFilter(""); setActionFilter("");
    setDateFrom(""); setDateTo("");
    setPage(1);
  }

  const hasFilters = search || entityFilter || actionFilter || dateFrom || dateTo;
  const from = (page - 1) * 50 + 1;
  const to   = Math.min(page * 50, total);

  return (
    <div className="space-y-6">
      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Actions",    value: stats.total.toLocaleString(),           icon: Activity,  color: "text-blue-600"   },
          { label: "Actions Today",    value: stats.today.toLocaleString(),            icon: Calendar,  color: "text-emerald-600" },
          { label: "Active Today",     value: stats.activeUsersToday.toLocaleString(), icon: Users,     color: "text-violet-600"  },
          { label: "Top Entity",       value: formatLabel(stats.topEntity),            icon: TrendingUp, color: "text-orange-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                </div>
                <Icon className={cn("h-5 w-5 mt-1", color)} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Search */}
            <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[220px]">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search user, entity, action…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <Button type="submit" size="sm">Search</Button>
            </form>

            {/* Entity filter */}
            <select
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[140px]"
              value={entityFilter}
              onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
            >
              <option value="">All entities</option>
              {ENTITY_OPTIONS.map(e => (
                <option key={e} value={e}>{formatLabel(e)}</option>
              ))}
            </select>

            {/* Action filter */}
            <select
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[130px]"
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            >
              <option value="">All actions</option>
              {ACTION_OPTIONS.map(a => (
                <option key={a} value={a}>{formatLabel(a)}</option>
              ))}
            </select>

            {/* Date range */}
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              />
              <span className="text-muted-foreground text-xs">to</span>
              <input
                type="date"
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              />
            </div>

            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-muted-foreground">
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Table ── */}
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[130px]">Time</TableHead>
                <TableHead className="w-[200px]">User</TableHead>
                <TableHead className="w-[130px]">Action</TableHead>
                <TableHead className="w-[170px]">Entity</TableHead>
                <TableHead className="w-[180px]">IP / Location</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <div className="h-4 bg-muted animate-pulse rounded" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
                    <Activity className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No activity logs found</p>
                    {hasFilters && (
                      <button onClick={clearFilters} className="text-xs underline mt-1 hover:text-foreground">
                        Clear filters
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <React.Fragment key={log.id}>
                    <TableRow className={cn("cursor-default", expandedRow === log.id && "bg-muted/50")}>
                      {/* Time */}
                      <TableCell>
                        <span className="text-xs text-muted-foreground cursor-default" title={fullTime(log.createdAt)}>
                          {relativeTime(log.createdAt)}
                        </span>
                      </TableCell>

                      {/* User */}
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-7 w-7 rounded-full bg-[#1E3A5F] text-white flex items-center justify-center text-[10px] font-semibold shrink-0">
                            {getInitials(log.user.name, log.user.email)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{log.user.name ?? log.user.email}</p>
                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", ROLE_STYLES[log.user.role] ?? "bg-slate-100 text-slate-600")}>
                              {formatLabel(log.user.role)}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Action */}
                      <TableCell>
                        <span className={cn("text-xs font-bold tracking-wide uppercase font-mono", ACTION_STYLES[log.action] ?? "text-slate-600")}>
                          {log.action}
                        </span>
                      </TableCell>

                      {/* Entity */}
                      <TableCell>
                        <div>
                          <p className="text-xs font-medium">{formatLabel(log.entity)}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{log.entityId.slice(0, 8)}…</p>
                        </div>
                      </TableCell>

                      {/* IP / Location */}
                      <TableCell>
                        {log.ipAddress ? (
                          <div>
                            <span className="text-xs text-muted-foreground font-mono">{log.ipAddress}</span>
                            {log.geoLocation && (
                              <p className="text-xs text-slate-500 mt-0.5">
                                {countryFlag(log.geoLocation.countryCode)}{" "}
                                {[log.geoLocation.city, log.geoLocation.country]
                                  .filter(Boolean)
                                  .join(", ")}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>

                      {/* Expand */}
                      <TableCell>
                        {log.changes != null && (
                          <button
                            onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="View changes"
                          >
                            {expandedRow === log.id
                              ? <ChevronUp className="h-4 w-4" />
                              : <ChevronDown className="h-4 w-4" />
                            }
                          </button>
                        )}
                      </TableCell>
                    </TableRow>

                    {/* Expanded changes row */}
                    {expandedRow === log.id && (
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={6} className="py-2 px-4">
                          <pre className="text-[11px] text-muted-foreground overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                            {JSON.stringify(log.changes, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-xs text-muted-foreground">
              Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} entries
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="h-8 w-8 p-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs font-medium px-2">
                {page} / {pages}
              </span>
              <Button
                variant="outline" size="sm"
                disabled={page >= pages}
                onClick={() => setPage(p => p + 1)}
                className="h-8 w-8 p-0"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {loading && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading logs…
        </div>
      )}
    </div>
  );
}
