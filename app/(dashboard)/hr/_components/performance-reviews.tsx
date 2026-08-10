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
import { Plus, Pencil, Trash2, Search, Star } from "lucide-react";
import { useRouter } from "next/navigation";

interface PerformanceReview {
  id: string;
  employeeId: string;
  reviewerId: string;
  period: string;
  score: number | null;
  strengths: string | null;
  improvements: string | null;
  goals: string | null;
  status: string;
  completedAt: string | null;
  createdAt: string;
  reviewerName: string;
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

const STATUS_BADGE: Record<string, { variant: "warning" | "default" | "success"; label: string }> = {
  PENDING: { variant: "warning", label: "Pending" },
  IN_PROGRESS: { variant: "default", label: "In Progress" },
  COMPLETED: { variant: "success", label: "Completed" },
};

export function PerformanceReviews({ isHR }: { isHR: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  // Dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [editReview, setEditReview] = useState<PerformanceReview | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formEmployeeId, setFormEmployeeId] = useState("");
  const [formPeriod, setFormPeriod] = useState("");
  const [formScore, setFormScore] = useState("");
  const [formStrengths, setFormStrengths] = useState("");
  const [formImprovements, setFormImprovements] = useState("");
  const [formGoals, setFormGoals] = useState("");
  const [formStatus, setFormStatus] = useState("PENDING");

  const fetchReviews = useCallback(async () => {
    try {
      const res = await fetch("/api/hr/performance-reviews");
      if (res.ok) {
        const data = await res.json();
        setReviews(data.reviews);
      }
    } catch {
      toast({ title: "Error", description: "Failed to load reviews", variant: "destructive" });
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
    fetchReviews();
    fetchEmployees();
  }, [fetchReviews, fetchEmployees]);

  const resetForm = () => {
    setFormEmployeeId("");
    setFormPeriod("");
    setFormScore("");
    setFormStrengths("");
    setFormImprovements("");
    setFormGoals("");
    setFormStatus("PENDING");
  };

  const openCreate = () => {
    resetForm();
    setEditReview(null);
    setShowCreate(true);
  };

  const openEdit = (review: PerformanceReview) => {
    setFormEmployeeId(review.employeeId);
    setFormPeriod(review.period);
    setFormScore(review.score?.toString() ?? "");
    setFormStrengths(review.strengths ?? "");
    setFormImprovements(review.improvements ?? "");
    setFormGoals(review.goals ?? "");
    setFormStatus(review.status);
    setEditReview(review);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!editReview && !formEmployeeId) {
      toast({ title: "Error", description: "Please select an employee", variant: "destructive" });
      return;
    }
    if (!formPeriod.trim()) {
      toast({ title: "Error", description: "Period is required", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        employeeId: formEmployeeId,
        period: formPeriod,
        score: formScore ? parseFloat(formScore) : null,
        strengths: formStrengths || null,
        improvements: formImprovements || null,
        goals: formGoals || null,
        status: formStatus,
      };

      let res: Response;
      if (editReview) {
        res = await fetch(`/api/hr/performance-reviews/${editReview.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/hr/performance-reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to save");
      }

      toast({ title: "Success", description: editReview ? "Review updated" : "Review created", variant: "success" });
      setShowCreate(false);
      resetForm();
      setEditReview(null);
      fetchReviews();
      router.refresh();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save review",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this performance review?")) return;
    try {
      const res = await fetch(`/api/hr/performance-reviews/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ title: "Deleted", description: "Review deleted", variant: "success" });
      fetchReviews();
      router.refresh();
    } catch {
      toast({ title: "Error", description: "Failed to delete review", variant: "destructive" });
    }
  };

  const filtered = reviews.filter((r) => {
    const matchesSearch =
      !search ||
      r.employee.user.name?.toLowerCase().includes(search.toLowerCase()) ||
      r.period.toLowerCase().includes(search.toLowerCase()) ||
      r.reviewerName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === "all" || r.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search reviews..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isHR && (
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Create Review
          </Button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No performance reviews found.</div>
      ) : (
        <div className="rounded-lg border bg-white dark:bg-slate-900 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left p-3 font-medium">Employee</th>
                <th className="text-left p-3 font-medium">Period</th>
                <th className="text-left p-3 font-medium">Score</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Reviewer</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((review) => {
                const badge = STATUS_BADGE[review.status] ?? { variant: "secondary" as const, label: review.status };
                return (
                  <tr key={review.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="p-3 font-medium">{review.employee.user.name ?? "Unknown"}</td>
                    <td className="p-3 text-muted-foreground">{review.period}</td>
                    <td className="p-3">
                      {review.score != null ? (
                        <span className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                          {review.score.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">{review.reviewerName}</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isHR && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => openEdit(review)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(review.id)}>
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
      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) { setShowCreate(false); setEditReview(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editReview ? "Edit Performance Review" : "Create Performance Review"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editReview && (
              <div className="space-y-1.5">
                <Label>Employee</Label>
                <Select value={formEmployeeId} onValueChange={setFormEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee..." />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.user.name ?? emp.employeeId} - {emp.jobTitle}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Period</Label>
              <Input
                placeholder="e.g., Q1 2026"
                value={formPeriod}
                onChange={(e) => setFormPeriod(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Score (0-5)</Label>
                <Input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  placeholder="e.g., 4.2"
                  value={formScore}
                  onChange={(e) => setFormScore(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Strengths</Label>
              <Textarea
                rows={3}
                placeholder="Key strengths demonstrated..."
                value={formStrengths}
                onChange={(e) => setFormStrengths(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Areas for Improvement</Label>
              <Textarea
                rows={3}
                placeholder="Areas to improve..."
                value={formImprovements}
                onChange={(e) => setFormImprovements(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Goals</Label>
              <Textarea
                rows={3}
                placeholder="Goals for next period..."
                value={formGoals}
                onChange={(e) => setFormGoals(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setEditReview(null); }}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editReview ? "Update Review" : "Create Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
