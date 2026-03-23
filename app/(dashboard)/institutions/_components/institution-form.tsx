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
  country: z.string().min(1, "Country is required"),
  type: z.enum(["University", "College", "Institute", "Other"]),
  website: z.string().url("Invalid URL").optional().or(z.literal("")),
  primaryContact: z.string().optional(),
  accountStatus: z.enum(["PROSPECT", "ACTIVE", "RENEWAL_DUE", "CHURNED"]).optional(),
  regionId: z.string().optional(),
  notes: z.string().optional(),
});

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
    country: string;
    type: string;
    website: string | null;
    primaryContact: string | null;
    accountStatus: string;
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
      country: institution?.country ?? "",
      type: (institution?.type as InstitutionFormValues["type"]) ?? "University",
      website: institution?.website ?? "",
      primaryContact: institution?.primaryContact ?? "",
      accountStatus:
        (institution?.accountStatus as InstitutionFormValues["accountStatus"]) ?? "PROSPECT",
      regionId: institution?.region?.id ?? "",
      notes: institution?.notes ?? "",
    },
  });

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
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input id="name" {...register("name")} placeholder="Institution name" />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
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

          {/* Account Status */}
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
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="RENEWAL_DUE">Renewal Due</SelectItem>
                <SelectItem value="CHURNED">Churned</SelectItem>
              </SelectContent>
            </Select>
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
