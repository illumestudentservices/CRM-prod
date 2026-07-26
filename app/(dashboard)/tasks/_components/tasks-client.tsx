"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import {
  Plus,
  Loader2,
  MoreHorizontal,
  Trash2,
  ArrowUpDown,
  ExternalLink,
} from "lucide-react";
import { ExportButton } from "@/components/shared/export-button";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueDate: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  assignee: {
    id: string;
    user: { id: string; name: string | null; image: string | null };
  } | null;
  createdBy: {
    id: string;
    user: { id: string; name: string | null };
  } | null;
  sourceActivity: {
    id: string;
    title: string;
    type: string;
  } | null;
}

interface EmployeeItem {
  id: string;
  user: { id: string; name: string | null; image: string | null };
}

// ─── Config ─────────────────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-700 border-slate-200",
  MEDIUM: "bg-blue-100 text-blue-700 border-blue-200",
  HIGH: "bg-amber-100 text-amber-700 border-amber-200",
  URGENT: "bg-red-100 text-red-700 border-red-200",
};

const STATUS_BADGE: Record<string, string> = {
  TODO: "bg-slate-100 text-slate-700 border-slate-200",
  IN_PROGRESS: "bg-blue-100 text-blue-700 border-blue-200",
  DONE: "bg-green-100 text-green-700 border-green-200",
  CANCELLED: "bg-red-100 text-red-700 border-red-200",
};

const STATUS_LABELS: Record<string, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  SCHOOL_VISIT: "School Visit",
  AGENT_MEETING: "Agent Meeting",
  STUDENT_EVENT: "Student Event",
  FAIR: "Fair",
  PARTNER_MEETING: "Partner Meeting",
};

// ─── Component ──────────────────────────────────────────────────────────────

export function TasksClient({
  tasks,
  employees,
}: {
  tasks: TaskItem[];
  employees: EmployeeItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [activityLinkedOnly, setActivityLinkedOnly] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [dueDate, setDueDate] = useState("");

  function resetForm() {
    setTitle("");
    setDescription("");
    setAssigneeId("");
    setPriority("MEDIUM");
    setDueDate("");
  }

  // ── Filtering ─────────────────────────────────────────────────────────────

  const filtered = tasks.filter((t) => {
    if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
    if (priorityFilter !== "ALL" && t.priority !== priorityFilter) return false;
    if (activityLinkedOnly && !t.sourceActivity) return false;
    return true;
  });

  // ── Counts ────────────────────────────────────────────────────────────────

  const counts = {
    total: tasks.length,
    todo: tasks.filter((t) => t.status === "TODO").length,
    inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").length,
    done: tasks.filter((t) => t.status === "DONE").length,
  };

  // ── Create Task ───────────────────────────────────────────────────────────

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const res = await fetch("/api/hr/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || undefined,
          assigneeId: assigneeId || null,
          priority,
          dueDate: dueDate || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to create task");
        return;
      }

      resetForm();
      setOpen(false);
      router.refresh();
    } catch {
      alert("Network error");
    } finally {
      setSaving(false);
    }
  }

  // ── Update Status ─────────────────────────────────────────────────────────

  async function handleStatusChange(taskId: string, newStatus: string) {
    try {
      const res = await fetch(`/api/hr/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to update task");
        return;
      }

      router.refresh();
    } catch {
      alert("Network error");
    }
  }

  // ── Delete Task ───────────────────────────────────────────────────────────

  async function handleDelete(taskId: string) {
    if (!confirm("Are you sure you want to delete this task?")) return;
    setDeletingId(taskId);

    try {
      const res = await fetch(`/api/hr/tasks/${taskId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to delete task");
        return;
      }

      router.refresh();
    } catch {
      alert("Network error");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Total Tasks</p>
            <p className="text-2xl font-bold">{counts.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">To Do</p>
            <p className="text-2xl font-bold text-slate-600">{counts.todo}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">In Progress</p>
            <p className="text-2xl font-bold text-blue-600">
              {counts.inProgress}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Done</p>
            <p className="text-2xl font-bold text-green-600">{counts.done}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Row + Create Button */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="TODO">To Do</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="DONE">Done</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            {/* Priority Filter */}
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Priorities</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="URGENT">Urgent</SelectItem>
              </SelectContent>
            </Select>

            {/* Activity-linked toggle */}
            <Button
              variant={activityLinkedOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setActivityLinkedOnly(!activityLinkedOnly)}
              className={
                activityLinkedOnly
                  ? "bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
                  : ""
              }
            >
              <ExternalLink className="h-4 w-4 mr-1" />
              Activity-linked
            </Button>

            <ExportButton
              data={filtered.map((t) => ({
                title: t.title,
                status: STATUS_LABELS[t.status] ?? t.status,
                priority: PRIORITY_LABELS[t.priority] ?? t.priority,
                assignee: t.assignee?.user.name ?? "Unassigned",
                dueDate: t.dueDate ? formatDate(t.dueDate) : "—",
                createdBy: t.createdBy?.user.name ?? "—",
                activity: t.sourceActivity ? `${ACTIVITY_TYPE_LABELS[t.sourceActivity.type] ?? t.sourceActivity.type}: ${t.sourceActivity.title}` : "—",
                createdAt: formatDate(t.createdAt),
              }))}
              columns={[
                { key: "title", header: "Title" },
                { key: "status", header: "Status" },
                { key: "priority", header: "Priority" },
                { key: "assignee", header: "Assignee" },
                { key: "dueDate", header: "Due Date" },
                { key: "createdBy", header: "Created By" },
                { key: "activity", header: "Linked Activity" },
                { key: "createdAt", header: "Created" },
              ]}
              filename="tasks"
              title="Tasks"
            />

            {/* Spacer */}
            <div className="flex-1" />

            {/* Create Task */}
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Task
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create Task</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <Label htmlFor="task-title">Title *</Label>
                    <Input
                      id="task-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                      placeholder="Enter task title"
                    />
                  </div>
                  <div>
                    <Label htmlFor="task-desc">Description</Label>
                    <Textarea
                      id="task-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Optional description"
                      rows={3}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="task-assignee">Assignee</Label>
                      <Select
                        value={assigneeId}
                        onValueChange={setAssigneeId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select assignee" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {employees.map((emp) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.user.name || "Unnamed"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="task-priority">Priority</Label>
                      <Select value={priority} onValueChange={setPriority}>
                        <SelectTrigger>
                          <SelectValue placeholder="Priority" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="LOW">Low</SelectItem>
                          <SelectItem value="MEDIUM">Medium</SelectItem>
                          <SelectItem value="HIGH">High</SelectItem>
                          <SelectItem value="URGENT">Urgent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="task-due">Due Date</Label>
                    <Input
                      id="task-due"
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        resetForm();
                        setOpen(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={saving || !title.trim()}
                      className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
                    >
                      {saving && (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      )}
                      Create
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Tasks Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px]">
                  <div className="flex items-center gap-1">
                    Title
                    <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                  </div>
                </TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Source Activity</TableHead>
                <TableHead className="w-[60px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No tasks found. Adjust your filters or create a new task.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((task) => (
                  <TableRow key={task.id}>
                    {/* Title */}
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{task.title}</p>
                        {task.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                            {task.description}
                          </p>
                        )}
                      </div>
                    </TableCell>

                    {/* Priority Badge */}
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={PRIORITY_BADGE[task.priority] || ""}
                      >
                        {PRIORITY_LABELS[task.priority] || task.priority}
                      </Badge>
                    </TableCell>

                    {/* Status Badge + Quick Toggle */}
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="cursor-pointer">
                            <Badge
                              variant="outline"
                              className={`${STATUS_BADGE[task.status] || ""} cursor-pointer hover:opacity-80`}
                            >
                              {STATUS_LABELS[task.status] || task.status}
                            </Badge>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {Object.entries(STATUS_LABELS).map(([val, label]) => (
                            <DropdownMenuItem
                              key={val}
                              disabled={val === task.status}
                              onClick={() => handleStatusChange(task.id, val)}
                            >
                              <Badge
                                variant="outline"
                                className={`${STATUS_BADGE[val]} mr-2`}
                              >
                                {label}
                              </Badge>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>

                    {/* Assignee */}
                    <TableCell>
                      <span className="text-sm">
                        {task.assignee?.user?.name || (
                          <span className="text-muted-foreground italic">
                            Unassigned
                          </span>
                        )}
                      </span>
                    </TableCell>

                    {/* Due Date */}
                    <TableCell>
                      {task.dueDate ? (
                        <span
                          className={`text-sm ${
                            new Date(task.dueDate) < new Date() &&
                            task.status !== "DONE" &&
                            task.status !== "CANCELLED"
                              ? "text-red-600 font-medium"
                              : ""
                          }`}
                        >
                          {formatDate(task.dueDate)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          --
                        </span>
                      )}
                    </TableCell>

                    {/* Source Activity */}
                    <TableCell>
                      {task.sourceActivity ? (
                        <Link
                          href={`/activities`}
                          className="text-sm text-[#0EA5E9] hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span className="line-clamp-1">
                            {ACTIVITY_TYPE_LABELS[task.sourceActivity.type] ||
                              task.sourceActivity.type}
                            :{" "}
                            {task.sourceActivity.title}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          --
                        </span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {Object.entries(STATUS_LABELS).map(([val, label]) => (
                            <DropdownMenuItem
                              key={val}
                              disabled={val === task.status}
                              onClick={() => handleStatusChange(task.id, val)}
                            >
                              Set {label}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuItem
                            className="text-red-600"
                            disabled={deletingId === task.id}
                            onClick={() => handleDelete(task.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {deletingId === task.id ? "Deleting..." : "Delete"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
