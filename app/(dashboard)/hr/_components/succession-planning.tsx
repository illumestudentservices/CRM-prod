"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { useRouter } from "next/navigation";

interface SuccessionPlan {
  id: string;
  employeeId: string;
  backupPersonnel: string;
  crossTraining: string | null;
  emergencyCoverage: string | null;
  readinessLevel: string;
  notes: string | null;
  createdAt: string;
  employee: {
    id: string;
    employeeId: string;
    jobTitle: string;
    user: { id: string; name: string | null; image: string | null };
  };
}

interface Employee {
  id: string;
  employeeId: string;
  jobTitle: string;
  user: { name: string | null };
}

const READINESS_BADGE: Record<string, { variant: "warning" | "success" | "destructive"; label: string }> = {
  DEVELOPING: { variant: "warning", label: "Developing" },
  READY: { variant: "success", label: "Ready" },
  AT_RISK: { variant: "destructive", label: "At Risk" },
};

export function SuccessionPlanning({ isHR }: { isHR: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const [plans, setPlans] = useState<SuccessionPlan[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterReadiness, setFilterReadiness] = useState("all");

  // Dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [editPlan, setEditPlan] = useState<SuccessionPlan | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formEmployeeId, setFormEmployeeId] = useState("");
  const [formBackupPersonnel, setFormBackupPersonnel] = useState("");
  const [formCrossTraining, setFormCrossTraining] = useState("");
  const [formEmergencyCoverage, setFormEmergencyCoverage] = useState("");
  const [formReadinessLevel, setFormReadinessLevel] = useState("DEVELOPING");
  const [formNotes, setFormNotes] = useState("");

  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch("/api/hr/succession-plans");
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans);
      }
    } catch {
      toast({ title: "Error", description: "Failed to load succession plans", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/hr/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees ?? []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchPlans();
    fetchEmployees();
  }, [fetchPlans, fetchEmployees]);

  const resetForm = () => {
    setFormEmployeeId("");
    setFormBackupPersonnel("");
    setFormCrossTraining("");
    setFormEmergencyCoverage("");
    setFormReadinessLevel("DEVELOPING");
    setFormNotes("");
  };

  const openCreate = () => {
    resetForm();
    setEditPlan(null);
    setShowCreate(true);
  };

  const openEdit = (plan: SuccessionPlan) => {
    setFormEmployeeId(plan.employeeId);
    setFormBackupPersonnel(plan.backupPersonnel);
    setFormCrossTraining(plan.crossTraining ?? "");
    setFormEmergencyCoverage(plan.emergencyCoverage ?? "");
    setFormReadinessLevel(plan.readinessLevel);
    setFormNotes(plan.notes ?? "");
    setEditPlan(plan);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!editPlan && !formEmployeeId) {
      toast({ title: "Error", description: "Please select an employee", variant: "destructive" });
      return;
    }
    if (!formBackupPersonnel.trim()) {
      toast({ title: "Error", description: "Backup personnel is required", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        employeeId: formEmployeeId,
        backupPersonnel: formBackupPersonnel,
        crossTraining: formCrossTraining || null,
        emergencyCoverage: formEmergencyCoverage || null,
        readinessLevel: formReadinessLevel,
        notes: formNotes || null,
      };

      let res: Response;
      if (editPlan) {
        res = await fetch(`/api/hr/succession-plans/${editPlan.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/hr/succession-plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to save");
      }

      toast({ title: "Success", description: editPlan ? "Plan updated" : "Plan created", variant: "success" });
      setShowCreate(false);
      resetForm();
      setEditPlan(null);
      fetchPlans();
      router.refresh();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save plan",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this succession plan?")) return;
    try {
      const res = await fetch(`/api/hr/succession-plans/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ title: "Deleted", description: "Plan deleted", variant: "success" });
      fetchPlans();
      router.refresh();
    } catch {
      toast({ title: "Error", description: "Failed to delete plan", variant: "destructive" });
    }
  };

  // Filter out employees who already have a plan (for create)
  const employeesWithPlan = new Set(plans.map((p) => p.employeeId));
  const availableEmployees = employees.filter((e) => !employeesWithPlan.has(e.id));

  const filtered = plans.filter((p) => {
    const matchesSearch =
      !search ||
      p.employee.user.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.employee.jobTitle.toLowerCase().includes(search.toLowerCase()) ||
      p.backupPersonnel.toLowerCase().includes(search.toLowerCase());
    const matchesReadiness = filterReadiness === "all" || p.readinessLevel === filterReadiness;
    return matchesSearch && matchesReadiness;
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search plans..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterReadiness} onValueChange={setFilterReadiness}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Readiness</SelectItem>
              <SelectItem value="DEVELOPING">Developing</SelectItem>
              <SelectItem value="READY">Ready</SelectItem>
              <SelectItem value="AT_RISK">At Risk</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isHR && (
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Create Plan
          </Button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No succession plans found.</div>
      ) : (
        <div className="rounded-lg border bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left p-3 font-medium">Employee</th>
                <th className="text-left p-3 font-medium">Job Title</th>
                <th className="text-left p-3 font-medium">Backup Personnel</th>
                <th className="text-left p-3 font-medium">Readiness</th>
                <th className="text-left p-3 font-medium">Cross-Training</th>
                <th className="text-left p-3 font-medium">Emergency Coverage</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((plan) => {
                const badge = READINESS_BADGE[plan.readinessLevel] ?? { variant: "secondary" as const, label: plan.readinessLevel };
                return (
                  <tr key={plan.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="p-3 font-medium">{plan.employee.user.name ?? "Unknown"}</td>
                    <td className="p-3 text-muted-foreground">{plan.employee.jobTitle}</td>
                    <td className="p-3">{plan.backupPersonnel}</td>
                    <td className="p-3">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className="p-3 text-muted-foreground max-w-[200px] truncate">
                      {plan.crossTraining || "--"}
                    </td>
                    <td className="p-3 text-muted-foreground max-w-[200px] truncate">
                      {plan.emergencyCoverage || "--"}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isHR && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => openEdit(plan)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(plan.id)}>
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </>
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

      {/* Create / Edit Dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) { setShowCreate(false); setEditPlan(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editPlan ? "Edit Succession Plan" : "Create Succession Plan"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editPlan && (
              <div className="space-y-1.5">
                <Label>Employee</Label>
                <Select value={formEmployeeId} onValueChange={setFormEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableEmployees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.user.name ?? emp.employeeId} - {emp.jobTitle}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Backup Personnel</Label>
              <Input
                placeholder="Name of backup person"
                value={formBackupPersonnel}
                onChange={(e) => setFormBackupPersonnel(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Readiness Level</Label>
              <Select value={formReadinessLevel} onValueChange={setFormReadinessLevel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEVELOPING">Developing</SelectItem>
                  <SelectItem value="READY">Ready</SelectItem>
                  <SelectItem value="AT_RISK">At Risk</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Cross-Training Status</Label>
              <Textarea
                rows={3}
                placeholder="Describe cross-training activities and progress..."
                value={formCrossTraining}
                onChange={(e) => setFormCrossTraining(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Emergency Coverage</Label>
              <Textarea
                rows={3}
                placeholder="Emergency coverage plan details..."
                value={formEmergencyCoverage}
                onChange={(e) => setFormEmergencyCoverage(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                rows={3}
                placeholder="Additional notes..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setEditPlan(null); }}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editPlan ? "Update Plan" : "Create Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
