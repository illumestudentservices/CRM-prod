"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_OPTIONS = [
  { value: "PLANNED", label: "Planned" },
  { value: "APPROVED", label: "Approved" },
  { value: "OPEN", label: "Open" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CLOSED", label: "Closed" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

// Spec §12 campaign types the app already surfaces elsewhere. `type` is a free
// text column in the schema; these are just presets.
const TYPE_OPTIONS = [
  { value: "FAIR", label: "Fair" },
  { value: "EXHIBITION", label: "Exhibition" },
  { value: "SEMINAR", label: "Seminar" },
  { value: "WEBINAR", label: "Webinar" },
  { value: "SCHOOL_VISIT", label: "School Visit" },
  { value: "AGENT_ROADSHOW", label: "Agent Roadshow" },
  { value: "DIGITAL_CAMPAIGN", label: "Digital Campaign" },
  { value: "OTHER", label: "Other" },
];

const num = (v: unknown): number | undefined => {
  if (v === "" || v === undefined || v === null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const campaignSchema = z.object({
  name: z.string().min(1, "Name is required"),
  channel: z.string().min(1, "Channel is required"),
  type: z.string().optional(),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  venue: z.string().optional(),
  expectedAttendance: z.preprocess(num, z.number().int().nonnegative().optional()),
  budget: z.preprocess(num, z.number().nonnegative().optional()),
  actualSpend: z.preprocess(num, z.number().nonnegative().optional()),
  eventOrganizer: z.string().optional(),
  status: z
    .enum(["PLANNED", "APPROVED", "OPEN", "COMPLETED", "CLOSED", "CANCELLED"])
    .optional(),
  sourceId: z.string().optional(),
  ownerId: z.string().optional(),
  notes: z.string().optional(),
});

type CampaignFormValues = z.input<typeof campaignSchema>;

interface Option {
  id: string;
  name: string;
}

interface DuplicateInfo {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  startDate: string;
}

export function CampaignForm({
  partners,
  users,
  isSuperAdmin,
}: {
  partners: Option[];
  users: Option[];
  /** SUPER_ADMIN can force-create over the 14-day dedup window per spec §2. */
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [duplicate, setDuplicate] = React.useState<DuplicateInfo | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<CampaignFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(campaignSchema) as any,
    defaultValues: {
      status: "PLANNED",
      type: "FAIR",
    },
  });

  const status = watch("status");
  const type = watch("type");
  const sourceId = watch("sourceId");
  const ownerId = watch("ownerId");

  async function submit(values: CampaignFormValues, forceCreate = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          endDate: values.endDate || null,
          country: values.country || null,
          city: values.city || null,
          venue: values.venue || null,
          eventOrganizer: values.eventOrganizer || null,
          sourceId: values.sourceId && values.sourceId !== "none" ? values.sourceId : null,
          ownerId: values.ownerId && values.ownerId !== "none" ? values.ownerId : null,
          notes: values.notes || null,
          forceCreate,
        }),
      });
      if (res.status === 409) {
        const body = await res.json();
        setDuplicate(body.existing);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (HTTP ${res.status})`);
      }
      setOpen(false);
      setDuplicate(null);
      reset();
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
          reset();
          setError(null);
          setDuplicate(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Campaign
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Marketing Campaign</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => submit(v))} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="camp-name">
                Name <span className="text-red-500">*</span>
              </Label>
              <Input id="camp-name" placeholder="Campaign name" {...register("name")} />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-channel">
                Channel <span className="text-red-500">*</span>
              </Label>
              <Input
                id="camp-channel"
                placeholder="Email, LinkedIn, Fair, etc."
                {...register("channel")}
              />
              {errors.channel && <p className="text-xs text-red-500">{errors.channel.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type ?? "FAIR"} onValueChange={(v) => setValue("type", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-start">
                Start Date <span className="text-red-500">*</span>
              </Label>
              <Input id="camp-start" type="date" {...register("startDate")} />
              {errors.startDate && (
                <p className="text-xs text-red-500">{errors.startDate.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-end">End Date</Label>
              <Input id="camp-end" type="date" {...register("endDate")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-country">Country</Label>
              <Input id="camp-country" placeholder="Country" {...register("country")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-city">City</Label>
              <Input id="camp-city" placeholder="City" {...register("city")} />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="camp-venue">Venue</Label>
              <Input
                id="camp-venue"
                placeholder="Convention centre, hotel, virtual…"
                {...register("venue")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-attendance">Expected Attendance</Label>
              <Input
                id="camp-attendance"
                type="number"
                min={0}
                {...register("expectedAttendance")}
              />
              {errors.expectedAttendance && (
                <p className="text-xs text-red-500">
                  {errors.expectedAttendance.message as string}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-organizer">Event Organizer</Label>
              <Input
                id="camp-organizer"
                placeholder="Organizer name"
                {...register("eventOrganizer")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-budget">Budget</Label>
              <Input
                id="camp-budget"
                type="number"
                min={0}
                step="0.01"
                placeholder="Planned budget"
                {...register("budget")}
              />
              {errors.budget && (
                <p className="text-xs text-red-500">{errors.budget.message as string}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-spend">Actual Spend</Label>
              <Input
                id="camp-spend"
                type="number"
                min={0}
                step="0.01"
                placeholder="Actual (if known)"
                {...register("actualSpend")}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={status ?? "PLANNED"}
                onValueChange={(v) =>
                  setValue("status", v as CampaignFormValues["status"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Owner</Label>
              <Select
                value={ownerId ?? "none"}
                onValueChange={(v) => setValue("ownerId", v === "none" ? undefined : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select owner…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Partner / Source</Label>
              <Select
                value={sourceId ?? "none"}
                onValueChange={(v) => setValue("sourceId", v === "none" ? undefined : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Link to a partner…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="camp-notes">Notes</Label>
              <Textarea id="camp-notes" rows={3} {...register("notes")} />
            </div>
          </div>

          {duplicate && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">
                    Similar campaign already exists: {duplicate.name}
                  </p>
                  <p className="text-xs">
                    {[duplicate.city, duplicate.country].filter(Boolean).join(", ") || "—"} ·{" "}
                    {new Date(duplicate.startDate).toISOString().slice(0, 10)}
                  </p>
                  {isSuperAdmin ? (
                    <p className="text-xs pt-1">
                      As a super admin you can create anyway — click below to bypass the
                      duplicate check.
                    </p>
                  ) : (
                    <p className="text-xs pt-1">
                      Only a super admin can bypass the duplicate check. Consider joining the
                      existing record instead.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            {duplicate && isSuperAdmin && (
              <Button
                type="button"
                variant="destructive"
                disabled={loading}
                onClick={handleSubmit((v) => submit(v, true))}
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Create anyway
              </Button>
            )}
            <Button type="submit" disabled={loading || !!duplicate} className="gap-1.5">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? "Creating…" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
