"use client";

import * as React from "react";
import { Flame, Loader2, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Template {
  id: string;
  name: string;
  description: string | null;
  triggerEvent: string | null;
  category: string;
  recurrence: string;
  isActive: boolean;
}

/**
 * Fires a stored TaskTemplate manually. Templates normally auto-fire on
 * lifecycle events (e.g. STUDENT_APPLICATION_SUBMITTED); this dialog is the
 * escape hatch when someone wants to (re-)generate the tasks for a specific
 * template without waiting for the trigger — useful for testing new templates
 * or catching up on a missed event.
 */
export function FireTemplatesButton({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [templateId, setTemplateId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ created?: number } | null>(null);

  const active = templates.filter((t) => t.isActive);
  const chosen = templates.find((t) => t.id === templateId);

  async function fire() {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/tasks/templates/fire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (HTTP ${res.status})`);
      }
      const body = await res.json();
      setResult({ created: Array.isArray(body) ? body.length : body?.created });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setTemplateId("");
          setError(null);
          setResult(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Flame className="h-3.5 w-3.5" />
          Fire Template
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fire a task template</DialogTitle>
          <DialogDescription>
            Manually generate the tasks defined in a template. Tasks are assigned to
            you unless the template says otherwise.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1.5">
            <Label>Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Select template…" /></SelectTrigger>
              <SelectContent>
                {active.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground">
                    No active templates yet.
                  </div>
                ) : (
                  active.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {chosen && (
            <div className="rounded border bg-slate-50 dark:bg-slate-900/40 p-2 text-xs space-y-1">
              {chosen.description && <p>{chosen.description}</p>}
              <div className="text-slate-500 dark:text-slate-400">
                Trigger: {chosen.triggerEvent ?? "manual"} · Category: {chosen.category} · Recurrence: {chosen.recurrence}
              </div>
            </div>
          )}

          {result && (
            <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              Fired successfully.
              {typeof result.created === "number" && <> {result.created} task(s) created.</>}
            </div>
          )}

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Close
          </Button>
          <Button onClick={fire} disabled={loading || !templateId} className="gap-1.5">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Firing…" : "Fire"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
