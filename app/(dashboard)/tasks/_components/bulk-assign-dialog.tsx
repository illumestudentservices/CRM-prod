"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Users, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface RosterMember {
  id: string; // Employee id
  user: { id: string; name: string | null; image: string | null };
}

/**
 * HQ-Executive / CEO tool: fill one task and assign it to several people at
 * once. Each person gets their own task (POST /api/tasks/bulk makes one per
 * assignee). Categories are limited to the parent-free ones (Internal /
 * Personal) — a single shared parent rarely makes sense across many people.
 */
export function BulkAssignDialog({ roster }: { roster: RosterMember[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState("MEDIUM");
  const [category, setCategory] = React.useState("INTERNAL");
  const [dueDate, setDueDate] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((m) => (m.user.name ?? "").toLowerCase().includes(q));
  }, [roster, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAllFiltered() {
    setSelected((prev) => new Set([...prev, ...filtered.map((m) => m.id)]));
  }
  function clearAll() { setSelected(new Set()); }

  function reset() {
    setTitle(""); setDescription(""); setPriority("MEDIUM"); setCategory("INTERNAL");
    setDueDate(""); setSearch(""); setSelected(new Set());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || selected.size === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/tasks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          assigneeIds: [...selected],
          priority,
          category,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to assign tasks");
      toast({
        title: "Tasks assigned",
        description: `Created ${data.created} task${data.created === 1 ? "" : "s"}, one per person.`,
      });
      reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast({
        title: "Could not assign",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Users className="h-4 w-4" />
          Assign to reps
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign a task to several people</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-title">Title</Label>
            <Input id="bulk-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Submit your November forecast" required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-desc">Description (optional)</Label>
            <Textarea id="bulk-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="resize-none" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INTERNAL">Internal</SelectItem>
                  <SelectItem value="PERSONAL">Personal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-due">Due date</Label>
              <Input id="bulk-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {/* People picker */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>People ({selected.size} selected)</Label>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={selectAllFiltered} className="text-blue-600 hover:underline dark:text-blue-400">Select shown</button>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <button type="button" onClick={clearAll} className="text-slate-500 hover:underline">Clear</button>
              </div>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people..." className="pl-7" />
            </div>
            <ScrollArea className="h-48 rounded-md border border-slate-200 dark:border-slate-700">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.length === 0 ? (
                  <p className="p-3 text-center text-sm text-slate-400">No people match.</p>
                ) : filtered.map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggle(m.id)} />
                    <span className="text-sm text-slate-700 dark:text-slate-200">{m.user.name ?? "Unnamed"}</span>
                  </label>
                ))}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !title.trim() || selected.size === 0} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
              {saving ? "Assigning..." : `Assign to ${selected.size || ""} ${selected.size === 1 ? "person" : "people"}`.trim()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
