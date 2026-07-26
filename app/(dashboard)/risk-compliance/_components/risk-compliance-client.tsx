"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import {
  ShieldAlert,
  AlertTriangle,
  ClipboardCheck,
  Clock,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { ExportButton } from "@/components/shared/export-button";
import type { RiskType, RiskStatus, ComplianceType } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────

interface RiskItem {
  id: string;
  type: RiskType;
  title: string;
  description: string | null;
  likelihood: number;
  impact: number;
  riskScore: number;
  mitigationPlan: string | null;
  status: RiskStatus;
  createdAt: Date | string;
  owner: { id: string; name: string | null };
  institution: { id: string; name: string } | null;
  market: { id: string; name: string } | null;
}

interface ComplianceItem {
  id: string;
  complianceType: ComplianceType;
  title: string;
  description: string | null;
  status: string;
  dueDate: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  assignedTo: { id: string; name: string | null } | null;
  institution: { id: string; name: string } | null;
}

interface Props {
  risks: RiskItem[];
  complianceItems: ComplianceItem[];
  users: { id: string; name: string | null }[];
  institutions: { id: string; name: string }[];
  markets: { id: string; name: string }[];
  canWrite: boolean;
  canDelete: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────

const RISK_TYPE_OPTIONS: { value: RiskType; label: string }[] = [
  { value: "MARKET", label: "Market" },
  { value: "STAFF", label: "Staff" },
  { value: "CLIENT", label: "Client" },
  { value: "OPERATIONAL", label: "Operational" },
];

const RISK_STATUS_OPTIONS: { value: RiskStatus; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "MITIGATED", label: "Mitigated" },
  { value: "CLOSED", label: "Closed" },
  { value: "ESCALATED", label: "Escalated" },
];

const COMPLIANCE_TYPE_OPTIONS: {
  value: ComplianceType;
  label: string;
  color: string;
}[] = [
  { value: "GDPR", label: "GDPR", color: "bg-blue-100 text-blue-700" },
  { value: "FOIPOP", label: "FOIPOP", color: "bg-cyan-100 text-cyan-700" },
  { value: "CASL", label: "CASL", color: "bg-amber-100 text-amber-700" },
  {
    value: "AGENT_COMPLIANCE",
    label: "Agent Compliance",
    color: "bg-green-100 text-green-700",
  },
  {
    value: "TRAINING",
    label: "Training",
    color: "bg-violet-100 text-violet-700",
  },
  { value: "OTHER", label: "Other", color: "bg-slate-100 text-slate-700" },
];

const COMPLIANCE_STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "OVERDUE", label: "Overdue" },
];

function getRiskScoreColor(score: number) {
  if (score >= 20) return "bg-purple-100 text-purple-700";
  if (score >= 15) return "bg-red-100 text-red-700";
  if (score >= 7) return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}

function getRiskStatusColor(status: RiskStatus) {
  switch (status) {
    case "OPEN":
      return "bg-amber-100 text-amber-700";
    case "MITIGATED":
      return "bg-green-100 text-green-700";
    case "CLOSED":
      return "bg-slate-100 text-slate-700";
    case "ESCALATED":
      return "bg-red-100 text-red-700";
  }
}

function getComplianceStatusColor(status: string) {
  switch (status) {
    case "PENDING":
      return "bg-amber-100 text-amber-700";
    case "IN_PROGRESS":
      return "bg-blue-100 text-blue-700";
    case "COMPLETED":
      return "bg-green-100 text-green-700";
    case "OVERDUE":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function getComplianceTypeConfig(type: ComplianceType) {
  return (
    COMPLIANCE_TYPE_OPTIONS.find((o) => o.value === type) ?? {
      value: type,
      label: type,
      color: "bg-slate-100 text-slate-700",
    }
  );
}

// ─── Component ───────────────────────────────────────────────────────────

export function RiskComplianceClient({
  risks,
  complianceItems,
  users,
  institutions,
  markets,
  canWrite,
  canDelete,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();

  // Risk filters
  const [riskTypeFilter, setRiskTypeFilter] = React.useState<string>("all");
  const [riskStatusFilter, setRiskStatusFilter] =
    React.useState<string>("all");

  // Compliance filters
  const [compTypeFilter, setCompTypeFilter] = React.useState<string>("all");
  const [compStatusFilter, setCompStatusFilter] =
    React.useState<string>("all");

  // Dialog state
  const [riskDialogOpen, setRiskDialogOpen] = React.useState(false);
  const [complianceDialogOpen, setComplianceDialogOpen] = React.useState(false);
  const [editingRisk, setEditingRisk] = React.useState<RiskItem | null>(null);
  const [editingCompliance, setEditingCompliance] =
    React.useState<ComplianceItem | null>(null);
  const [saving, setSaving] = React.useState(false);

  // ─── Stats ─────────────────────────────────────────────────────────────

  const openRisks = risks.filter((r) => r.status === "OPEN").length;
  const criticalRisks = risks.filter((r) => r.riskScore >= 20).length;
  const pendingCompliance = complianceItems.filter(
    (c) => c.status === "PENDING"
  ).length;
  const overdueCompliance = complianceItems.filter(
    (c) => c.status === "OVERDUE"
  ).length;

  // ─── Filtered data ────────────────────────────────────────────────────

  const filteredRisks = risks.filter((r) => {
    if (riskTypeFilter !== "all" && r.type !== riskTypeFilter) return false;
    if (riskStatusFilter !== "all" && r.status !== riskStatusFilter)
      return false;
    return true;
  });

  const filteredCompliance = complianceItems.filter((c) => {
    if (compTypeFilter !== "all" && c.complianceType !== compTypeFilter)
      return false;
    if (compStatusFilter !== "all" && c.status !== compStatusFilter)
      return false;
    return true;
  });

  // ─── Risk CRUD handlers ───────────────────────────────────────────────

  async function handleSaveRisk(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const body = {
      type: formData.get("type") as string,
      title: formData.get("title") as string,
      description: formData.get("description") as string,
      likelihood: Number(formData.get("likelihood")),
      impact: Number(formData.get("impact")),
      mitigationPlan: formData.get("mitigationPlan") as string,
      status: formData.get("status") as string,
      institutionId: (formData.get("institutionId") as string) || null,
      marketId: (formData.get("marketId") as string) || null,
    };

    try {
      const url = editingRisk
        ? `/api/risks/${editingRisk.id}`
        : "/api/risks";
      const method = editingRisk ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save risk");
      }

      toast({
        title: editingRisk ? "Risk updated" : "Risk created",
        description: `"${body.title}" has been ${editingRisk ? "updated" : "created"} successfully.`,
      });

      setRiskDialogOpen(false);
      setEditingRisk(null);
      router.refresh();
    } catch (err) {
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRisk(risk: RiskItem) {
    if (!confirm(`Delete risk "${risk.title}"?`)) return;

    try {
      const res = await fetch(`/api/risks/${risk.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete risk");

      toast({ title: "Risk deleted", description: `"${risk.title}" removed.` });
      router.refresh();
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete risk",
        variant: "destructive",
      });
    }
  }

  // ─── Compliance CRUD handlers ─────────────────────────────────────────

  async function handleSaveCompliance(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const body = {
      complianceType: formData.get("complianceType") as string,
      title: formData.get("title") as string,
      description: formData.get("description") as string,
      status: formData.get("status") as string,
      dueDate: (formData.get("dueDate") as string) || null,
      assignedToId: (formData.get("assignedToId") as string) || null,
      institutionId: (formData.get("institutionId") as string) || null,
    };

    try {
      const url = editingCompliance
        ? `/api/compliance/${editingCompliance.id}`
        : "/api/compliance";
      const method = editingCompliance ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save compliance item");
      }

      toast({
        title: editingCompliance
          ? "Compliance item updated"
          : "Compliance item created",
        description: `"${body.title}" has been ${editingCompliance ? "updated" : "created"} successfully.`,
      });

      setComplianceDialogOpen(false);
      setEditingCompliance(null);
      router.refresh();
    } catch (err) {
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCompliance(item: ComplianceItem) {
    if (!confirm(`Delete compliance item "${item.title}"?`)) return;

    try {
      const res = await fetch(`/api/compliance/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete compliance item");

      toast({
        title: "Compliance item deleted",
        description: `"${item.title}" removed.`,
      });
      router.refresh();
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete compliance item",
        variant: "destructive",
      });
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{openRisks}</p>
              <p className="text-xs text-slate-500">Open Risks</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-red-50 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {criticalRisks}
              </p>
              <p className="text-xs text-slate-500">Critical Risks</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <ClipboardCheck className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {pendingCompliance}
              </p>
              <p className="text-xs text-slate-500">Pending Compliance</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-red-50 flex items-center justify-center">
              <Clock className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {overdueCompliance}
              </p>
              <p className="text-xs text-slate-500">Overdue Compliance</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="risks">
        <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="risks">Risk Register</TabsTrigger>
          <TabsTrigger value="compliance">Compliance Tracker</TabsTrigger>
        </TabsList>
        <ExportButton
          exports={[
            {
              label: "Risks",
              data: risks.map((r) => ({
                title: r.title,
                type: r.type,
                likelihood: r.likelihood,
                impact: r.impact,
                riskScore: r.riskScore,
                status: r.status,
                owner: r.owner.name ?? "Unknown",
                institution: r.institution?.name ?? "—",
                market: r.market?.name ?? "—",
              })),
              columns: [
                { key: "title", header: "Title" },
                { key: "type", header: "Type" },
                { key: "likelihood", header: "Likelihood" },
                { key: "impact", header: "Impact" },
                { key: "riskScore", header: "Risk Score" },
                { key: "status", header: "Status" },
                { key: "owner", header: "Owner" },
                { key: "institution", header: "Institution" },
                { key: "market", header: "Market" },
              ],
              filename: "risks",
            },
            {
              label: "Compliance",
              data: complianceItems.map((c) => ({
                title: c.title,
                type: c.complianceType,
                status: c.status.replace(/_/g, " "),
                dueDate: formatDate(c.dueDate),
                assignedTo: c.assignedTo?.name ?? "Unassigned",
                institution: c.institution?.name ?? "—",
              })),
              columns: [
                { key: "title", header: "Title" },
                { key: "type", header: "Type" },
                { key: "status", header: "Status" },
                { key: "dueDate", header: "Due Date" },
                { key: "assignedTo", header: "Assigned To" },
                { key: "institution", header: "Institution" },
              ],
              filename: "compliance",
            },
          ]}
          title="Export Risk & Compliance"
        />
        </div>

        {/* ═══ Risk Register Tab ═══ */}
        <TabsContent value="risks">
          <Card>
            <CardContent className="p-4 space-y-4">
              {/* Filter row */}
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={riskTypeFilter}
                  onValueChange={setRiskTypeFilter}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {RISK_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={riskStatusFilter}
                  onValueChange={setRiskStatusFilter}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {RISK_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {canWrite && (
                  <Button
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      setEditingRisk(null);
                      setRiskDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Risk
                  </Button>
                )}
              </div>

              {/* Risk table */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-center">Likelihood</TableHead>
                      <TableHead className="text-center">Impact</TableHead>
                      <TableHead className="text-center">Risk Score</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Institution</TableHead>
                      {(canWrite || canDelete) && (
                        <TableHead className="text-right">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRisks.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={canWrite || canDelete ? 9 : 8}
                          className="text-center py-8 text-slate-400"
                        >
                          No risks found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRisks.map((risk) => (
                        <TableRow key={risk.id}>
                          <TableCell className="font-medium max-w-[200px] truncate">
                            {risk.title}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className="bg-slate-100 text-slate-700"
                            >
                              {risk.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {risk.likelihood}
                          </TableCell>
                          <TableCell className="text-center">
                            {risk.impact}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="secondary"
                              className={getRiskScoreColor(risk.riskScore)}
                            >
                              {risk.riskScore}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={getRiskStatusColor(risk.status)}
                            >
                              {risk.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {risk.owner.name ?? "Unknown"}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {risk.institution?.name ?? "---"}
                          </TableCell>
                          {(canWrite || canDelete) && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {canWrite && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setEditingRisk(risk);
                                      setRiskDialogOpen(true);
                                    }}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                )}
                                {canDelete && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteRisk(risk)}
                                  >
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ Compliance Tracker Tab ═══ */}
        <TabsContent value="compliance">
          <Card>
            <CardContent className="p-4 space-y-4">
              {/* Filter row */}
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={compTypeFilter}
                  onValueChange={setCompTypeFilter}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {COMPLIANCE_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={compStatusFilter}
                  onValueChange={setCompStatusFilter}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {COMPLIANCE_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {canWrite && (
                  <Button
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      setEditingCompliance(null);
                      setComplianceDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Compliance Item
                  </Button>
                )}
              </div>

              {/* Compliance table */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Assigned To</TableHead>
                      <TableHead>Institution</TableHead>
                      {(canWrite || canDelete) && (
                        <TableHead className="text-right">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCompliance.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={canWrite || canDelete ? 7 : 6}
                          className="text-center py-8 text-slate-400"
                        >
                          No compliance items found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredCompliance.map((item) => {
                        const typeCfg = getComplianceTypeConfig(
                          item.complianceType
                        );
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium max-w-[200px] truncate">
                              {item.title}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className={typeCfg.color}
                              >
                                {typeCfg.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className={getComplianceStatusColor(
                                  item.status
                                )}
                              >
                                {item.status.replace("_", " ")}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-slate-600">
                              {formatDate(item.dueDate)}
                            </TableCell>
                            <TableCell className="text-sm text-slate-600">
                              {item.assignedTo?.name ?? "---"}
                            </TableCell>
                            <TableCell className="text-sm text-slate-600">
                              {item.institution?.name ?? "---"}
                            </TableCell>
                            {(canWrite || canDelete) && (
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  {canWrite && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        setEditingCompliance(item);
                                        setComplianceDialogOpen(true);
                                      }}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {canDelete && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleDeleteCompliance(item)
                                      }
                                    >
                                      <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═══ Risk Dialog ═══ */}
      <Dialog open={riskDialogOpen} onOpenChange={setRiskDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRisk ? "Edit Risk" : "Add Risk"}
            </DialogTitle>
            <DialogDescription>
              {editingRisk
                ? "Update the risk details below."
                : "Fill in the details to create a new risk entry."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveRisk} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="risk-title">Title *</Label>
              <Input
                id="risk-title"
                name="title"
                required
                defaultValue={editingRisk?.title ?? ""}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="risk-type">Type *</Label>
                <select
                  id="risk-type"
                  name="type"
                  required
                  defaultValue={editingRisk?.type ?? "MARKET"}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                >
                  {RISK_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="risk-status">Status</Label>
                <select
                  id="risk-status"
                  name="status"
                  defaultValue={editingRisk?.status ?? "OPEN"}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                >
                  {RISK_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="risk-description">Description</Label>
              <Textarea
                id="risk-description"
                name="description"
                rows={3}
                defaultValue={editingRisk?.description ?? ""}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="risk-likelihood">Likelihood (1-5) *</Label>
                <Input
                  id="risk-likelihood"
                  name="likelihood"
                  type="number"
                  min={1}
                  max={5}
                  required
                  defaultValue={editingRisk?.likelihood ?? 3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="risk-impact">Impact (1-5) *</Label>
                <Input
                  id="risk-impact"
                  name="impact"
                  type="number"
                  min={1}
                  max={5}
                  required
                  defaultValue={editingRisk?.impact ?? 3}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="risk-mitigation">Mitigation Plan</Label>
              <Textarea
                id="risk-mitigation"
                name="mitigationPlan"
                rows={3}
                defaultValue={editingRisk?.mitigationPlan ?? ""}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="risk-institution">Institution</Label>
                <select
                  id="risk-institution"
                  name="institutionId"
                  defaultValue={editingRisk?.institution?.id ?? ""}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                >
                  <option value="">None</option>
                  {institutions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="risk-market">Market</Label>
                <select
                  id="risk-market"
                  name="marketId"
                  defaultValue={editingRisk?.market?.id ?? ""}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                >
                  <option value="">None</option>
                  {markets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRiskDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : editingRisk ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ Compliance Dialog ═══ */}
      <Dialog
        open={complianceDialogOpen}
        onOpenChange={setComplianceDialogOpen}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCompliance
                ? "Edit Compliance Item"
                : "Add Compliance Item"}
            </DialogTitle>
            <DialogDescription>
              {editingCompliance
                ? "Update the compliance item details below."
                : "Fill in the details to create a new compliance item."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveCompliance} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="comp-title">Title *</Label>
              <Input
                id="comp-title"
                name="title"
                required
                defaultValue={editingCompliance?.title ?? ""}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="comp-type">Type</Label>
                <select
                  id="comp-type"
                  name="complianceType"
                  defaultValue={editingCompliance?.complianceType ?? "OTHER"}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                >
                  {COMPLIANCE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="comp-status">Status</Label>
                <select
                  id="comp-status"
                  name="status"
                  defaultValue={editingCompliance?.status ?? "PENDING"}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                >
                  {COMPLIANCE_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="comp-description">Description</Label>
              <Textarea
                id="comp-description"
                name="description"
                rows={3}
                defaultValue={editingCompliance?.description ?? ""}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="comp-duedate">Due Date</Label>
                <Input
                  id="comp-duedate"
                  name="dueDate"
                  type="date"
                  defaultValue={
                    editingCompliance?.dueDate
                      ? new Date(editingCompliance.dueDate)
                          .toISOString()
                          .split("T")[0]
                      : ""
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="comp-assigned">Assigned To</Label>
                <select
                  id="comp-assigned"
                  name="assignedToId"
                  defaultValue={editingCompliance?.assignedTo?.id ?? ""}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name ?? u.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="comp-institution">Institution</Label>
              <select
                id="comp-institution"
                name="institutionId"
                defaultValue={editingCompliance?.institution?.id ?? ""}
                className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              >
                <option value="">None</option>
                {institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setComplianceDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingCompliance
                    ? "Update"
                    : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
