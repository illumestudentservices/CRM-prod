"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Trash2, AlertTriangle, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface DeletedRecord {
  id: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  parentType: string | null;
  parentId: string | null;
  parentLabel: string | null;
  hardDeleted: boolean;
  deletedAt: string;
  expiresAt: string;
  restoredAt: string | null;
  purgedAt: string | null;
  deletedBy: { id: string; name: string | null; email: string } | null;
  restoredBy: { id: string; name: string | null; email: string } | null;
}

interface Props {
  retentionDays: number;
}

export function RecycleBinClient({ retentionDays }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = React.useState<DeletedRecord[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [loading, setLoading] = React.useState(true);
  const [typeFilter, setTypeFilter] = React.useState<string>("all");
  const [busy, setBusy] = React.useState<Set<string>>(new Set());

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const url =
        typeFilter === "all"
          ? "/api/recycle-bin"
          : `/api/recycle-bin?entityType=${encodeURIComponent(typeFilter)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setItems(body.data ?? []);
      setCounts(body.counts ?? {});
    } catch (err) {
      toast({
        title: "Couldn't load recycle bin",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [typeFilter, toast]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function restore(item: DeletedRecord) {
    setBusy((prev) => new Set(prev).add(item.id));
    try {
      const res = await fetch(`/api/recycle-bin/${item.id}/restore`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      toast({ title: `Restored ${item.entityLabel}` });
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      router.refresh();
    } catch (err) {
      toast({
        title: "Restore failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function purge(item: DeletedRecord) {
    if (!confirm(`Permanently delete "${item.entityLabel}"? This can't be undone.`)) return;
    setBusy((prev) => new Set(prev).add(item.id));
    try {
      const res = await fetch(`/api/recycle-bin/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      toast({ title: `Permanently deleted ${item.entityLabel}` });
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    } catch (err) {
      toast({
        title: "Purge failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const filterOptions = [
    { key: "all", label: "All", count: total },
    ...Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, label: k.replace(/([A-Z])/g, " $1").trim(), count: v })),
  ];

  function daysUntil(iso: string) {
    const ms = new Date(iso).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40 p-3 text-sm text-slate-600 dark:text-slate-300">
        Items stay recoverable for <strong>{retentionDays} days</strong>. A nightly job at 03:00 UTC
        permanently deletes anything past its expiry to reclaim space. Only super admins see this
        page.
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        <Filter className="h-3.5 w-3.5 text-slate-400" />
        {filterOptions.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setTypeFilter(opt.key)}
            className={
              "text-xs px-2.5 py-1 rounded-full border transition-colors " +
              (typeFilter === opt.key
                ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100"
                : "bg-white text-slate-600 hover:bg-slate-50 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800/60")
            }
          >
            {opt.label} <span className="opacity-70">{opt.count}</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Item</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Parent</th>
              <th className="text-left p-2">Deleted By</th>
              <th className="text-left p-2">Deleted</th>
              <th className="text-left p-2">Expires In</th>
              <th className="text-right p-2 w-[140px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  Nothing in the bin.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const days = daysUntil(item.expiresAt);
                const urgent = days <= 7;
                const isBusy = busy.has(item.id);
                return (
                  <tr key={item.id} className="border-t hover:bg-muted/50">
                    <td className="p-2 max-w-md">
                      <div className="font-medium truncate">{item.entityLabel}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        id: {item.entityId}
                      </div>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{item.entityType}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {item.parentLabel ?? "—"}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {item.deletedBy?.name ?? item.deletedBy?.email ?? "—"}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {formatRelative(item.deletedAt)}
                    </td>
                    <td className="p-2 text-xs">
                      <span
                        className={
                          urgent
                            ? "text-red-600 dark:text-red-400 font-medium"
                            : "text-slate-500 dark:text-slate-400"
                        }
                      >
                        {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`}
                      </span>
                    </td>
                    <td className="p-2 text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => restore(item)}
                          className="h-7 gap-1 px-2"
                          title="Restore"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          <span className="text-xs">Restore</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isBusy}
                          onClick={() => purge(item)}
                          className="h-7 gap-1 px-2 text-red-600 hover:text-red-700"
                          title="Purge now"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {items.some((i) => daysUntil(i.expiresAt) <= 7) && (
        <div className="rounded border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          Some items expire within a week. Once expired, they're permanently deleted overnight.
        </div>
      )}
    </div>
  );
}
