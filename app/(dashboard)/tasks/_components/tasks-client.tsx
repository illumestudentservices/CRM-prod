"use client";

import { useState, useEffect } from "react";
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
  Paperclip,
} from "lucide-react";
import { ExportButton } from "@/components/shared/export-button";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";

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
  LOW: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  MEDIUM: "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30",
  HIGH: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30",
  URGENT: "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30",
};

const STATUS_BADGE: Record<string, string> = {
  TODO: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  IN_PROGRESS: "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30",
  DONE: "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300 border-green-200 dark:border-green-500/30",
  CANCELLED: "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30",
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

/**
 * Mirrors the API's zod enums exactly. Duplicated because the route file is
 * server-only; if these drift, the form offers a value the API rejects — the
 * bug that made eleven of fourteen activity types and most event types
 * unsaveable. Any change to one must be made to the other.
 */
const TASK_CATEGORIES = [
  { value: "PERSONAL", label: "Personal" },
  { value: "INTERNAL", label: "Internal" },
  { value: "STUDENT_FOLLOW_UP", label: "Student follow-up" },
  { value: "CLIENT_FOLLOW_UP", label: "Client follow-up" },
  { value: "RECRUITMENT_PARTNER", label: "Recruitment partner" },
  { value: "SCHOOL_ENGAGEMENT", label: "School engagement" },
  { value: "EVENT_PREPARATION", label: "Event preparation" },
  { value: "EVENT_FOLLOW_UP", label: "Event follow-up" },
  { value: "MARKETING", label: "Marketing" },
  { value: "ADMINISTRATION", label: "Administration" },
  { value: "REPORTING", label: "Reporting" },
  { value: "COMPLIANCE", label: "Compliance" },
  { value: "OTHER", label: "Other" },
] as const;

/** Only the parent types /api/tasks/parent-options can list. */
const TASK_PARENT_TYPES = [
  { value: "STUDENT", label: "Student" },
  { value: "INSTITUTION", label: "Client" },
  { value: "RECRUITMENT_EVENT", label: "Event" },
  { value: "RECRUITMENT_PARTNER", label: "Recruitment partner" },
  { value: "MARKET", label: "Market" },
  { value: "FIELD_OPERATION", label: "Field operation" },
  { value: "CLIENT_ISSUE", label: "Client issue" },
] as const;

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
  const [attachmentsTask, setAttachmentsTask] = useState<TaskItem | null>(null);

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
  // Spec §1: every task except PERSONAL/INTERNAL must be linked to a parent
  // record, and the API enforces it. The form had none of these fields, so it
  // sent no category (defaulting to OTHER, which requires a parent) and no
  // parent — meaning EVERY task created here was rejected 422.
  const [category, setCategory] = useState("PERSONAL");
  const [parentType, setParentType] = useState("none");
  const [parentId, setParentId] = useState("none");
  const [parentOptions, setParentOptions] = useState<{ id: string; name: string; hint?: string | null }[] | null>(null);
  const [reminderDate, setReminderDate] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");

  // Mirrors lib/task-workflow.ts requiresParent(). Kept in step deliberately:
  // if these disagree the form either blocks a valid task or lets through one
  // the API will reject.
  const needsParent = category !== "PERSONAL" && category !== "INTERNAL";
  const parentChosen = parentType !== "none" && parentId !== "none";

  // Loaded when a parent TYPE is picked, not on mount — the lists are large and
  // irrelevant until a type narrows them.
  useEffect(() => {
    if (parentType === "none") { setParentOptions(null); return; }
    setParentOptions(null);
    setParentId("none");
    fetch(`/api/tasks/parent-options?type=${encodeURIComponent(parentType)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setParentOptions(d?.data ?? []))
      .catch(() => setParentOptions([]));
  }, [parentType]);

  function resetForm() {
    setTitle("");
    setDescription("");
    setAssigneeId("");
    setPriority("MEDIUM");
    setCategory("PERSONAL");
    setParentType("none");
    setParentId("none");
    setParentOptions(null);
    setReminderDate("");
    setEstimatedMinutes("");
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
          category,
          ...(parentType !== "none" && parentId !== "none"
            ? { parentType, parentId }
            : {}),
          reminderDate: reminderDate ? new Date(reminderDate).toISOString() : undefined,
          estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : undefined,
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
            <p className="text-2xl font-bold text-slate-600 dark:text-slate-300">{counts.todo}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">In Progress</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {counts.inProgress}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Done</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{counts.done}</p>
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

                  {/* ── Category and parent link ─────────────────────────
                      Spec §1: a task that is not personal or internal must be
                      attached to a record. Neither field existed on this form,
                      so it sent no category (defaulting to OTHER, which
                      requires a parent) and no parent — every task created here
                      was rejected with a message naming fields that were not on
                      screen. */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="task-category">Category</Label>
                      <Select value={category} onValueChange={setCategory}>
                        <SelectTrigger id="task-category">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TASK_CATEGORIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="task-est">Estimated minutes</Label>
                      <Input
                        id="task-est" type="number" min="1" step="5"
                        value={estimatedMinutes}
                        onChange={(e) => setEstimatedMinutes(e.target.value)}
                        placeholder="e.g. 30"
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                        Related record {needsParent && <span className="text-red-500">*</span>}
                      </p>
                      <p className={
                        "text-xs mt-0.5 " +
                        (!needsParent || parentChosen
                          ? "text-slate-400 dark:text-slate-500"
                          : "text-amber-600 dark:text-amber-400 font-medium")
                      }>
                        {!needsParent
                          ? "Personal and internal tasks do not need a linked record."
                          : parentChosen
                            ? "Linked."
                            : "This category needs a record — choose what the task is about."}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="task-parent-type">Type</Label>
                        <Select value={parentType} onValueChange={setParentType}>
                          <SelectTrigger id="task-parent-type">
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {TASK_PARENT_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="task-parent-id">Record</Label>
                        <Select
                          value={parentId}
                          onValueChange={setParentId}
                          disabled={parentType === "none" || parentOptions === null}
                        >
                          <SelectTrigger id="task-parent-id">
                            <SelectValue placeholder={
                              parentType === "none" ? "Choose a type first"
                                : parentOptions === null ? "Loading…" : "Select a record"
                            } />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {(parentOptions ?? []).map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.name}
                                {o.hint && <span className="text-muted-foreground"> · {o.hint}</span>}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="task-reminder">Reminder date</Label>
                    <Input
                      id="task-reminder" type="date"
                      value={reminderDate}
                      onChange={(e) => setReminderDate(e.target.value)}
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

      {/* Per-task attachments modal — opened from the row actions menu */}
      <Dialog open={!!attachmentsTask} onOpenChange={(o) => !o && setAttachmentsTask(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Attachments — {attachmentsTask?.title}</DialogTitle>
          </DialogHeader>
          {attachmentsTask && (
            <AttachmentsPanel parentType="TASK" parentId={attachmentsTask.id} />
          )}
        </DialogContent>
      </Dialog>

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
                              ? "text-red-600 dark:text-red-400 font-medium"
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
                          className="text-sm text-[#0EA5E9] dark:text-cyan-400 hover:underline flex items-center gap-1"
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
                            onClick={() => setAttachmentsTask(task)}
                          >
                            <Paperclip className="h-4 w-4 mr-2" />
                            Attachments
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-red-600 dark:text-red-400"
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
