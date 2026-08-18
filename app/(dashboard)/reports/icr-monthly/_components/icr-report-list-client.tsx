"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Loader2, FileText, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
// Server and browser disagree on toLocaleDateString(); this does not.
import { formatDate } from "@/lib/utils";

const MONTHS = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  PENDING_REVIEW: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  FINAL_APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  RETURNED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Awaiting approval",
  FINAL_APPROVED: "Approved",
  RETURNED: "Returned",
};

interface ReportRow {
  id: string;
  reportingMonth: number;
  reportingYear: number;
  status: string;
  intakesCovered: string | null;
  submittedAt: string | null;
  finalApprovedAt: string | null;
  updatedAt: string;
  icr: { id: string; name: string | null; email: string };
  region: { name: string } | null;
}

export function IcrReportListClient({
  reports,
  canCreate,
  takenPeriods,
}: {
  reports: ReportRow[];
  canCreate: boolean;
  takenPeriods: string[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to last month: the month you report on is the one that has finished.
  const now = new Date();
  const defMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const defYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  const [month, setMonth] = useState(String(defMonth));
  const [year, setYear] = useState(String(defYear));
  const [intakes, setIntakes] = useState("");

  const taken = new Set(takenPeriods);
  const alreadyFiled = taken.has(`${year}-${month}`);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/icr-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportingMonth: Number(month),
          reportingYear: Number(year),
          ...(intakes.trim() ? { intakesCovered: intakes.trim() } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A 409 knows which report already exists — take the rep there rather
        // than making them hunt for it in the list.
        if (res.status === 409 && json.reportId) {
          router.push(`/reports/icr-monthly/${json.reportId}`);
          return;
        }
        setError(json.error ?? "Could not create the report");
        return;
      }
      router.push(`/reports/icr-monthly/${json.id}`);
    } catch {
      setError("Could not reach the server — check your connection.");
    } finally {
      setCreating(false);
    }
  }

  const years = Array.from({ length: 4 }, (_, i) => String(now.getFullYear() - 2 + i));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Button asChild variant="ghost" size="sm" className="text-slate-500 dark:text-slate-400">
          <Link href="/reports">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            All reports
          </Link>
        </Button>
        {canCreate && !showForm && (
          <Button
            onClick={() => setShowForm(true)}
            className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            New monthly report
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="month">Reporting period</Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger id="month"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.slice(1).map((m, i) => (
                      <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="year">Year</Label>
                <Select value={year} onValueChange={setYear}>
                  <SelectTrigger id="year"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intakes">Intake(s) covered</Label>
                <Input
                  id="intakes"
                  value={intakes}
                  onChange={(e) => setIntakes(e.target.value)}
                  placeholder="e.g. Sep 2026 / Jan 2027"
                />
              </div>
            </div>

            {alreadyFiled && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                You already have a report for {MONTHS[Number(month)]} {year}. Creating it again will just open the existing one.
              </p>
            )}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex items-center gap-2">
              <Button
                onClick={create}
                disabled={creating}
                className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
              >
                {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Generate from CRM
              </Button>
              <Button variant="ghost" onClick={() => setShowForm(false)} disabled={creating}>
                Cancel
              </Button>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Everything the CRM can answer is filled in for you. You write the judgement sections.
            </p>
          </CardContent>
        </Card>
      )}

      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-600" />
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              No monthly reports yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className="text-left px-5 py-3 font-medium text-slate-500 dark:text-slate-400">Period</th>
                  <th className="text-left px-5 py-3 font-medium text-slate-500 dark:text-slate-400">ICR</th>
                  <th className="text-left px-5 py-3 font-medium text-slate-500 dark:text-slate-400">Intakes</th>
                  <th className="text-left px-5 py-3 font-medium text-slate-500 dark:text-slate-400">Status</th>
                  <th className="text-right px-5 py-3 font-medium text-slate-500 dark:text-slate-400">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/reports/icr-monthly/${r.id}`}
                        className="font-medium text-[#1E3A5F] dark:text-sky-400 hover:underline"
                      >
                        {MONTHS[r.reportingMonth]} {r.reportingYear}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-300">
                      {r.icr.name ?? r.icr.email}
                      {r.region ? (
                        <span className="text-slate-400 dark:text-slate-500"> · {r.region.name}</span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400">
                      {r.intakesCovered ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_STYLES[r.status] ?? STATUS_STYLES.DRAFT
                        }`}
                      >
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-500 dark:text-slate-400">
                      {r.submittedAt ? formatDate(r.submittedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
