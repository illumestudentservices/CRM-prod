"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FileText, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";

interface Institution {
  id: string;
  name: string;
  country: string;
}

interface DataPreview {
  leadsCount: number;
  enrolledCount: number;
  eventsCount: number;
  sourcesCount: number;
}

const MONTHS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i).map(String);

export default function NewReportPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institutionId, setInstitutionId] = useState("");
  const [month, setMonth] = useState(String(new Date().getMonth() === 0 ? 12 : new Date().getMonth()));
  const [year, setYear] = useState(String(new Date().getMonth() === 0 ? currentYear - 1 : currentYear));
  const [preview, setPreview] = useState<DataPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load ICR's institutions
  useEffect(() => {
    async function fetchInstitutions() {
      try {
        const res = await fetch("/api/institutions");
        if (!res.ok) return;
        const json = await res.json();
        setInstitutions(Array.isArray(json) ? json : (json.institutions ?? []));
      } catch (e) {
        console.error(e);
      }
    }
    if (session) fetchInstitutions();
  }, [session]);

  // Load preview when selection changes
  useEffect(() => {
    if (!institutionId || !month || !year) {
      setPreview(null);
      return;
    }

    async function fetchPreview() {
      setPreviewLoading(true);
      try {
        const periodStart = new Date(Number(year), Number(month) - 1, 1).toISOString().split("T")[0];
        const periodEnd = new Date(Number(year), Number(month), 0).toISOString().split("T")[0];

        const [leadsRes, eventsRes] = await Promise.all([
          fetch(`/api/leads?institutionId=${institutionId}&startDate=${periodStart}&endDate=${periodEnd}&limit=1000`),
          fetch(`/api/events?institutionId=${institutionId}&startDate=${periodStart}&endDate=${periodEnd}&limit=100`),
        ]);

        let leadsCount = 0, enrolledCount = 0, sourcesCount = 0;
        if (leadsRes.ok) {
          const leadsJson = await leadsRes.json();
          const leads = leadsJson.leads ?? [];
          leadsCount = leads.length;
          enrolledCount = leads.filter((l: { stage: string }) => l.stage === "ENROLLED").length;
          const sourceSet = new Set(leads.map((l: { sourceId: string | null }) => l.sourceId).filter(Boolean));
          sourcesCount = sourceSet.size;
        }

        let eventsCount = 0;
        if (eventsRes.ok) {
          const eventsJson = await eventsRes.json();
          eventsCount = (eventsJson.events ?? []).length;
        }

        setPreview({ leadsCount, enrolledCount, eventsCount, sourcesCount });
      } catch (e) {
        console.error(e);
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }

    fetchPreview();
  }, [institutionId, month, year]);

  async function handleCreate() {
    if (!institutionId || !month || !year) {
      setError("Please select institution, month, and year");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institutionId,
          reportingMonth: Number(month),
          reportingYear: Number(year),
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        if (res.status === 409 && json.reportId) {
          // Already exists, redirect to edit
          router.push(`/reports/${json.reportId}/edit`);
          return;
        }
        setError(json.error ?? "Failed to create report");
        return;
      }

      router.push(`/reports/${json.id}/edit`);
    } catch (e) {
      setError("An unexpected error occurred");
      console.error(e);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <PageHeader
        title="Create Monthly Report"
        description="Select the institution and reporting period to generate a pre-populated report"
        breadcrumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Reports", href: "/reports" },
          { label: "New Report" },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#1E3A5F] dark:text-blue-300" />
            Report Parameters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Institution */}
          <div className="space-y-1.5">
            <Label htmlFor="institution" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Institution
            </Label>
            <Select value={institutionId} onValueChange={setInstitutionId}>
              <SelectTrigger id="institution">
                <SelectValue placeholder="Select an institution..." />
              </SelectTrigger>
              <SelectContent>
                {institutions.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.name} — {inst.country}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Month + Year */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="month" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Reporting Month
              </Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger id="month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="year" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Year
              </Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger id="year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Data Preview */}
          {institutionId && month && year && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Data Preview</h4>
              {previewLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading period data...
                </div>
              ) : preview ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: "Leads", value: preview.leadsCount },
                    { label: "Enrolled", value: preview.enrolledCount },
                    { label: "Events", value: preview.eventsCount },
                    { label: "Sources", value: preview.sourcesCount },
                  ].map((item) => (
                    <div key={item.label} className="text-center">
                      <p className="text-2xl font-bold text-[#1E3A5F] dark:text-blue-300">{item.value}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.label}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 dark:text-slate-500">Select all fields to preview data</p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg text-sm text-red-600 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => router.push("/reports")}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!institutionId || !month || !year || creating}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Report"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
