"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Schema ────────────────────────────────────────────────────────────────

const eventSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum([
    "EDUCATION_FAIR",
    "CAMPUS_VISIT",
    "WEBINAR",
    "AGENT_TRAINING",
    "SCHOOL_PRESENTATION",
    "EXHIBITION",
  ]),
  date: z.string().min(1, "Date is required"),
  city: z.string().min(1, "City is required"),
  country: z.string().min(1, "Country is required"),
  status: z.enum(["PLANNED", "CONFIRMED", "COMPLETED", "CANCELLED"]).optional(),
  budget: z.coerce.number().positive().optional(),
  regionId: z.string().optional(),
  assignedICRId: z.string().optional(),
  institutionIds: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

type EventFormValues = z.infer<typeof eventSchema>;

// ─── Types ─────────────────────────────────────────────────────────────────

interface Region {
  id: string;
  name: string;
}

interface ICR {
  id: string;
  name: string | null;
}

interface Institution {
  id: string;
  name: string;
}

interface EventFormProps {
  event?: {
    id: string;
    name: string;
    type: string;
    date: Date | string;
    city: string;
    country: string;
    status: string;
    budget: number | null;
    notes: string | null;
    region?: Region | null;
    assignedICRId?: string | null;
    institutions?: { institution: Institution }[];
  };
  regions: Region[];
  icrs: ICR[];
  institutions: Institution[];
  mode?: "create" | "edit";
}

// ─── Component ─────────────────────────────────────────────────────────────

export function EventForm({
  event,
  regions,
  icrs,
  institutions,
  mode = "create",
}: EventFormProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedInstitutions, setSelectedInstitutions] = React.useState<string[]>(
    event?.institutions?.map((ei) => ei.institution.id) ?? []
  );

  const defaultDate =
    event?.date
      ? new Date(event.date).toISOString().slice(0, 16)
      : "";

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema) as never,
    defaultValues: {
      name: event?.name ?? "",
      type:
        (event?.type as EventFormValues["type"]) ?? "EDUCATION_FAIR",
      date: defaultDate,
      city: event?.city ?? "",
      country: event?.country ?? "",
      status: (event?.status as EventFormValues["status"]) ?? "PLANNED",
      budget: event?.budget ?? undefined,
      regionId: event?.region?.id ?? "",
      assignedICRId: event?.assignedICRId ?? "",
      notes: event?.notes ?? "",
    },
  });

  const toggleInstitution = (id: string) => {
    setSelectedInstitutions((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const onSubmit = async (data: EventFormValues) => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        ...data,
        institutionIds: selectedInstitutions,
        regionId: data.regionId === "none" ? undefined : data.regionId,
        assignedICRId: data.assignedICRId === "none" ? undefined : data.assignedICRId,
      };
      const url = mode === "edit" ? `/api/events/${event!.id}` : "/api/events";
      const method = mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save event");
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
        {mode === "create" ? (
          <Button className="gap-2 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90">
            <Plus className="h-4 w-4" />
            Add Event
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-2">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Event" : "Edit Event"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input id="name" {...register("name")} placeholder="Event name" />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          {/* Type + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                Type <span className="text-red-500">*</span>
              </Label>
              <Select
                defaultValue={event?.type ?? "EDUCATION_FAIR"}
                onValueChange={(v) => setValue("type", v as EventFormValues["type"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EDUCATION_FAIR">Education Fair</SelectItem>
                  <SelectItem value="CAMPUS_VISIT">Campus Visit</SelectItem>
                  <SelectItem value="WEBINAR">Webinar</SelectItem>
                  <SelectItem value="AGENT_TRAINING">Agent Training</SelectItem>
                  <SelectItem value="SCHOOL_PRESENTATION">School Presentation</SelectItem>
                  <SelectItem value="EXHIBITION">Exhibition</SelectItem>
                </SelectContent>
              </Select>
              {errors.type && <p className="text-xs text-red-500">{errors.type.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                defaultValue={event?.status ?? "PLANNED"}
                onValueChange={(v) => setValue("status", v as EventFormValues["status"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLANNED">Planned</SelectItem>
                  <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <Label htmlFor="date">
              Date <span className="text-red-500">*</span>
            </Label>
            <Input id="date" type="datetime-local" {...register("date")} />
            {errors.date && <p className="text-xs text-red-500">{errors.date.message}</p>}
          </div>

          {/* City + Country */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="city">
                City <span className="text-red-500">*</span>
              </Label>
              <Input id="city" {...register("city")} placeholder="e.g. London" />
              {errors.city && <p className="text-xs text-red-500">{errors.city.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="country">
                Country <span className="text-red-500">*</span>
              </Label>
              <Input id="country" {...register("country")} placeholder="e.g. United Kingdom" />
              {errors.country && (
                <p className="text-xs text-red-500">{errors.country.message}</p>
              )}
            </div>
          </div>

          {/* Budget */}
          <div className="space-y-1.5">
            <Label htmlFor="budget">Budget (USD)</Label>
            <Input
              id="budget"
              type="number"
              step="0.01"
              {...register("budget")}
              placeholder="0.00"
            />
          </div>

          {/* Region + Assigned ICR */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Select
                defaultValue={event?.region?.id ?? ""}
                onValueChange={(v) => setValue("regionId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {regions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Assigned ICR</Label>
              <Select
                defaultValue={event?.assignedICRId ?? ""}
                onValueChange={(v) => setValue("assignedICRId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select ICR" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {icrs.map((icr) => (
                    <SelectItem key={icr.id} value={icr.id}>
                      {icr.name ?? "Unnamed"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Institutions multi-select */}
          {institutions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Institutions</Label>
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                {institutions.map((inst) => (
                  <div key={inst.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`inst-${inst.id}`}
                      checked={selectedInstitutions.includes(inst.id)}
                      onCheckedChange={() => toggleInstitution(inst.id)}
                    />
                    <label
                      htmlFor={`inst-${inst.id}`}
                      className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer"
                    >
                      {inst.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              {...register("notes")}
              placeholder="Additional notes..."
              rows={3}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-transparent dark:border-red-500/30 px-3 py-2 rounded-md">{error}</p>
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
              {loading
                ? "Saving..."
                : mode === "create"
                ? "Create Event"
                : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
