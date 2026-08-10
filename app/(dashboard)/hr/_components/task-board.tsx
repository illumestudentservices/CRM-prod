"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { Plus, Calendar, Flag } from "lucide-react";

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueDate: string | null;
  assignee: { user: { name: string | null } } | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  MEDIUM: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  HIGH: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  URGENT: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

const COLUMNS = [
  { key: "TODO", label: "To Do" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "DONE", label: "Done" },
];

export function TaskBoard({ userId, isHR }: { userId: string; isHR: boolean }) {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", description: "", priority: "MEDIUM", dueDate: "" });

  async function load() {
    setLoading(true);
    const res = await fetch("/api/hr/tasks");
    const data = await res.json();
    setTasks(data.tasks || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function createTask() {
    const res = await fetch("/api/hr/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTask),
    });
    if (res.ok) {
      toast({ title: "Task created" });
      setShowForm(false);
      setNewTask({ title: "", description: "", priority: "MEDIUM", dueDate: "" });
      load();
    }
  }

  async function moveTask(id: string, status: string) {
    await fetch(`/api/hr/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Task
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.key);
          return (
            <Card key={col.key} className="bg-muted/30">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  {col.label}
                  <Badge variant="secondary" className="ml-2">{colTasks.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-2">
                {loading
                  ? Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-16 bg-background rounded-lg animate-pulse" />
                  ))
                  : colTasks.map((task) => (
                    <div
                      key={task.id}
                      className="bg-background rounded-lg border p-3 shadow-sm space-y-2"
                    >
                      <p className="text-sm font-medium leading-tight">{task.title}</p>
                      {task.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[task.priority] ?? ""}`}>
                          <Flag className="inline h-3 w-3 mr-0.5" />
                          {task.priority}
                        </span>
                        {task.dueDate && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(task.dueDate)}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {COLUMNS.filter((c) => c.key !== col.key).map((c) => (
                          <Button
                            key={c.key}
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs px-2"
                            onClick={() => moveTask(task.id, c.key)}
                          >
                            → {c.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Task</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={newTask.description} onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={newTask.priority} onValueChange={(v) => setNewTask({ ...newTask, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={newTask.dueDate} onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={createTask} disabled={!newTask.title}>Create Task</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
