"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Surfaces the recycle bin inside Settings → Security.
 *
 * The bin itself is a top-level sidebar entry at /recycle-bin, but its own
 * breadcrumb reads Dashboard → Settings → Recycle Bin and people go looking in
 * Settings first, so mirror the count here and link across rather than leaving
 * the breadcrumb pointing at a page with no route to it.
 */
export function RecycleBinCard() {
  const [count, setCount] = useState<number | null>(null);
  const [retentionDays, setRetentionDays] = useState(60);

  useEffect(() => {
    fetch("/api/recycle-bin")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // Sum `counts`, not `data.length` — the endpoint caps `data` at 500.
        const counts = d?.counts as Record<string, number> | undefined;
        setCount(counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0);
        if (typeof d?.retentionDays === "number") setRetentionDays(d.retentionDays);
      })
      .catch(() => setCount(0));
  }, []);

  return (
    <div className="border rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-slate-100 dark:bg-slate-500/15 flex items-center justify-center shrink-0">
            <Trash2 className="h-5 w-5 text-slate-600 dark:text-slate-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Recycle Bin
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-md">
              {count === null
                ? "Checking recoverable records…"
                : count === 0
                ? `Nothing deleted. Records stay recoverable for ${retentionDays} days.`
                : `${count} recoverable record${count === 1 ? "" : "s"}, kept for ${retentionDays} days from deletion.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {count !== null && count > 0 && (
            <span className="text-xs px-2 py-1 rounded-full font-medium bg-slate-100 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300">
              {count}
            </span>
          )}
          <Button asChild size="sm" variant="outline">
            <Link href="/recycle-bin">
              Open
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
