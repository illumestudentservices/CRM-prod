"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Calendar,
  Phone,
  Mail,
  GraduationCap,
  Star,
  Activity,
  Plus,
} from "lucide-react";
import { type InteractionType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime, cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

interface LogUser {
  id: string;
  name: string | null;
  image: string | null;
}

interface LogEntry {
  id: string;
  type: InteractionType;
  date: Date | string;
  notes: string | null;
  outcome: string | null;
  user: LogUser;
}

interface EngagementLogProps {
  logs: LogEntry[];
  institutionId: string;
}

// ─── Icon map ──────────────────────────────────────────────────────────────

const TYPE_ICON: Record<InteractionType, React.ElementType> = {
  MEETING: Calendar,
  CALL: Phone,
  EMAIL: Mail,
  TRAINING: GraduationCap,
  EVENT: Star,
  OTHER: Activity,
};

const TYPE_COLOR: Record<InteractionType, string> = {
  MEETING: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  CALL: "bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-300",
  EMAIL: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  TRAINING: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  EVENT: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
  OTHER: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

const TYPE_LABEL: Record<InteractionType, string> = {
  MEETING: "Meeting",
  CALL: "Call",
  EMAIL: "Email",
  TRAINING: "Training",
  EVENT: "Event",
  OTHER: "Other",
};

// ─── Schema ────────────────────────────────────────────────────────────────

const engagementSchema = z.object({
  type: z.enum(["MEETING", "CALL", "EMAIL", "TRAINING", "EVENT", "OTHER"]),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
  outcome: z.string().optional(),
});

type EngagementFormValues = z.infer<typeof engagementSchema>;

// ─── Add Engagement Dialog ─────────────────────────────────────────────────

function AddEngagementDialog({ institutionId }: { institutionId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<EngagementFormValues>({
    resolver: zodResolver(engagementSchema) as never,
    defaultValues: { type: "MEETING" },
  });

  const onSubmit = async (data: EngagementFormValues) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/engagement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to add engagement");
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90">
          <Plus className="h-4 w-4" />
          Add Engagement
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log Engagement</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>
              Type <span className="text-red-500">*</span>
            </Label>
            <Select
              defaultValue="MEETING"
              onValueChange={(v) => setValue("type", v as EngagementFormValues["type"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MEETING">Meeting</SelectItem>
                <SelectItem value="CALL">Call</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="TRAINING">Training</SelectItem>
                <SelectItem value="EVENT">Event</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="date">
              Date <span className="text-red-500">*</span>
            </Label>
            <Input id="date" type="datetime-local" {...register("date")} />
            {errors.date && <p className="text-xs text-red-500">{errors.date.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" {...register("notes")} rows={3} placeholder="What was discussed..." />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="outcome">Outcome</Label>
            <Textarea id="outcome" {...register("outcome")} rows={2} placeholder="Result or next steps..." />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md dark:bg-red-500/15 dark:text-red-300">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90"
            >
              {loading ? "Saving..." : "Log Engagement"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Timeline Component ────────────────────────────────────────────────────

export function EngagementLog({ logs, institutionId }: EngagementLogProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddEngagementDialog institutionId={institutionId} />
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-12 text-slate-400 dark:text-slate-500">
          <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No engagement logged yet.</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-5 top-0 bottom-0 w-px bg-slate-200 dark:bg-slate-800" />

          <div className="space-y-6">
            {logs.map((log) => {
              const Icon = TYPE_ICON[log.type];
              const colorClass = TYPE_COLOR[log.type];

              return (
                <div key={log.id} className="flex gap-4">
                  {/* Icon */}
                  <div
                    className={cn(
                      "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-white dark:border-slate-900 shadow-sm",
                      colorClass
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-medium text-slate-900 dark:text-slate-100 text-sm">
                          {TYPE_LABEL[log.type]}
                        </span>
                        {log.user.name && (
                          <span className="text-slate-400 dark:text-slate-500 text-xs ml-2">
                            by {log.user.name}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">
                        {formatDateTime(log.date)}
                      </span>
                    </div>

                    {log.notes && (
                      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{log.notes}</p>
                    )}

                    {log.outcome && (
                      <div className="mt-2 bg-slate-50 dark:bg-slate-800/60 rounded-lg px-3 py-2">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">Outcome</p>
                        <p className="text-sm text-slate-700 dark:text-slate-300">{log.outcome}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
