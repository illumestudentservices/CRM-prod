"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The notification bell.
 *
 * This was previously a bare `<button aria-label="Notifications">` in the
 * topbar with no onClick, no link and no menu — it did nothing at all, while
 * still drawing a red unread badge. So the one control that told a user they
 * had unread items was also the one control that refused to show them.
 *
 * The API had been finished all along: GET /api/notifications returns the rows
 * plus meta.unreadCount, and PATCH takes { id } or { all: true } to mark read.
 * Only the trigger was missing.
 *
 * Fetching happens on open rather than on mount: the bell renders on every
 * page, and a request per navigation would be a lot of traffic to show a
 * number the server already passed down as `initialCount`.
 */

interface NotificationRow {
  id: string;
  title: string;
  message: string | null;
  type: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function NotificationBell({ initialCount = 0 }: { initialCount?: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<NotificationRow[]>([]);
  const [unread, setUnread] = React.useState(initialCount);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  // The count comes from the server on each render of the shell; keep the badge
  // in step with it until the user opens the panel and we learn better.
  React.useEffect(() => setUnread(initialCount), [initialCount]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/notifications?limit=10");
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setRows(json.data ?? []);
      setUnread(json.meta?.unreadCount ?? 0);
    } catch {
      // A failed fetch must say so rather than render an empty list, which
      // would read as "you have no notifications".
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
  }

  async function markAll() {
    setRows((r) => r.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
  }

  async function openRow(row: NotificationRow) {
    if (!row.isRead) {
      setRows((r) => r.map((n) => (n.id === row.id ? { ...n, isRead: true } : n)));
      setUnread((u) => Math.max(0, u - 1));
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      }).catch(() => {});
    }
    if (row.link) {
      setOpen(false);
      router.push(row.link);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          className="relative flex items-center justify-center h-9 w-9 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors outline-none"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#EF4444] text-[9px] font-bold text-white leading-none">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0 text-sm">Notifications</DropdownMenuLabel>
          {unread > 0 && (
            <button
              onClick={(e) => { e.preventDefault(); void markAll(); }}
              className="text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />

        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">Loading…</p>
          )}
          {!loading && failed && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              Could not load notifications.{" "}
              <button onClick={(e) => { e.preventDefault(); void load(); }} className="underline">
                Try again
              </button>
            </p>
          )}
          {!loading && !failed && rows.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              You&apos;re all caught up.
            </p>
          )}
          {!loading && !failed && rows.map((row) => (
            <button
              key={row.id}
              onClick={(e) => { e.preventDefault(); void openRow(row); }}
              className={cn(
                "w-full text-left px-3 py-2.5 border-b last:border-b-0 transition-colors",
                "border-slate-100 dark:border-slate-800",
                "hover:bg-slate-50 dark:hover:bg-slate-800/60",
                !row.isRead && "bg-slate-50/80 dark:bg-slate-800/40"
              )}
            >
              <div className="flex items-start gap-2">
                {!row.isRead && (
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#EF4444]" />
                )}
                <div className={cn("min-w-0", row.isRead && "pl-3.5")}>
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {row.title}
                  </p>
                  {row.message && (
                    <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                      {row.message}
                    </p>
                  )}
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {relativeTime(row.createdAt)}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
