"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
import { formatDate, formatRelative } from "@/lib/utils";
import { Loader2, Send, Paperclip, MessageSquare } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TicketTask {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  category?: string | null;
  dueDate: Date | string | null;
  assignee: { id: string; user: { id: string; name: string | null; image: string | null } } | null;
  createdBy: { id: string; user: { id: string; name: string | null } } | null;
  sourceActivity: { id: string; title: string; type: string } | null;
}

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null; image: string | null };
}

// ─── Config (kept in step with tasks-client.tsx) ──────────────────────────────

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
  TODO: "To Do", IN_PROGRESS: "In Progress", DONE: "Done", CANCELLED: "Cancelled",
};
const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent",
};

function initials(name: string | null): string {
  if (!name) return "?";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}
/** An <input type=date> value, or "" when there is no due date. */
function toDateInput(d: Date | string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskTicketDialog({
  task,
  currentUserId,
  onOpenChange,
}: {
  task: TicketTask | null;
  currentUserId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const open = !!task;

  // Editable details, seeded from the task each time a different one opens.
  const [status, setStatus] = useState("TODO");
  const [priority, setPriority] = useState("MEDIUM");
  const [due, setDue] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);

  // Conversation.
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!task) return;
    setStatus(task.status);
    setPriority(task.priority);
    setDue(toDateInput(task.dueDate));
    setNote("");
    setComments([]);
    setLoadingThread(true);
    fetch(`/api/tasks/${task.id}/comments`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d) => setComments(d.comments ?? []))
      .catch(() => setComments([]))
      .finally(() => setLoadingThread(false));
  }, [task]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments.length]);

  if (!task) return null;

  // Priority and the due date are the creator's to set; the assignee may only
  // move status. Enforced on the server too (/api/tasks/[id]).
  const isCreator = task.createdBy?.user.id === currentUserId;

  const detailsDirty =
    status !== task.status ||
    (isCreator && (priority !== task.priority || due !== toDateInput(task.dueDate)));

  async function saveDetails() {
    if (!task) return;
    setSavingDetails(true);
    try {
      const body: Record<string, unknown> = {};
      if (status !== task.status) body.status = status;
      if (isCreator && priority !== task.priority) body.priority = priority;
      if (isCreator && due !== toDateInput(task.dueDate)) {
        body.dueDate = due ? new Date(`${due}T00:00:00`).toISOString() : null;
      }
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to update the task");
        return;
      }
      router.refresh();
    } catch {
      alert("Network error");
    } finally {
      setSavingDetails(false);
    }
  }

  async function sendNote() {
    if (!task || !note.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: note.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to add the note");
        return;
      }
      const { comment } = await res.json();
      setComments((prev) => [...prev, comment]);
      setNote("");
    } catch {
      alert("Network error");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 pr-6">
            <span className="flex-1">{task.title}</span>
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="outline" className={STATUS_BADGE[task.status] || ""}>
              {STATUS_LABELS[task.status] || task.status}
            </Badge>
            <Badge variant="outline" className={PRIORITY_BADGE[task.priority] || ""}>
              {PRIORITY_LABELS[task.priority] || task.priority}
            </Badge>
            {task.category && (
              <span className="text-xs text-muted-foreground capitalize">
                {task.category.replace(/_/g, " ").toLowerCase()}
              </span>
            )}
          </div>
        </DialogHeader>

        {/* Description */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
            Description
          </p>
          <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-200">
            {task.description?.trim() || <span className="text-muted-foreground italic">No description</span>}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div>Assignee: <span className="text-foreground">{task.assignee?.user.name ?? "Unassigned"}</span></div>
            <div>Raised by: <span className="text-foreground">{task.createdBy?.user.name ?? "—"}</span></div>
          </div>
        </div>

        {/* Editable controls */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Priority</Label>
            {isCreator ? (
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="h-9 flex items-center">
                <Badge variant="outline" className={PRIORITY_BADGE[task.priority] || ""}>
                  {PRIORITY_LABELS[task.priority] || task.priority}
                </Badge>
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs">Due date</Label>
            {isCreator ? (
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            ) : (
              <div className="h-9 flex items-center text-sm">
                {task.dueDate ? formatDate(task.dueDate) : <span className="text-muted-foreground">No due date</span>}
              </div>
            )}
          </div>
        </div>
        {!isCreator && (
          <p className="text-xs text-muted-foreground -mt-1">
            Only the person who raised this task can change its priority or due date.
          </p>
        )}
        {detailsDirty && (
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={saveDetails}
              disabled={savingDetails}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
            >
              {savingDetails && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save changes
            </Button>
          </div>
        )}

        {/* Conversation */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" /> Notes
          </p>
          <ScrollArea className="h-[240px] rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            {loadingThread ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No notes yet. Start the conversation below.
              </p>
            ) : (
              <div className="space-y-4">
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <Avatar className="h-7 w-7 shrink-0">
                      {c.author.image && <AvatarImage src={c.author.image} alt={c.author.name ?? ""} />}
                      <AvatarFallback className="text-[10px]">{initials(c.author.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium">{c.author.name ?? "Unknown"}</span>
                        <span className="text-xs text-muted-foreground">{formatRelative(c.createdAt)}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-200 mt-0.5">
                        {c.body}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>
            )}
          </ScrollArea>

          {/* Composer */}
          <div className="mt-2 flex items-end gap-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); sendNote(); }
              }}
              placeholder="Write a note… (Ctrl+Enter to send)"
              rows={2}
              className="flex-1 resize-none"
            />
            <Button
              onClick={sendNote}
              disabled={sending || !note.trim()}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Attachments */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
            <Paperclip className="h-3.5 w-3.5" /> Attachments
          </p>
          <AttachmentsPanel parentType="TASK" parentId={task.id} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
