"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface ForecastEntry {
  id: string;
  studentName: string;
  institutionId: string;
  program: string;
  stage: string;
  expectedMonth: number;
  expectedYear: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  weightedProb: number;
}

interface ForecastMonth {
  month: number;
  year: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

interface ForecastSectionProps {
  reportId: string;
  institutionId: string;
  readOnly?: boolean;
}

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CONFIDENCE_CONFIG = {
  HIGH: { label: "High (80%)", weight: 0.8, color: "#22C55E", badgeClass: "bg-green-100 text-green-800" },
  MEDIUM: { label: "Medium (50%)", weight: 0.5, color: "#F59E0B", badgeClass: "bg-amber-100 text-amber-800" },
  LOW: { label: "Low (25%)", weight: 0.25, color: "#EF4444", badgeClass: "bg-red-100 text-red-800" },
};

const LEAD_STAGES = [
  "NEW", "CONTACTED", "APPLICATION_SENT", "DOCUMENTS_RECEIVED",
  "OFFER_ISSUED", "ENROLLED", "DEFERRED",
];

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: MONTH_NAMES[i + 1] }));
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => String(currentYear + i));

export function ForecastSection({ reportId, institutionId, readOnly = false }: ForecastSectionProps) {
  const [entries, setEntries] = useState<ForecastEntry[]>([]);
  const [forecast, setForecast] = useState<ForecastMonth[]>([]);
  const [totalWeighted, setTotalWeighted] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    studentName: "",
    program: "",
    stage: "OFFER_ISSUED",
    expectedMonth: String(new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2),
    expectedYear: String(currentYear),
    confidence: "MEDIUM" as "HIGH" | "MEDIUM" | "LOW",
  });

  async function fetchForecast() {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/forecast`);
      if (!res.ok) return;
      const json = await res.json();
      setEntries(json.entries ?? []);
      setForecast(json.forecast ?? []);
      setTotalWeighted(json.totalWeightedEnrollments ?? 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchForecast();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  async function handleAdd() {
    if (!form.studentName.trim() || !form.program.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/forecast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentName: form.studentName,
          institutionId,
          program: form.program,
          stage: form.stage,
          expectedMonth: Number(form.expectedMonth),
          expectedYear: Number(form.expectedYear),
          confidence: form.confidence,
        }),
      });
      if (!res.ok) return;
      setDialogOpen(false);
      setForm({
        studentName: "",
        program: "",
        stage: "OFFER_ISSUED",
        expectedMonth: String(new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2),
        expectedYear: String(currentYear),
        confidence: "MEDIUM",
      });
      await fetchForecast();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(entryId: string) {
    setDeletingId(entryId);
    try {
      await fetch(`/api/reports/${reportId}/forecast?entryId=${entryId}`, { method: "DELETE" });
      await fetchForecast();
    } finally {
      setDeletingId(null);
    }
  }

  const chartData = forecast.map((f) => ({
    name: `${MONTH_NAMES[f.month]} ${f.year}`,
    High: parseFloat(f.high.toFixed(2)),
    Medium: parseFloat(f.medium.toFixed(2)),
    Low: parseFloat(f.low.toFixed(2)),
  }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-[#1E3A5F]" />
          <h3 className="text-base font-semibold text-slate-800">Forecast Summary</h3>
          {totalWeighted > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#1E3A5F]/10 text-[#1E3A5F] font-semibold">
              {totalWeighted.toFixed(1)} weighted expected
            </span>
          )}
        </div>
        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogOpen(true)}
            className="h-8"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Entry
          </Button>
        )}
      </div>

      {/* Entries table */}
      {loading ? (
        <div className="space-y-2">
          {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
          No forecast entries yet.{!readOnly && " Click 'Add Entry' to add a predicted enrollment."}
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left text-xs font-semibold text-slate-500 py-2 px-4">Student</th>
                <th className="text-left text-xs font-semibold text-slate-500 py-2 px-3">Program</th>
                <th className="text-left text-xs font-semibold text-slate-500 py-2 px-3">Stage</th>
                <th className="text-left text-xs font-semibold text-slate-500 py-2 px-3">Expected</th>
                <th className="text-left text-xs font-semibold text-slate-500 py-2 px-3">Confidence</th>
                <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Weighted</th>
                {!readOnly && <th className="w-10 py-2 px-2" />}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-50 hover:bg-slate-50/50 last:border-0">
                  <td className="py-3 px-4 font-medium text-slate-800">{entry.studentName}</td>
                  <td className="py-3 px-3 text-slate-600 text-xs max-w-[150px] truncate">{entry.program}</td>
                  <td className="py-3 px-3 text-xs text-slate-500">{entry.stage.replace(/_/g, " ")}</td>
                  <td className="py-3 px-3 text-xs text-slate-600">
                    {MONTH_NAMES[entry.expectedMonth]} {entry.expectedYear}
                  </td>
                  <td className="py-3 px-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${CONFIDENCE_CONFIG[entry.confidence].badgeClass}`}>
                      {entry.confidence}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-slate-800">
                    {(entry.weightedProb * 100).toFixed(0)}%
                  </td>
                  {!readOnly && (
                    <td className="py-3 px-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-slate-400 hover:text-[#EF4444]"
                        disabled={deletingId === entry.id}
                        onClick={() => handleDelete(entry.id)}
                      >
                        {deletingId === entry.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-slate-200">
                <td colSpan={readOnly ? 5 : 6} className="py-2 px-4 text-xs font-semibold text-slate-600 text-right">
                  Total Weighted Expected Enrollments:
                </td>
                <td className="py-2 px-4 text-right font-bold text-[#1E3A5F]">
                  {totalWeighted.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Forecast chart */}
      {chartData.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-2">Expected enrollments by month and confidence level</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={{ stroke: "#E2E8F0" }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontSize: "12px", border: "1px solid #E2E8F0", borderRadius: "8px" }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
              <Bar dataKey="High" stackId="a" fill={CONFIDENCE_CONFIG.HIGH.color} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Medium" stackId="a" fill={CONFIDENCE_CONFIG.MEDIUM.color} />
              <Bar dataKey="Low" stackId="a" fill={CONFIDENCE_CONFIG.LOW.color} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Add entry dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Forecast Entry</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Student Name</Label>
              <Input
                placeholder="Full name..."
                value={form.studentName}
                onChange={(e) => setForm((f) => ({ ...f, studentName: e.target.value }))}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Program</Label>
              <Input
                placeholder="e.g. BSc Computer Science"
                value={form.program}
                onChange={(e) => setForm((f) => ({ ...f, program: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Current Stage</Label>
              <Select value={form.stage} onValueChange={(v) => setForm((f) => ({ ...f, stage: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Confidence</Label>
              <Select
                value={form.confidence}
                onValueChange={(v) => setForm((f) => ({ ...f, confidence: v as "HIGH" | "MEDIUM" | "LOW" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CONFIDENCE_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Expected Month</Label>
              <Select value={form.expectedMonth} onValueChange={(v) => setForm((f) => ({ ...f, expectedMonth: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Expected Year</Label>
              <Select value={form.expectedYear} onValueChange={(v) => setForm((f) => ({ ...f, expectedYear: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={y}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Probability indicator */}
            <div className="col-span-2 p-3 bg-slate-50 rounded-lg flex items-center justify-between">
              <span className="text-sm text-slate-600">Weighted probability:</span>
              <span className="text-lg font-bold" style={{ color: CONFIDENCE_CONFIG[form.confidence].color }}>
                {(CONFIDENCE_CONFIG[form.confidence].weight * 100).toFixed(0)}%
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!form.studentName.trim() || !form.program.trim() || submitting}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
            >
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Add Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
