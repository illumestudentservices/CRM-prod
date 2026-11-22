"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Trash2, Loader2, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface Row {
  id: string;
  title: string;
  message: string | null;
  type: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

const PAGE = 30;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-CA", { day: "numeric", month: "short", year: "numeric" });
}

export function NotificationsClient() {
  const router = useRouter();
  const { toast } = useToast();
  // The hub defaults to Unread — the list of things still needing attention.
  // Marking all read empties it; read ones are kept and stay visible under "All".
  const [filter, setFilter] = React.useState<"all" | "unread">("unread");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  // Live count of loaded rows for the next page's offset — a closure over `rows`
  // would be stale inside this stable callback and refetch page 1 on Load more.
  const loadedRef = React.useRef(0);

  const load = React.useCallback(async (reset: boolean, f: "all" | "unread") => {
    if (reset) setLoading(true);
    const offset = reset ? 0 : loadedRef.current;
    try {
      const res = await fetch(`/api/notifications?limit=${PAGE}&offset=${offset}&unreadOnly=${f === "unread"}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      const data: Row[] = json.data ?? [];
      setRows((prev) => {
        const next = reset ? data : [...prev, ...data];
        loadedRef.current = next.length;
        return next;
      });
      setUnreadCount(json.meta?.unreadCount ?? 0);
      setTotal(json.meta?.total ?? 0);
      setHasMore(Boolean(json.meta?.hasMore));
    } catch {
      toast({ title: "Couldn't load notifications", description: "Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(true, filter); }, [filter, load]);

  async function openRow(row: Row) {
    if (!row.isRead) {
      setRows((r) => r.map((n) => (n.id === row.id ? { ...n, isRead: true } : n)));
      setUnreadCount((u) => Math.max(0, u - 1));
      await fetch("/api/notifications", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id }),
      }).catch(() => {});
    }
    if (row.link) router.push(row.link);
  }

  async function markAll() {
    setBusy(true);
    // Everything becomes read → it leaves the Unread hub. Keep the rows in the
    // database (not deleted); they remain under "All". Clear the view optimistically
    // and land on Unread so the hub visibly empties from whichever tab you clicked.
    setRows([]);
    loadedRef.current = 0;
    setUnreadCount(0);
    try {
      await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
      if (filter === "unread") await load(true, "unread");
      else setFilter("unread"); // the effect reloads the now-empty unread view
    } finally { setBusy(false); }
  }

  async function deleteOne(id: string) {
    setRows((r) => { const next = r.filter((n) => n.id !== id); loadedRef.current = next.length; return next; });
    setTotal((t) => Math.max(0, t - 1));
    await fetch("/api/notifications", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
    setUnreadCount((u) => u); // count refreshed on next load
  }

  async function clear(scope: "read" | "all") {
    if (scope === "all" && !window.confirm("Delete ALL your notifications? This cannot be undone.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/notifications", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }) });
      const json = await res.json().catch(() => ({}));
      toast({ title: scope === "read" ? "Cleared read notifications" : "Cleared all notifications", description: `${json.deleted ?? 0} removed.` });
      await load(true, filter);
    } finally { setBusy(false); }
  }

  const chip = (key: "all" | "unread", label: string) => (
    <button
      onClick={() => setFilter(key)}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        filter === key
          ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60"
      )}
    >
      {label}{key === "unread" && unreadCount > 0 ? ` ${unreadCount}` : ""}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {chip("all", "All")}
        {chip("unread", "Unread")}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" disabled={busy || unreadCount === 0} onClick={markAll}>
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => clear("read")}>
            <Trash2 className="h-4 w-4" /> Clear read
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800">
        {loading ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Bell className="mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500">{filter === "unread" ? "No unread notifications — switch to All to see earlier ones." : "You're all caught up."}</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row) => (
              <li key={row.id} className={cn("group flex items-start gap-3 px-4 py-3", !row.isRead && "bg-slate-50/70 dark:bg-slate-800/30")}>
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", row.isRead ? "bg-transparent" : "bg-[#EF4444]")} />
                <button onClick={() => openRow(row)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{row.title}</p>
                  {row.message && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{row.message}</p>}
                  <p className="mt-1 text-[11px] text-slate-400">{relativeTime(row.createdAt)}</p>
                </button>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {!row.isRead && (
                    <button onClick={() => openRow({ ...row, link: null })} title="Mark read"
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700">
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => deleteOne(row.id)} title="Delete"
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasMore && !loading && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => load(false, filter)}>Load more</Button>
        </div>
      )}
      {!loading && rows.length > 0 && (
        <p className="text-center text-xs text-slate-400">Showing {rows.length} of {total}</p>
      )}
    </div>
  );
}
