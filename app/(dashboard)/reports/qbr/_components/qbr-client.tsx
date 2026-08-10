"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Loader2,
  Eye,
  Trash2,
  AlertTriangle,
  BarChart3,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface Institution {
  id: string;
  name: string;
}

interface QBR {
  id: string;
  institutionId: string;
  year: number;
  quarter: number;
  status: "DRAFT" | "SUBMITTED" | "APPROVED";
  executiveSummary: string | null;
  strategicRecommendations: string | null;
  marketPerformance: MarketPerformance | null;
  roiAnalysis: ROIAnalysis | null;
  kpiSummary: KPISummary | null;
  createdAt: string;
  updatedAt: string;
  institution: { id: string; name: string; country: string };
}

interface MarketPerformance {
  totalLeads: number;
  leadsByMarket: Record<string, number>;
  leadsByStage: Record<string, number>;
  leadsByProgram: Record<string, number>;
  topMarkets: Array<{ market: string; count: number }>;
}

interface ROIAnalysis {
  totalActivities: number;
  totalCost: number;
  totalLeadsFromActivities: number;
  totalStudentsEngaged: number;
  enrolled: number;
  costPerLead: number;
  costPerEnrollment: number;
  activityBreakdown: Array<{ type: string; count: number; cost: number; leads: number }>;
}

interface KPISummary {
  kpis: Array<{
    category: string;
    name: string;
    target: number;
    current: number;
    unit: string;
    achievement: number;
  }>;
  monthlyKPIs: Array<{ month: string; kpi: unknown }>;
}

interface QBRClientProps {
  canGenerate: boolean;
  institutions: Institution[];
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300" },
  SUBMITTED: { label: "Submitted", className: "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  APPROVED: { label: "Approved", className: "bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300" },
};

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - 3 + i);

export function QBRClient({ canGenerate, institutions }: QBRClientProps) {
  const router = useRouter();
  const [qbrs, setQbrs] = useState<QBR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generate dialog
  const [showGenerate, setShowGenerate] = useState(false);
  const [genInstitutionId, setGenInstitutionId] = useState("");
  const [genYear, setGenYear] = useState(CURRENT_YEAR.toString());
  const [genQuarter, setGenQuarter] = useState("");
  const [generating, setGenerating] = useState(false);

  // View dialog
  const [viewQBR, setViewQBR] = useState<QBR | null>(null);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchQBRs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/qbr");
      if (!res.ok) throw new Error("Failed to load QBRs");
      const data = await res.json();
      setQbrs(data);
    } catch {
      setError("Failed to load QBRs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQBRs();
  }, [fetchQBRs]);

  async function handleGenerate() {
    if (!genInstitutionId || !genQuarter) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/qbr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institutionId: genInstitutionId,
          year: parseInt(genYear),
          quarter: parseInt(genQuarter),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? "Failed to generate QBR");
        return;
      }
      setShowGenerate(false);
      setGenInstitutionId("");
      setGenQuarter("");
      router.refresh();
      await fetchQBRs();
    } catch {
      setError("Failed to generate QBR");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/qbr/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? "Failed to delete QBR");
        return;
      }
      setDeleteId(null);
      router.refresh();
      await fetchQBRs();
    } catch {
      setError("Failed to delete QBR");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Actions */}
      {canGenerate && (
        <div className="flex justify-end">
          <Button
            onClick={() => setShowGenerate(true)}
            className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Generate QBR
          </Button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg text-sm text-red-600 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#0EA5E9]" />
            Quarterly Business Reviews
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400 dark:text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading...
            </div>
          ) : qbrs.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-400">
              No QBRs generated yet. Click &ldquo;Generate QBR&rdquo; to create one.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-800">
                    <th className="text-left text-xs font-semibold text-slate-500 dark:text-slate-400 py-2.5 px-4">
                      Institution
                    </th>
                    <th className="text-center text-xs font-semibold text-slate-500 dark:text-slate-400 py-2.5 px-4">
                      Year
                    </th>
                    <th className="text-center text-xs font-semibold text-slate-500 dark:text-slate-400 py-2.5 px-4">
                      Quarter
                    </th>
                    <th className="text-center text-xs font-semibold text-slate-500 dark:text-slate-400 py-2.5 px-4">
                      Status
                    </th>
                    <th className="text-center text-xs font-semibold text-slate-500 dark:text-slate-400 py-2.5 px-4">
                      Created
                    </th>
                    <th className="text-right text-xs font-semibold text-slate-500 dark:text-slate-400 py-2.5 px-4">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {qbrs.map((qbr) => {
                    const statusCfg = STATUS_CONFIG[qbr.status] ?? STATUS_CONFIG["DRAFT"];
                    return (
                      <tr key={qbr.id} className="border-b border-slate-50 last:border-0">
                        <td className="py-2.5 px-4 font-medium text-slate-800 dark:text-slate-200">
                          {qbr.institution.name}
                        </td>
                        <td className="py-2.5 px-4 text-center text-slate-600 dark:text-slate-400">{qbr.year}</td>
                        <td className="py-2.5 px-4 text-center text-slate-600 dark:text-slate-400">Q{qbr.quarter}</td>
                        <td className="py-2.5 px-4 text-center">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusCfg.className}`}
                          >
                            {statusCfg.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-center text-slate-500 dark:text-slate-400 text-xs">
                          {new Date(qbr.createdAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setViewQBR(qbr)}
                              className="h-8 w-8 p-0"
                            >
                              <Eye className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                            </Button>
                            {canGenerate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteId(qbr.id)}
                                className="h-8 w-8 p-0"
                              >
                                <Trash2 className="h-4 w-4 text-red-400" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Generate QBR Dialog ───────────────────────────────────────────── */}
      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Quarterly Business Review</DialogTitle>
            <DialogDescription>
              Select an institution and quarter to auto-generate a QBR from CRM data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Institution</Label>
              <Select value={genInstitutionId} onValueChange={setGenInstitutionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select institution" />
                </SelectTrigger>
                <SelectContent>
                  {institutions.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Year</Label>
                <Select value={genYear} onValueChange={setGenYear}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={y.toString()}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Quarter</Label>
                <Select value={genQuarter} onValueChange={setGenQuarter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Q1 (Jan-Mar)</SelectItem>
                    <SelectItem value="2">Q2 (Apr-Jun)</SelectItem>
                    <SelectItem value="3">Q3 (Jul-Sep)</SelectItem>
                    <SelectItem value="4">Q4 (Oct-Dec)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerate(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={generating || !genInstitutionId || !genQuarter}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
            >
              {generating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View QBR Dialog ───────────────────────────────────────────────── */}
      <Dialog open={!!viewQBR} onOpenChange={() => setViewQBR(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          {viewQBR && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg">
                  {viewQBR.institution.name} — Q{viewQBR.quarter} {viewQBR.year}
                </DialogTitle>
                <DialogDescription>
                  Quarterly Business Review{" "}
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ml-2 ${
                      STATUS_CONFIG[viewQBR.status]?.className ?? ""
                    }`}
                  >
                    {STATUS_CONFIG[viewQBR.status]?.label ?? viewQBR.status}
                  </span>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 py-2">
                {/* Executive Summary */}
                {viewQBR.executiveSummary && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Executive Summary
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-900/40 rounded-lg p-4">
                      {viewQBR.executiveSummary}
                    </p>
                  </div>
                )}

                {/* Market Performance */}
                {viewQBR.marketPerformance && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Market Performance
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                      <div className="text-center rounded-lg bg-slate-50 dark:bg-slate-900/40 py-3">
                        <p className="text-xl font-bold text-[#1E3A5F]">
                          {viewQBR.marketPerformance.totalLeads}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Total Leads</p>
                      </div>
                      {viewQBR.marketPerformance.topMarkets?.slice(0, 3).map((m) => (
                        <div key={m.market} className="text-center rounded-lg bg-slate-50 dark:bg-slate-900/40 py-3">
                          <p className="text-xl font-bold text-[#0EA5E9]">{m.count}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate px-2">{m.market}</p>
                        </div>
                      ))}
                    </div>
                    {viewQBR.marketPerformance.leadsByStage && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                        <p className="font-medium text-slate-600 dark:text-slate-300">Leads by Stage:</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(viewQBR.marketPerformance.leadsByStage).map(
                            ([stage, count]) => (
                              <span
                                key={stage}
                                className="inline-flex items-center px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                              >
                                {stage.replace(/_/g, " ")}: {count}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ROI Analysis */}
                {viewQBR.roiAnalysis && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">ROI Analysis</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                      <div className="text-center rounded-lg bg-slate-50 dark:bg-slate-900/40 py-3">
                        <p className="text-xl font-bold text-[#1E3A5F]">
                          {viewQBR.roiAnalysis.totalActivities}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Activities</p>
                      </div>
                      <div className="text-center rounded-lg bg-slate-50 dark:bg-slate-900/40 py-3">
                        <p className="text-xl font-bold text-[#1E3A5F]">
                          ${viewQBR.roiAnalysis.totalCost.toLocaleString()}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Total Cost</p>
                      </div>
                      <div className="text-center rounded-lg bg-slate-50 dark:bg-slate-900/40 py-3">
                        <p className="text-xl font-bold text-[#0EA5E9]">
                          ${viewQBR.roiAnalysis.costPerLead.toFixed(2)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Cost / Lead</p>
                      </div>
                      <div className="text-center rounded-lg bg-slate-50 dark:bg-slate-900/40 py-3">
                        <p className="text-xl font-bold text-[#22C55E]">
                          {viewQBR.roiAnalysis.enrolled}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Enrolled</p>
                      </div>
                    </div>
                    {viewQBR.roiAnalysis.activityBreakdown?.length > 0 && (
                      <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-800">
                              <th className="text-left font-semibold text-slate-500 dark:text-slate-400 py-2 px-3">
                                Activity Type
                              </th>
                              <th className="text-right font-semibold text-slate-500 dark:text-slate-400 py-2 px-3">
                                Count
                              </th>
                              <th className="text-right font-semibold text-slate-500 dark:text-slate-400 py-2 px-3">
                                Cost
                              </th>
                              <th className="text-right font-semibold text-slate-500 dark:text-slate-400 py-2 px-3">
                                Leads
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {viewQBR.roiAnalysis.activityBreakdown.map((ab) => (
                              <tr
                                key={ab.type}
                                className="border-b border-slate-50 last:border-0"
                              >
                                <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                                  {ab.type.replace(/_/g, " ")}
                                </td>
                                <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">
                                  {ab.count}
                                </td>
                                <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">
                                  ${ab.cost.toLocaleString()}
                                </td>
                                <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">
                                  {ab.leads}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* KPI Summary */}
                {viewQBR.kpiSummary && viewQBR.kpiSummary.kpis?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">KPI Summary</h3>
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-800">
                            <th className="text-left font-semibold text-slate-500 dark:text-slate-400 py-2 px-3">
                              KPI
                            </th>
                            <th className="text-right font-semibold text-slate-500 dark:text-slate-400 py-2 px-3">
                              Target
                            </th>
                            <th className="text-right font-semibold text-slate-500 dark:text-slate-400 py-2 px-3">
                              Current
                            </th>
                            <th className="text-right font-semibold text-slate-500 dark:text-slate-400 py-2 px-3">
                              Achievement
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {viewQBR.kpiSummary.kpis.map((k, i) => (
                            <tr
                              key={i}
                              className="border-b border-slate-50 last:border-0"
                            >
                              <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{k.name}</td>
                              <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">
                                {k.target} {k.unit}
                              </td>
                              <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">
                                {k.current} {k.unit}
                              </td>
                              <td
                                className={`py-2 px-3 text-right font-semibold ${
                                  k.achievement >= 100
                                    ? "text-green-600 dark:text-green-400"
                                    : k.achievement >= 70
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-red-500 dark:text-red-400"
                                }`}
                              >
                                {k.achievement}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Strategic Recommendations */}
                {viewQBR.strategicRecommendations && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Strategic Recommendations
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-900/40 rounded-lg p-4">
                      {viewQBR.strategicRecommendations}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ────────────────────────────────────── */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete QBR</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this QBR? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
