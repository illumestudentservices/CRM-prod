"use client";

import * as React from "react";
import { Loader2, Save, RotateCcw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

type LeaveType = "VACATION_PAID" | "SICK" | "MATERNITY" | "PATERNITY";
interface Row {
  leaveType: LeaveType;
  label: string;
  accrualMode: "MONTHLY_ON_JOINING" | "YEARLY_ON_DATE";
  isOverride: boolean;
  accrualDays: number;
  waitingPeriodValue: number;
  waitingPeriodUnit: string;
  maxBalance: number | null;
}
interface Region { id: string; name: string; code: string; policies: Record<LeaveType, Row> }
interface Table { regions: Region[]; defaults: Record<LeaveType, Row> }

const ORDER: LeaveType[] = ["VACATION_PAID", "SICK", "MATERNITY", "PATERNITY"];

export function LeavePoliciesClient({ initial }: { initial: Table }) {
  const { toast } = useToast();
  const [regions, setRegions] = React.useState<Region[]>(initial.regions);
  const [selectedId, setSelectedId] = React.useState<string>(initial.regions[0]?.id ?? "");
  const [saving, setSaving] = React.useState(false);

  const region = regions.find((r) => r.id === selectedId);

  function patchRow(leaveType: LeaveType, patch: Partial<Row>) {
    setRegions((prev) =>
      prev.map((r) =>
        r.id !== selectedId
          ? r
          : { ...r, policies: { ...r.policies, [leaveType]: { ...r.policies[leaveType], ...patch } } }
      )
    );
  }

  function resetRow(leaveType: LeaveType) {
    patchRow(leaveType, { ...initial.defaults[leaveType], isOverride: false });
  }

  function differsFromDefault(row: Row): boolean {
    const d = initial.defaults[row.leaveType];
    return (
      row.accrualDays !== d.accrualDays ||
      row.waitingPeriodValue !== d.waitingPeriodValue ||
      row.waitingPeriodUnit !== d.waitingPeriodUnit ||
      (row.maxBalance ?? null) !== (d.maxBalance ?? null)
    );
  }

  async function save() {
    if (!region) return;
    setSaving(true);
    try {
      const items = ORDER.map((t) => {
        const p = region.policies[t];
        return {
          leaveType: t,
          accrualDays: p.accrualDays,
          waitingPeriodValue: p.waitingPeriodValue,
          waitingPeriodUnit: p.waitingPeriodUnit,
          maxBalance: p.maxBalance,
        };
      });
      const res = await fetch("/api/hr/leave/policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regionId: region.id, items }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ title: "Could not save", description: json.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      setRegions((json as Table).regions);
      toast({ title: "Leave policy saved", description: `${region.name} updated — it applies immediately.` });
    } catch {
      toast({ title: "Could not save", description: "A network error occurred.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const num = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Region</Label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Choose a region" /></SelectTrigger>
            <SelectContent>
              {regions.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:ml-auto">
          <Button onClick={save} disabled={saving || !region}>
            {saving ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : <><Save className="size-4" /> Save {region?.name}</>}
          </Button>
        </div>
      </div>

      <Alert>
        <Info className="size-4" />
        <AlertDescription>
          These numbers apply to everyone whose region is <strong>{region?.name}</strong>. A field left at the
          default counts as no override. Entitlements recalculate immediately — no overnight job.
        </AlertDescription>
      </Alert>

      {region && ORDER.map((t) => {
        const row = region.policies[t];
        const perUnit = row.accrualMode === "MONTHLY_ON_JOINING" ? "per complete month" : "per year";
        const overridden = differsFromDefault(row);
        return (
          <Card key={t}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{row.label}</CardTitle>
                  <CardDescription>Days accrue {perUnit}.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {overridden
                    ? <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 hover:bg-amber-100">Overridden</Badge>
                    : <Badge variant="secondary">Default</Badge>}
                  <Button variant="ghost" size="sm" onClick={() => resetRow(t)} disabled={!overridden} title="Reset to default">
                    <RotateCcw className="size-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Days ({perUnit})</Label>
                  <Input
                    type="number" min={0} step={0.25} inputMode="decimal"
                    value={row.accrualDays}
                    onChange={(e) => patchRow(t, { accrualDays: num(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Waiting period</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number" min={0} step={1} inputMode="numeric" className="w-24"
                      value={row.waitingPeriodValue}
                      onChange={(e) => patchRow(t, { waitingPeriodValue: Math.round(num(e.target.value)) })}
                    />
                    <Select value={row.waitingPeriodUnit} onValueChange={(v) => patchRow(t, { waitingPeriodUnit: v })}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="days">days</SelectItem>
                        <SelectItem value="months">months</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max balance (cap)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={0} step={0.5} inputMode="decimal"
                      disabled={row.maxBalance === null}
                      value={row.maxBalance ?? ""}
                      placeholder="No cap"
                      onChange={(e) => patchRow(t, { maxBalance: e.target.value === "" ? null : num(e.target.value) })}
                    />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={row.maxBalance === null}
                        onChange={(e) => patchRow(t, { maxBalance: e.target.checked ? null : (initial.defaults[t].maxBalance ?? row.accrualDays) })}
                      />
                      No cap
                    </label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
