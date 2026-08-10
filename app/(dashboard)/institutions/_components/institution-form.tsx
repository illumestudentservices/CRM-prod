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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Schema ────────────────────────────────────────────────────────────────

const institutionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  legalName: z.string().optional(),
  country: z.string().min(1, "Country is required"),
  type: z.enum(["University", "College", "Institute", "Other"]),
  website: z.string().url("Invalid URL").optional().or(z.literal("")),
  primaryContact: z.string().optional(),
  accountStatus: z
    .enum(["PROSPECT", "ONBOARDING", "ACTIVE", "INACTIVE", "SUSPENDED", "CLOSED"])
    .optional(),
  regionId: z.string().optional(),
  reportingFrequency: z
    .enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY", "AD_HOC"])
    .optional(),
  // Spec §3 (Clients) — Service Scope multi-select. Zod validates each
  // entry against the enum; the form stores them as an array of strings.
  serviceScope: z
    .array(
      z.enum([
        "IN_COUNTRY_REPRESENTATION",
        "STUDENT_RECRUITMENT",
        "AGENT_ENGAGEMENT",
        "SCHOOL_ENGAGEMENT",
        "EVENTS_AND_FAIRS",
        "MARKETING_SUPPORT",
        "APPLICATION_SUPPORT",
        "CONVERSION_SUPPORT",
        "MARKET_INTELLIGENCE",
        "REPORTING",
        "OTHER",
      ])
    )
    .optional(),
  notes: z.string().optional(),
});

const SERVICE_SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "IN_COUNTRY_REPRESENTATION", label: "In-country Representation" },
  { value: "STUDENT_RECRUITMENT", label: "Student Recruitment" },
  { value: "AGENT_ENGAGEMENT", label: "Agent Engagement" },
  { value: "SCHOOL_ENGAGEMENT", label: "School Engagement" },
  { value: "EVENTS_AND_FAIRS", label: "Events & Fairs" },
  { value: "MARKETING_SUPPORT", label: "Marketing Support" },
  { value: "APPLICATION_SUPPORT", label: "Application Support" },
  { value: "CONVERSION_SUPPORT", label: "Conversion Support" },
  { value: "MARKET_INTELLIGENCE", label: "Market Intelligence" },
  { value: "REPORTING", label: "Reporting" },
  { value: "OTHER", label: "Other" },
];

type InstitutionFormValues = z.infer<typeof institutionSchema>;

// ─── Types ─────────────────────────────────────────────────────────────────

interface Region {
  id: string;
  name: string;
}

interface InstitutionFormProps {
  institution?: {
    id: string;
    name: string;
    legalName?: string | null;
    country: string;
    type: string;
    website: string | null;
    primaryContact: string | null;
    accountStatus: string;
    reportingFrequency?: string | null;
    serviceScope?: string[];
    notes: string | null;
    region?: Region | null;
  };
  regions: Region[];
  mode?: "create" | "edit";
}

// ─── Component ─────────────────────────────────────────────────────────────

export function InstitutionForm({ institution, regions, mode = "create" }: InstitutionFormProps) {
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
  } = useForm<InstitutionFormValues>({
    resolver: zodResolver(institutionSchema) as never,
    defaultValues: {
      name: institution?.name ?? "",
      legalName: institution?.legalName ?? "",
      country: institution?.country ?? "",
      type: (institution?.type as InstitutionFormValues["type"]) ?? "University",
      website: institution?.website ?? "",
      primaryContact: institution?.primaryContact ?? "",
      accountStatus:
        (institution?.accountStatus as InstitutionFormValues["accountStatus"]) ?? "PROSPECT",
      regionId: institution?.region?.id ?? "",
      reportingFrequency:
        (institution?.reportingFrequency as InstitutionFormValues["reportingFrequency"]) ??
        undefined,
      serviceScope: (institution?.serviceScope as InstitutionFormValues["serviceScope"]) ?? [],
      notes: institution?.notes ?? "",
    },
  });

  // Track serviceScope in local state so the multi-select chips can re-render
  // on toggle. React Hook Form watches it in the payload; the local mirror
  // is just for UI.
  const [scope, setScope] = React.useState<string[]>(
    (institution?.serviceScope as string[]) ?? []
  );
  const toggleScope = (v: string) => {
    setScope((prev) => {
      const next = prev.includes(v) ? prev.filter((s) => s !== v) : [...prev, v];
      setValue("serviceScope", next as InstitutionFormValues["serviceScope"]);
      return next;
    });
  };

  const onSubmit = async (data: InstitutionFormValues) => {
    setLoading(true);
    setError(null);
    try {
      const url =
        mode === "edit" ? `/api/institutions/${institution!.id}` : "/api/institutions";
      const method = mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, regionId: data.regionId === "none" ? undefined : data.regionId }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save institution");
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
            Add Institution
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-2">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add Institution" : "Edit Institution"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          {/* Name + Legal Name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input id="name" {...register("name")} placeholder="Institution display name" />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="legalName">Legal Name</Label>
            <Input
              id="legalName"
              {...register("legalName")}
              placeholder="Full legal entity name (optional)"
            />
            <p className="text-xs text-slate-500">
              Used on contracts. Defaults to display name when blank.
            </p>
          </div>

          {/* Country + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="country">
                Country <span className="text-red-500">*</span>
              </Label>
              <Input id="country" {...register("country")} placeholder="e.g. United Kingdom" />
              {errors.country && (
                <p className="text-xs text-red-500">{errors.country.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>
                Type <span className="text-red-500">*</span>
              </Label>
              <Select
                defaultValue={institution?.type ?? "University"}
                onValueChange={(v) => setValue("type", v as InstitutionFormValues["type"])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="University">University</SelectItem>
                  <SelectItem value="College">College</SelectItem>
                  <SelectItem value="Institute">Institute</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
              {errors.type && <p className="text-xs text-red-500">{errors.type.message}</p>}
            </div>
          </div>

          {/* Website */}
          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              {...register("website")}
              type="url"
              placeholder="https://university.edu"
            />
            {errors.website && (
              <p className="text-xs text-red-500">{errors.website.message}</p>
            )}
          </div>

          {/* Primary Contact */}
          <div className="space-y-1.5">
            <Label htmlFor="primaryContact">Primary Contact</Label>
            <Input
              id="primaryContact"
              {...register("primaryContact")}
              placeholder="Contact name"
            />
          </div>

          {/* Account Status — spec §1 Clients six-state palette */}
          <div className="space-y-1.5">
            <Label>Account Status</Label>
            <Select
              defaultValue={institution?.accountStatus ?? "PROSPECT"}
              onValueChange={(v) =>
                setValue("accountStatus", v as InstitutionFormValues["accountStatus"])
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PROSPECT">Prospect</SelectItem>
                <SelectItem value="ONBOARDING">Onboarding</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
                <SelectItem value="SUSPENDED">Suspended</SelectItem>
                <SelectItem value="CLOSED">Closed</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              Renewal Due is now a computed alert from contract dates, not a status.
            </p>
          </div>

          {/* Reporting Frequency — spec §3 */}
          <div className="space-y-1.5">
            <Label>Reporting Frequency</Label>
            <Select
              defaultValue={institution?.reportingFrequency ?? undefined}
              onValueChange={(v) =>
                setValue("reportingFrequency", v as InstitutionFormValues["reportingFrequency"])
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="How often reports are due" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WEEKLY">Weekly</SelectItem>
                <SelectItem value="BIWEEKLY">Biweekly</SelectItem>
                <SelectItem value="MONTHLY">Monthly</SelectItem>
                <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                <SelectItem value="ANNUALLY">Annually</SelectItem>
                <SelectItem value="AD_HOC">Ad-hoc</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Service Scope — spec §3 multi-select */}
          <div className="space-y-1.5">
            <Label>Service Scope</Label>
            <p className="text-xs text-slate-500">
              Which services this client has bought. Multiple selection.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SERVICE_SCOPE_OPTIONS.map((opt) => {
                const active = scope.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleScope(opt.value)}
                    className={
                      "text-xs px-2 py-1 rounded-full border transition-colors " +
                      (active
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-600 hover:bg-slate-50 border-slate-200")
                    }
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Region */}
          <div className="space-y-1.5">
            <Label>Region</Label>
            <Select
              defaultValue={institution?.region?.id ?? ""}
              onValueChange={(v) => setValue("regionId", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select region (optional)" />
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
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
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
                ? "Create Institution"
                : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
