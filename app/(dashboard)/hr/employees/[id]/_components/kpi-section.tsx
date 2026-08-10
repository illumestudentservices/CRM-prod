"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Target, CheckCircle } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface KPITarget {
  id: string;
  title: string;
  description: string | null;
  target: string;
  current: string | null;
  unit: string | null;
  period: string;
  dueDate: Date | string | null;
  achieved: boolean;
}

export function KpiSection({
  employeeId,
  kpis: initialKpis,
  isHR,
}: {
  employeeId: string;
  kpis: KPITarget[];
  isHR: boolean;
}) {
  const { toast } = useToast();
  const [kpis, setKpis] = useState(initialKpis);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", target: "", current: "", unit: "", period: "", dueDate: "" });

  async function createKpi() {
    const res = await fetch(`/api/hr/employees/${employeeId}/kpis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, employeeId }),
    });
    const data = await res.json();
    if (res.ok) {
      toast({ title: "KPI added" });
      setKpis((prev) => [...prev, data.kpi]);
      setShowForm(false);
      setForm({ title: "", description: "", target: "", current: "", unit: "", period: "", dueDate: "" });
    }
  }

  function calcProgress(kpi: KPITarget): number {
    const cur = parseFloat(kpi.current ?? "0");
    const tgt = parseFloat(kpi.target);
    if (isNaN(cur) || isNaN(tgt) || tgt === 0) return 0;
    return Math.min(100, (cur / tgt) * 100);
  }

  const isNumeric = (kpi: KPITarget) => !isNaN(parseFloat(kpi.target));

  return (
    <div className="space-y-4">
      {isHR && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add KPI
          </Button>
        </div>
      )}

      {kpis.length === 0
        ? (
          <div className="text-center py-12 text-muted-foreground">
            <Target className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>No KPIs assigned yet.</p>
          </div>
        )
        : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {kpis.map((kpi) => (
              <Card key={kpi.id} className={kpi.achieved ? "border-green-300 bg-green-50/30 dark:border-green-500/30 dark:bg-green-500/10" : ""}>
                <CardHeader className="py-3 px-4">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm">{kpi.title}</CardTitle>
                    {kpi.achieved && (
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{kpi.period}</p>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  {kpi.description && <p className="text-xs text-muted-foreground">{kpi.description}</p>}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Target</span>
                    <span className="font-semibold">{kpi.target}{kpi.unit ? ` ${kpi.unit}` : ""}</span>
                  </div>
                  {kpi.current && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Current</span>
                      <span className="font-semibold text-[#0EA5E9]">{kpi.current}{kpi.unit ? ` ${kpi.unit}` : ""}</span>
                    </div>
                  )}
                  {isNumeric(kpi) && kpi.current && (
                    <Progress value={calcProgress(kpi)} className="h-2 mt-1" />
                  )}
                  {kpi.dueDate && (
                    <p className="text-xs text-muted-foreground">Due: {formatDate(kpi.dueDate)}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add KPI Target</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Student Enrollments" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Target *</Label>
                <Input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="50" />
              </div>
              <div className="space-y-2">
                <Label>Current</Label>
                <Input value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} placeholder="12" />
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="students" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Period *</Label>
                <Input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="Q1 2025" />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={createKpi} disabled={!form.title || !form.target}>Add KPI</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
