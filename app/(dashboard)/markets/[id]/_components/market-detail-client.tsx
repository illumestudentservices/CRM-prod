"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  School,
  Activity,
  AlertTriangle,
  Save,
  Loader2,
} from "lucide-react";
import type {
  MarketRiskLevel,
  ActivityType,
  RelationshipStatus,
  SchoolType,
  RiskType,
  RiskStatus,
} from "@prisma/client";
import { formatDate } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

interface SchoolItem {
  id: string;
  name: string;
  country: string;
  city: string | null;
  type: SchoolType;
  relationshipStatus: RelationshipStatus;
  studentVolume: number | null;
  lastVisitDate: Date | string | null;
  _count: { counsellors: number };
}

interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  date: Date | string;
  location: string | null;
  studentsEngaged: number | null;
  leadsGenerated: number | null;
  user: { id: string; name: string | null };
}

interface RiskItem {
  id: string;
  type: RiskType;
  title: string;
  description: string | null;
  likelihood: number;
  impact: number;
  riskScore: number;
  status: RiskStatus;
  mitigationPlan: string | null;
  owner: { id: string; name: string | null };
}

interface MarketData {
  id: string;
  name: string;
  code: string;
  countryCode: string | null;
  politicalRiskLevel: MarketRiskLevel;
  healthScore: number | null;
  isActive: boolean;
  studentMobilityNotes: string | null;
  competitorInstitutions: string | null;
  visaTrends: string | null;
  currencyTrends: string | null;
  recruitmentOpportunities: string | null;
  govtStakeholders: string | null;
  industryAssociations: string | null;
  schools: SchoolItem[];
  activities: ActivityItem[];
  riskRegisters: RiskItem[];
  _count: { schools: number; activities: number; riskRegisters: number };
}

interface MarketDetailClientProps {
  market: MarketData;
  canWrite: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const RISK_BADGE: Record<string, string> = {
  LOW: "bg-blue-100 text-blue-700 border-blue-200",
  MEDIUM_RISK: "bg-amber-100 text-amber-700 border-amber-200",
  HIGH_RISK: "bg-red-100 text-red-700 border-red-200",
  CRITICAL: "bg-red-200 text-red-800 border-red-300",
};

const RISK_LABEL: Record<string, string> = {
  LOW: "Low",
  MEDIUM_RISK: "Medium Risk",
  HIGH_RISK: "High Risk",
  CRITICAL: "Critical",
};

const RELATIONSHIP_BADGE: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-600 border-slate-200",
  DEVELOPING: "bg-blue-100 text-blue-700 border-blue-200",
  ESTABLISHED: "bg-green-100 text-green-700 border-green-200",
  STRATEGIC: "bg-purple-100 text-purple-700 border-purple-200",
  AT_RISK: "bg-red-100 text-red-700 border-red-200",
  DORMANT: "bg-slate-200 text-slate-500 border-slate-300",
};

const RISK_STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-amber-100 text-amber-700 border-amber-200",
  MITIGATED: "bg-green-100 text-green-700 border-green-200",
  CLOSED: "bg-slate-100 text-slate-500 border-slate-200",
  ESCALATED: "bg-red-100 text-red-700 border-red-200",
};

function HealthScoreBar({ score }: { score: number | null }) {
  if (score == null)
    return <span className="text-sm text-slate-400">Not scored</span>;
  const color =
    score >= 80
      ? "bg-green-500"
      : score >= 60
        ? "bg-cyan-500"
        : score >= 40
          ? "bg-amber-500"
          : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className="h-2.5 flex-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
        {score}/100
      </span>
    </div>
  );
}

// ─── Intelligence Fields ───────────────────────────────────────────────────

const INTEL_FIELDS = [
  {
    key: "studentMobilityNotes" as const,
    label: "Student Mobility Notes",
    description: "Trends and patterns in student movement for this market",
  },
  {
    key: "competitorInstitutions" as const,
    label: "Competitor Institutions",
    description: "Key competing institutions operating in this market",
  },
  {
    key: "visaTrends" as const,
    label: "Visa Trends",
    description: "Current visa processing trends and policy changes",
  },
  {
    key: "currencyTrends" as const,
    label: "Currency Trends",
    description: "Currency fluctuations and financial considerations",
  },
  {
    key: "recruitmentOpportunities" as const,
    label: "Recruitment Opportunities",
    description: "Identified opportunities for student recruitment",
  },
  {
    key: "govtStakeholders" as const,
    label: "Government Stakeholders",
    description: "Key government contacts and regulatory bodies",
  },
  {
    key: "industryAssociations" as const,
    label: "Industry Associations",
    description: "Relevant industry bodies and associations",
  },
];

type IntelKey = (typeof INTEL_FIELDS)[number]["key"];

// ─── Component ─────────────────────────────────────────────────────────────

export function MarketDetailClient({
  market,
  canWrite,
}: MarketDetailClientProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [intelValues, setIntelValues] = useState<Record<IntelKey, string>>({
    studentMobilityNotes: market.studentMobilityNotes ?? "",
    competitorInstitutions: market.competitorInstitutions ?? "",
    visaTrends: market.visaTrends ?? "",
    currencyTrends: market.currencyTrends ?? "",
    recruitmentOpportunities: market.recruitmentOpportunities ?? "",
    govtStakeholders: market.govtStakeholders ?? "",
    industryAssociations: market.industryAssociations ?? "",
  });

  async function handleSaveIntelligence() {
    setSaving(true);
    try {
      const res = await fetch(`/api/markets/${market.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intelValues),
      });
      if (!res.ok) throw new Error("Failed to save");
      router.refresh();
    } catch (error) {
      console.error("[MarketDetail] save intelligence error:", error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Tabs defaultValue="overview">
      <TabsList className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex-wrap h-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
        <TabsTrigger value="schools">
          Schools ({market._count.schools})
        </TabsTrigger>
        <TabsTrigger value="activities">
          Activities ({market._count.activities})
        </TabsTrigger>
        <TabsTrigger value="risks">
          Risks ({market._count.riskRegisters})
        </TabsTrigger>
      </TabsList>

      {/* ─── Overview Tab ──────────────────────────────────────────────── */}
      <TabsContent value="overview" className="mt-4 space-y-6">
        {/* Health Score */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Market Health Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HealthScoreBar score={market.healthScore} />
          </CardContent>
        </Card>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            {
              label: "Schools",
              value: market._count.schools,
              icon: School,
              cls: "text-slate-900",
            },
            {
              label: "Activities",
              value: market._count.activities,
              icon: Activity,
              cls: "text-cyan-600",
            },
            {
              label: "Risk Items",
              value: market._count.riskRegisters,
              icon: AlertTriangle,
              cls: "text-amber-600",
            },
            {
              label: "Risk Level",
              value: RISK_LABEL[market.politicalRiskLevel] ?? market.politicalRiskLevel,
              icon: AlertTriangle,
              cls:
                market.politicalRiskLevel === "LOW"
                  ? "text-blue-600"
                  : market.politicalRiskLevel === "MEDIUM_RISK"
                    ? "text-amber-600"
                    : "text-red-600",
            },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <s.icon className="h-5 w-5 text-slate-400 mx-auto mb-2" />
                <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-xs text-slate-500 mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </TabsContent>

      {/* ─── Intelligence Tab ──────────────────────────────────────────── */}
      <TabsContent value="intelligence" className="mt-4 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Market Intelligence
              </CardTitle>
              {canWrite && (
                <Button
                  size="sm"
                  onClick={handleSaveIntelligence}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1.5" />
                  )}
                  Save Changes
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Political Risk Level (read-only display) */}
            <div>
              <Label className="text-xs text-slate-500 uppercase tracking-wider">
                Political Risk Level
              </Label>
              <div className="mt-1">
                <Badge
                  variant="outline"
                  className={
                    RISK_BADGE[market.politicalRiskLevel] ??
                    "bg-slate-100 dark:bg-slate-800 text-slate-600"
                  }
                >
                  {RISK_LABEL[market.politicalRiskLevel] ??
                    market.politicalRiskLevel}
                </Badge>
              </div>
            </div>

            {INTEL_FIELDS.map((field) => (
              <div key={field.key}>
                <Label
                  htmlFor={field.key}
                  className="text-xs text-slate-500 uppercase tracking-wider"
                >
                  {field.label}
                </Label>
                <p className="text-xs text-slate-400 mt-0.5 mb-1.5">
                  {field.description}
                </p>
                {canWrite ? (
                  <Textarea
                    id={field.key}
                    value={intelValues[field.key]}
                    onChange={(e) =>
                      setIntelValues((prev) => ({
                        ...prev,
                        [field.key]: e.target.value,
                      }))
                    }
                    rows={3}
                    className="text-sm"
                    placeholder={`Enter ${field.label.toLowerCase()}...`}
                  />
                ) : (
                  <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-900/40 rounded-md p-3 min-h-[60px]">
                    {intelValues[field.key] || (
                      <span className="text-slate-400 italic">
                        No data entered
                      </span>
                    )}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ─── Schools Tab ───────────────────────────────────────────────── */}
      <TabsContent value="schools" className="mt-4">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead>Name</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Students</TableHead>
                  <TableHead className="text-right">Counsellors</TableHead>
                  <TableHead>Last Visit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {market.schools.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-slate-400 py-8"
                    >
                      No schools in this market yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  market.schools.map((school) => (
                    <TableRow key={school.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {school.name}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {[school.city, school.country]
                          .filter(Boolean)
                          .join(", ")}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {school.type}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            RELATIONSHIP_BADGE[school.relationshipStatus] ??
                            "bg-slate-100 dark:bg-slate-800 text-slate-600"
                          }
                        >
                          {school.relationshipStatus.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums">
                        {school.studentVolume ?? "---"}
                      </TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums">
                        {school._count.counsellors}
                      </TableCell>
                      <TableCell className="text-slate-500 text-sm">
                        {formatDate(school.lastVisitDate)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ─── Activities Tab ────────────────────────────────────────────── */}
      <TabsContent value="activities" className="mt-4">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Students</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {market.activities.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-slate-400 py-8"
                    >
                      No activities recorded for this market.
                    </TableCell>
                  </TableRow>
                ) : (
                  market.activities.map((activity) => (
                    <TableRow key={activity.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {activity.title}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="bg-slate-100 dark:bg-slate-800 text-slate-600 border-slate-200 dark:border-slate-800"
                        >
                          {activity.type.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600 text-sm">
                        {formatDate(activity.date)}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {activity.location ?? "---"}
                      </TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums">
                        {activity.studentsEngaged ?? "---"}
                      </TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums">
                        {activity.leadsGenerated ?? "---"}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {activity.user.name ?? "Unknown"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ─── Risks Tab ─────────────────────────────────────────────────── */}
      <TabsContent value="risks" className="mt-4">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Likelihood</TableHead>
                  <TableHead className="text-right">Impact</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {market.riskRegisters.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-slate-400 py-8"
                    >
                      No risk items registered for this market.
                    </TableCell>
                  </TableRow>
                ) : (
                  market.riskRegisters.map((risk) => (
                    <TableRow key={risk.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-100">
                            {risk.title}
                          </p>
                          {risk.description && (
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                              {risk.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="bg-slate-100 dark:bg-slate-800 text-slate-600 border-slate-200 dark:border-slate-800"
                        >
                          {risk.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            RISK_STATUS_BADGE[risk.status] ??
                            "bg-slate-100 dark:bg-slate-800 text-slate-600"
                          }
                        >
                          {risk.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums">
                        {risk.likelihood}
                      </TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums">
                        {risk.impact}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`font-semibold tabular-nums ${
                            risk.riskScore >= 15
                              ? "text-red-600"
                              : risk.riskScore >= 8
                                ? "text-amber-600"
                                : "text-green-600"
                          }`}
                        >
                          {risk.riskScore}
                        </span>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {risk.owner.name ?? "Unknown"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
