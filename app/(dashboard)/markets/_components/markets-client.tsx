"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Globe, School, Activity, AlertTriangle, Plus, Loader2 } from "lucide-react";
import { ExportButton } from "@/components/shared/export-button";
import type { MarketRiskLevel } from "@prisma/client";

interface MarketItem {
  id: string;
  name: string;
  code: string;
  countryCode: string | null;
  politicalRiskLevel: MarketRiskLevel;
  healthScore: number | null;
  isActive: boolean;
  _count: { schools: number; activities: number; riskRegisters: number };
}

interface MarketsClientProps {
  markets: MarketItem[];
  canWrite: boolean;
}

const RISK_COLOR: Record<string, string> = {
  LOW: "bg-green-100 text-green-700 border-green-200",
  MEDIUM_RISK: "bg-amber-100 text-amber-700 border-amber-200",
  HIGH_RISK: "bg-red-100 text-red-700 border-red-200",
  CRITICAL: "bg-red-200 text-red-800 border-red-300",
};

function HealthScoreBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-slate-400">Not scored</span>;
  const color = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-cyan-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono text-slate-500">{score}</span>
    </div>
  );
}

function CreateMarketDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    code: "",
    countryCode: "",
    politicalRiskLevel: "LOW" as MarketRiskLevel,
    healthScore: "",
    studentMobilityNotes: "",
  });

  async function handleCreate() {
    if (!form.name.trim() || !form.code.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/markets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim(),
          countryCode: form.countryCode.trim() || null,
          politicalRiskLevel: form.politicalRiskLevel,
          healthScore: form.healthScore ? Number(form.healthScore) : null,
          studentMobilityNotes: form.studentMobilityNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create market");
      }
      setOpen(false);
      setForm({
        name: "",
        code: "",
        countryCode: "",
        politicalRiskLevel: "LOW",
        healthScore: "",
        studentMobilityNotes: "",
      });
      router.refresh();
    } catch (error) {
      console.error("[CreateMarket]", error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          Create Market
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Market</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="market-name">Name *</Label>
              <Input
                id="market-name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. United Kingdom"
              />
            </div>
            <div>
              <Label htmlFor="market-code">Code *</Label>
              <Input
                id="market-code"
                value={form.code}
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                placeholder="e.g. UK"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="market-country">Country Code</Label>
              <Input
                id="market-country"
                value={form.countryCode}
                onChange={(e) =>
                  setForm((p) => ({ ...p, countryCode: e.target.value }))
                }
                placeholder="e.g. GB"
              />
            </div>
            <div>
              <Label htmlFor="market-health">Health Score (0-100)</Label>
              <Input
                id="market-health"
                type="number"
                min={0}
                max={100}
                value={form.healthScore}
                onChange={(e) =>
                  setForm((p) => ({ ...p, healthScore: e.target.value }))
                }
                placeholder="e.g. 75"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="market-risk">Political Risk Level</Label>
            <Select
              value={form.politicalRiskLevel}
              onValueChange={(val) =>
                setForm((p) => ({
                  ...p,
                  politicalRiskLevel: val as MarketRiskLevel,
                }))
              }
            >
              <SelectTrigger id="market-risk">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM_RISK">Medium Risk</SelectItem>
                <SelectItem value="HIGH_RISK">High Risk</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="market-notes">Student Mobility Notes</Label>
            <Textarea
              id="market-notes"
              value={form.studentMobilityNotes}
              onChange={(e) =>
                setForm((p) => ({ ...p, studentMobilityNotes: e.target.value }))
              }
              rows={3}
              placeholder="Optional notes on student mobility..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving || !form.name.trim() || !form.code.trim()}
            >
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MarketsClient({ markets, canWrite }: MarketsClientProps) {
  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex justify-end gap-2">
        <ExportButton
          data={markets.map((m) => ({
            name: m.name,
            code: m.code,
            countryCode: m.countryCode ?? "—",
            politicalRiskLevel: m.politicalRiskLevel.replace(/_/g, " "),
            healthScore: m.healthScore ?? "—",
            schools: m._count.schools,
            activities: m._count.activities,
            risks: m._count.riskRegisters,
            isActive: m.isActive ? "Yes" : "No",
          }))}
          columns={[
            { key: "name", header: "Name" },
            { key: "code", header: "Code" },
            { key: "countryCode", header: "Country Code" },
            { key: "politicalRiskLevel", header: "Political Risk Level" },
            { key: "healthScore", header: "Health Score" },
            { key: "schools", header: "Schools" },
            { key: "activities", header: "Activities" },
            { key: "risks", header: "Risks" },
            { key: "isActive", header: "Active" },
          ]}
          filename="markets"
          title="Export Markets"
        />
        {canWrite && <CreateMarketDialog />}
      </div>

      {markets.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Globe className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No markets created yet.</p>
            {canWrite && (
              <p className="text-slate-400 text-xs mt-1">
                Click &quot;Create Market&quot; above to add your first market.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {markets.map((m) => (
            <Link key={m.id} href={`/markets/${m.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">{m.name}</h3>
                      <p className="text-xs text-slate-400 font-mono">{m.code}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        RISK_COLOR[m.politicalRiskLevel] ??
                        "bg-slate-100 text-slate-600"
                      }
                    >
                      {m.politicalRiskLevel.replace(/_/g, " ")}
                    </Badge>
                  </div>

                  <div className="mb-3">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      Health Score
                    </span>
                    <HealthScoreBar score={m.healthScore} />
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-100">
                    <div className="text-center">
                      <School className="h-3.5 w-3.5 text-slate-400 mx-auto mb-1" />
                      <p className="text-sm font-semibold text-slate-700">
                        {m._count.schools}
                      </p>
                      <p className="text-[10px] text-slate-400">Schools</p>
                    </div>
                    <div className="text-center">
                      <Activity className="h-3.5 w-3.5 text-slate-400 mx-auto mb-1" />
                      <p className="text-sm font-semibold text-slate-700">
                        {m._count.activities}
                      </p>
                      <p className="text-[10px] text-slate-400">Activities</p>
                    </div>
                    <div className="text-center">
                      <AlertTriangle className="h-3.5 w-3.5 text-slate-400 mx-auto mb-1" />
                      <p className="text-sm font-semibold text-slate-700">
                        {m._count.riskRegisters}
                      </p>
                      <p className="text-[10px] text-slate-400">Risks</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
