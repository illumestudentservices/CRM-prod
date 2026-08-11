"use client";

import * as React from "react";
import { FileText, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Spec §8 — "Quarterly Market Report is auto-populated. RM adds only narrative
 * sections." /api/market-intelligence/quarterly-report returns the computed
 * payload; this dialog hands the RM a rendered JSON preview + a copy button so
 * they can paste it into the market's narrative fields.
 *
 * Kept intentionally light — the full doc renderer is future work; today's
 * value is just exposing the endpoint that already exists.
 */
export function QuarterlyReportButton({ marketId }: { marketId: string }) {
  const now = new Date();
  const [open, setOpen] = React.useState(false);
  const [quarter, setQuarter] = React.useState(String(Math.floor(now.getMonth() / 3) + 1));
  const [year, setYear] = React.useState(String(now.getFullYear()));
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<Record<string, unknown> | null>(null);

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 3 + i);

  async function generate() {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/market-intelligence/quarterly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketId, quarter: Number(quarter), year: Number(year) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (HTTP ${res.status})`);
      }
      setReport(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `market-${marketId}-Q${quarter}-${year}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <FileText className="h-3.5 w-3.5" />
        Quarterly Report
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setReport(null);
            setError(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Quarterly Market Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Quarter</Label>
                <Select value={quarter} onValueChange={setQuarter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Q1 (Jan–Mar)</SelectItem>
                    <SelectItem value="2">Q2 (Apr–Jun)</SelectItem>
                    <SelectItem value="3">Q3 (Jul–Sep)</SelectItem>
                    <SelectItem value="4">Q4 (Oct–Dec)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Year</Label>
                <Select value={year} onValueChange={setYear}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {report && (
              <div className="rounded border bg-slate-50 dark:bg-slate-900/40 p-3 max-h-[40vh] overflow-auto">
                <pre className="text-xs whitespace-pre-wrap break-words">
                  {JSON.stringify(report, null, 2)}
                </pre>
              </div>
            )}

            {error && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            {report ? (
              <Button onClick={download} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Download JSON
              </Button>
            ) : (
              <Button onClick={generate} disabled={loading} className="gap-1.5">
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {loading ? "Generating…" : "Generate"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
