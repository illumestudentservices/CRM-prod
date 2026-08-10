"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  GraduationCap,
  Globe,
  Users,
  Heart,
  Plus,
  Pencil,
  Trash2,
  Target,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

type KPICategory = "RECRUITMENT" | "MARKET_DEVELOPMENT" | "RELATIONSHIP" | "ENGAGEMENT";
type KPIPeriod = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL";

interface ClientKPI {
  id: string;
  institutionId: string;
  category: KPICategory;
  name: string;
  description: string | null;
  targetValue: number;
  currentValue: number;
  unit: string;
  period: KPIPeriod;
  year: number;
  month: number | null;
  quarter: number | null;
  createdAt: string;
  updatedAt: string;
}

interface KPIFormState {
  category: KPICategory;
  name: string;
  description: string;
  targetValue: string;
  currentValue: string;
  unit: string;
  period: KPIPeriod;
  year: number;
  month: string;
  quarter: string;
}

interface KpiManagerProps {
  institutionId: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<
  KPICategory,
  { label: string; icon: React.ElementType; color: string; bgColor: string; borderColor: string }
> = {
  RECRUITMENT: {
    label: "Recruitment",
    icon: GraduationCap,
    color: "text-blue-600 dark:text-blue-300",
    bgColor: "bg-blue-50 dark:bg-blue-500/15",
    borderColor: "border-blue-200 dark:border-blue-500/30",
  },
  MARKET_DEVELOPMENT: {
    label: "Market Development",
    icon: Globe,
    color: "text-green-600 dark:text-green-300",
    bgColor: "bg-green-50 dark:bg-green-500/15",
    borderColor: "border-green-200 dark:border-green-500/30",
  },
  RELATIONSHIP: {
    label: "Relationship",
    icon: Users,
    color: "text-violet-600 dark:text-violet-300",
    bgColor: "bg-violet-50 dark:bg-violet-500/15",
    borderColor: "border-violet-200 dark:border-violet-500/30",
  },
  ENGAGEMENT: {
    label: "Engagement",
    icon: Heart,
    color: "text-amber-600 dark:text-amber-300",
    bgColor: "bg-amber-50 dark:bg-amber-500/15",
    borderColor: "border-amber-200 dark:border-amber-500/30",
  },
};

const PERIOD_CONFIG: Record<KPIPeriod, { label: string; color: string }> = {
  WEEKLY: { label: "Weekly", color: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30" },
  MONTHLY: { label: "Monthly", color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30" },
  QUARTERLY: { label: "Quarterly", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30" },
  ANNUAL: { label: "Annual", color: "bg-green-50 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30" },
};

const CATEGORIES: KPICategory[] = ["RECRUITMENT", "MARKET_DEVELOPMENT", "RELATIONSHIP", "ENGAGEMENT"];

/**
 * Stands in for "no month/quarter chosen" in the Select.
 *
 * Radix refuses an empty string as an item value — it reserves "" for the
 * cleared state — and throws rather than degrading. The throw is not deferred
 * until the dropdown is opened: a closed `Select.Content` still renders its
 * children into an off-screen DocumentFragment so the items can be collected
 * for value matching. So `<SelectItem value="">` threw the moment the dialog
 * mounted, React unwound the tree, and "Add KPI" appeared to do nothing at all.
 */
const NONE = "none";

const currentYear = new Date().getFullYear();

function getDefaultFormState(year: number): KPIFormState {
  return {
    category: "RECRUITMENT",
    name: "",
    description: "",
    targetValue: "",
    currentValue: "0",
    unit: "",
    period: "MONTHLY",
    year,
    month: "",
    quarter: "",
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getPercentage(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(Math.round((current / target) * 100), 100);
}

function getPercentageColor(pct: number): string {
  if (pct >= 80) return "text-green-600 dark:text-green-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function getProgressIndicatorClass(pct: number): string {
  if (pct >= 80) return "bg-green-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-red-500";
}

// ─── Component ─────────────────────────────────────────────────────────────

export function KpiManager({ institutionId }: KpiManagerProps) {
  const router = useRouter();

  const [selectedYear, setSelectedYear] = React.useState(currentYear);
  const [kpis, setKpis] = React.useState<ClientKPI[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingKpi, setEditingKpi] = React.useState<ClientKPI | null>(null);
  const [formState, setFormState] = React.useState<KPIFormState>(getDefaultFormState(selectedYear));
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Delete confirmation
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  // Inline progress update
  const [updatingProgressId, setUpdatingProgressId] = React.useState<string | null>(null);
  const [progressValue, setProgressValue] = React.useState<string>("");
  const [updatingProgress, setUpdatingProgress] = React.useState(false);

  // Year options
  const yearOptions = React.useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear - 2; y <= currentYear + 2; y++) {
      years.push(y);
    }
    return years;
  }, []);

  // ── Fetch KPIs ─────────────────────────────────────────────────────────

  const fetchKpis = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/kpis?year=${selectedYear}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to fetch KPIs");
      }
      const data = await res.json();
      setKpis(Array.isArray(data) ? data : data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [institutionId, selectedYear]);

  React.useEffect(() => {
    fetchKpis();
  }, [fetchKpis]);

  // ── Group KPIs by category ─────────────────────────────────────────────

  const groupedKpis = React.useMemo(() => {
    const groups: Record<KPICategory, ClientKPI[]> = {
      RECRUITMENT: [],
      MARKET_DEVELOPMENT: [],
      RELATIONSHIP: [],
      ENGAGEMENT: [],
    };
    for (const kpi of kpis) {
      if (groups[kpi.category]) {
        groups[kpi.category].push(kpi);
      }
    }
    return groups;
  }, [kpis]);

  // ── Form helpers ───────────────────────────────────────────────────────

  function updateForm(field: keyof KPIFormState, value: string | number) {
    setFormState((prev) => ({ ...prev, [field]: value }));
  }

  function openAddDialog() {
    setEditingKpi(null);
    setFormState(getDefaultFormState(selectedYear));
    setFormError(null);
    setDialogOpen(true);
  }

  function openEditDialog(kpi: ClientKPI) {
    setEditingKpi(kpi);
    setFormState({
      category: kpi.category,
      name: kpi.name,
      description: kpi.description ?? "",
      targetValue: String(kpi.targetValue),
      currentValue: String(kpi.currentValue),
      unit: kpi.unit,
      period: kpi.period,
      year: kpi.year,
      month: kpi.month !== null ? String(kpi.month) : "",
      quarter: kpi.quarter !== null ? String(kpi.quarter) : "",
    });
    setFormError(null);
    setDialogOpen(true);
  }

  // ── Submit (Create / Update) ───────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!formState.name.trim()) {
      setFormError("Name is required");
      return;
    }
    if (!formState.targetValue || Number(formState.targetValue) <= 0) {
      setFormError("Target value must be greater than 0");
      return;
    }
    if (!formState.unit.trim()) {
      setFormError("Unit is required");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        category: formState.category,
        name: formState.name.trim(),
        description: formState.description.trim() || null,
        targetValue: Number(formState.targetValue),
        currentValue: Number(formState.currentValue) || 0,
        unit: formState.unit.trim(),
        period: formState.period,
        year: formState.year,
        month: formState.month ? Number(formState.month) : null,
        quarter: formState.quarter ? Number(formState.quarter) : null,
      };

      const url = editingKpi
        ? `/api/institutions/${institutionId}/kpis/${editingKpi.id}`
        : `/api/institutions/${institutionId}/kpis`;

      const res = await fetch(url, {
        method: editingKpi ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to ${editingKpi ? "update" : "create"} KPI`);
      }

      setDialogOpen(false);
      await fetchKpis();
      router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deletingId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/kpis/${deletingId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete KPI");
      }
      setDeletingId(null);
      await fetchKpis();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setDeletingId(null);
    } finally {
      setDeleting(false);
    }
  }

  // ── Update Progress ────────────────────────────────────────────────────

  async function handleUpdateProgress(kpiId: string) {
    if (!progressValue || isNaN(Number(progressValue))) return;
    setUpdatingProgress(true);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/kpis/${kpiId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentValue: Number(progressValue) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update progress");
      }
      setUpdatingProgressId(null);
      setProgressValue("");
      await fetchKpis();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setUpdatingProgress(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const hasKpis = kpis.length > 0;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Select
            value={String(selectedYear)}
            onValueChange={(v) => setSelectedYear(Number(v))}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {kpis.length} KPI{kpis.length !== 1 ? "s" : ""} tracked
          </span>
        </div>
        <Button
          size="sm"
          className="gap-2 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90"
          onClick={openAddDialog}
        >
          <Plus className="h-4 w-4" />
          Add KPI
        </Button>
      </div>

      {/* Error display */}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !hasKpis && (
        <div className="text-center py-12 text-slate-400 dark:text-slate-500">
          <Target className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No KPIs tracked for {selectedYear}.</p>
          <p className="text-xs mt-1">Add a KPI to start tracking performance.</p>
        </div>
      )}

      {/* KPI Categories */}
      {!loading &&
        CATEGORIES.map((cat) => {
          const items = groupedKpis[cat];
          if (items.length === 0) return null;
          const config = CATEGORY_CONFIG[cat];
          const CatIcon = config.icon;

          return (
            <Card key={cat}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg",
                      config.bgColor
                    )}
                  >
                    <CatIcon className={cn("h-4 w-4", config.color)} />
                  </div>
                  <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {config.label}
                  </CardTitle>
                  <Badge variant="outline" className="ml-auto text-xs">
                    {items.length} KPI{items.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {items.map((kpi, idx) => {
                  const pct = getPercentage(kpi.currentValue, kpi.targetValue);
                  const pctColor = getPercentageColor(pct);
                  const periodCfg = PERIOD_CONFIG[kpi.period];
                  const isUpdatingThis = updatingProgressId === kpi.id;

                  return (
                    <React.Fragment key={kpi.id}>
                      {idx > 0 && <Separator />}
                      <div className="space-y-3">
                        {/* KPI header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                {kpi.name}
                              </span>
                              <Badge
                                variant="outline"
                                className={cn("text-[10px] px-1.5 py-0", periodCfg.color)}
                              >
                                {periodCfg.label}
                              </Badge>
                              {kpi.month && (
                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                  Month {kpi.month}
                                </span>
                              )}
                              {kpi.quarter && (
                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                  Q{kpi.quarter}
                                </span>
                              )}
                            </div>
                            {kpi.description && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                {kpi.description}
                              </p>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                              onClick={() => openEditDialog(kpi)}
                              title="Edit KPI"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-slate-400 hover:text-red-600 dark:text-slate-500 dark:hover:text-red-400"
                              onClick={() => setDeletingId(kpi.id)}
                              title="Delete KPI"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>

                        {/* Progress */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {kpi.currentValue} / {kpi.targetValue} {kpi.unit}
                            </span>
                            <span className={cn("text-xs font-semibold", pctColor)}>
                              {pct}%
                            </span>
                          </div>
                          <Progress
                            value={pct}
                            className="h-2"
                            indicatorClassName={getProgressIndicatorClass(pct)}
                          />
                        </div>

                        {/* Inline progress update */}
                        {isUpdatingThis ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              step="any"
                              placeholder="New value"
                              value={progressValue}
                              onChange={(e) => setProgressValue(e.target.value)}
                              className="h-8 w-32 text-sm"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleUpdateProgress(kpi.id);
                                if (e.key === "Escape") {
                                  setUpdatingProgressId(null);
                                  setProgressValue("");
                                }
                              }}
                            />
                            <Button
                              size="sm"
                              className="h-8 text-xs bg-[#1E3A5F] hover:bg-[#1E3A5F]/90"
                              disabled={updatingProgress}
                              onClick={() => handleUpdateProgress(kpi.id)}
                            >
                              {updatingProgress ? "Saving..." : "Update"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs"
                              onClick={() => {
                                setUpdatingProgressId(null);
                                setProgressValue("");
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-slate-500 hover:text-[#1E3A5F] dark:text-slate-400 dark:hover:text-blue-300 px-2"
                            onClick={() => {
                              setUpdatingProgressId(kpi.id);
                              setProgressValue(String(kpi.currentValue));
                            }}
                          >
                            Update Progress
                          </Button>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}

      {/* ── Add/Edit Dialog ────────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingKpi ? "Edit KPI" : "Add KPI"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            {/* Category */}
            <div className="space-y-1.5">
              <Label>
                Category <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formState.category}
                onValueChange={(v) => updateForm("category", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RECRUITMENT">Recruitment</SelectItem>
                  <SelectItem value="MARKET_DEVELOPMENT">Market Development</SelectItem>
                  <SelectItem value="RELATIONSHIP">Relationship</SelectItem>
                  <SelectItem value="ENGAGEMENT">Engagement</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="kpi-name">
                Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="kpi-name"
                value={formState.name}
                onChange={(e) => updateForm("name", e.target.value)}
                placeholder="e.g. New student enrollments"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="kpi-desc">Description</Label>
              <Textarea
                id="kpi-desc"
                value={formState.description}
                onChange={(e) => updateForm("description", e.target.value)}
                placeholder="Optional description..."
                rows={2}
              />
            </div>

            {/* Target Value + Unit */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="kpi-target">
                  Target Value <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="kpi-target"
                  type="number"
                  step="any"
                  value={formState.targetValue}
                  onChange={(e) => updateForm("targetValue", e.target.value)}
                  placeholder="100"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kpi-unit">
                  Unit <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="kpi-unit"
                  value={formState.unit}
                  onChange={(e) => updateForm("unit", e.target.value)}
                  placeholder='e.g. students, visits, %'
                />
              </div>
            </div>

            {/* Current Value (for edit mode) */}
            {editingKpi && (
              <div className="space-y-1.5">
                <Label htmlFor="kpi-current">Current Value</Label>
                <Input
                  id="kpi-current"
                  type="number"
                  step="any"
                  value={formState.currentValue}
                  onChange={(e) => updateForm("currentValue", e.target.value)}
                />
              </div>
            )}

            {/* Period */}
            <div className="space-y-1.5">
              <Label>
                Period <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formState.period}
                onValueChange={(v) => updateForm("period", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                  <SelectItem value="ANNUAL">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Year */}
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Select
                value={String(formState.year)}
                onValueChange={(v) => updateForm("year", Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Month + Quarter */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="kpi-month">Month (optional)</Label>
                <Select
                  value={formState.month}
                  // NONE is a sentinel because Radix throws on an empty item
                  // value — it reserves "" for the cleared state. Kept as ""
                  // in form state so the payload's `month ? Number : null`
                  // still reads it as absent.
                  onValueChange={(v) => updateForm("month", v === NONE ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {Array.from({ length: 12 }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {new Date(2000, i, 1).toLocaleString("default", { month: "long" })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kpi-quarter">Quarter (optional)</Label>
                <Select
                  value={formState.quarter}
                  onValueChange={(v) => updateForm("quarter", v === NONE ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    <SelectItem value="1">Q1</SelectItem>
                    <SelectItem value="2">Q2</SelectItem>
                    <SelectItem value="3">Q3</SelectItem>
                    <SelectItem value="4">Q4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Form error */}
            {formError && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md dark:bg-red-500/15 dark:text-red-300">{formError}</p>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90"
              >
                {saving ? "Saving..." : editingKpi ? "Update KPI" : "Create KPI"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ─────────────────────────────────────── */}
      <Dialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete KPI</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Are you sure you want to delete this KPI? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setDeletingId(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
