"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Star } from "lucide-react";
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
import { cn } from "@/lib/utils";

// ─── Schema ────────────────────────────────────────────────────────────────

const sourceSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["AGENT", "SCHOOL", "WALK_IN", "CAMPAIGN", "DIGITAL", "PARTNER"]),
  country: z.string().min(1, "Country is required"),
  city: z.string().optional(),
  regionId: z.string().optional(),
  contactPerson: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  agreementStatus: z.enum(["NONE", "SIGNED", "PENDING", "EXPIRED"]).optional(),
  rating: z.number().min(1).max(5).optional(),
  notes: z.string().optional(),
});

type SourceFormValues = z.infer<typeof sourceSchema>;

// ─── Types ─────────────────────────────────────────────────────────────────

interface Region {
  id: string;
  name: string;
}

interface SourceFormProps {
  source?: {
    id: string;
    name: string;
    type: string;
    country: string;
    city: string | null;
    contactPerson: string | null;
    email: string | null;
    phone: string | null;
    agreementStatus: string | null;
    rating: number | null;
    notes?: string | null;
    region: Region | null;
  };
  regions: Region[];
  mode?: "create" | "edit";
}

// ─── Star selector ─────────────────────────────────────────────────────────

function StarSelector({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const [hovered, setHovered] = React.useState<number | null>(null);
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => {
        const starValue = i + 1;
        const filled = hovered !== null ? starValue <= hovered : starValue <= (value ?? 0);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(starValue)}
            onMouseEnter={() => setHovered(starValue)}
            onMouseLeave={() => setHovered(null)}
            className="focus:outline-none"
          >
            <Star
              className={cn(
                "h-5 w-5 transition-colors",
                filled ? "fill-amber-400 text-amber-400" : "fill-slate-100 text-slate-300 hover:text-amber-300"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

// ─── Form Component ────────────────────────────────────────────────────────

export function SourceForm({ source, regions, mode = "create" }: SourceFormProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<SourceFormValues>({
    resolver: zodResolver(sourceSchema) as never,
    defaultValues: {
      name: source?.name ?? "",
      type: (source?.type as SourceFormValues["type"]) ?? "AGENT",
      country: source?.country ?? "",
      city: source?.city ?? "",
      regionId: source?.region?.id ?? "",
      contactPerson: source?.contactPerson ?? "",
      email: source?.email ?? "",
      phone: source?.phone ?? "",
      agreementStatus: (source?.agreementStatus as SourceFormValues["agreementStatus"]) ?? "NONE",
      rating: source?.rating ?? undefined,
      notes: source?.notes ?? "",
    },
  });

  const rating = watch("rating");

  const onSubmit = async (data: SourceFormValues) => {
    setLoading(true);
    setError(null);
    try {
      const url = mode === "edit" ? `/api/sources/${source!.id}` : "/api/sources";
      const method = mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, regionId: (data as { regionId?: string }).regionId === "none" ? undefined : (data as { regionId?: string }).regionId }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save source");
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
            Add Source
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Source" : "Edit Source"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input id="name" {...register("name")} placeholder="Source name" />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <Label>
              Type <span className="text-red-500">*</span>
            </Label>
            <Select
              defaultValue={source?.type ?? "AGENT"}
              onValueChange={(v) => setValue("type", v as SourceFormValues["type"])}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AGENT">Agent</SelectItem>
                <SelectItem value="SCHOOL">School</SelectItem>
                <SelectItem value="WALK_IN">Walk-in</SelectItem>
                <SelectItem value="CAMPAIGN">Campaign</SelectItem>
                <SelectItem value="DIGITAL">Digital</SelectItem>
                <SelectItem value="PARTNER">Partner</SelectItem>
              </SelectContent>
            </Select>
            {errors.type && <p className="text-xs text-red-500">{errors.type.message}</p>}
          </div>

          {/* Country + City */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="country">
                Country <span className="text-red-500">*</span>
              </Label>
              <Input id="country" {...register("country")} placeholder="e.g. India" />
              {errors.country && (
                <p className="text-xs text-red-500">{errors.country.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" {...register("city")} placeholder="e.g. Mumbai" />
            </div>
          </div>

          {/* Region */}
          <div className="space-y-1.5">
            <Label>Region</Label>
            <Select
              defaultValue={source?.region?.id ?? ""}
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

          {/* Contact Person */}
          <div className="space-y-1.5">
            <Label htmlFor="contactPerson">Contact Person</Label>
            <Input
              id="contactPerson"
              {...register("contactPerson")}
              placeholder="Full name"
            />
          </div>

          {/* Email + Phone */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" {...register("email")} type="email" placeholder="email@example.com" />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" {...register("phone")} placeholder="+1 555 0000" />
            </div>
          </div>

          {/* Agreement Status */}
          <div className="space-y-1.5">
            <Label>Agreement Status</Label>
            <Select
              defaultValue={source?.agreementStatus ?? "NONE"}
              onValueChange={(v) =>
                setValue("agreementStatus", v as SourceFormValues["agreementStatus"])
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">None</SelectItem>
                <SelectItem value="SIGNED">Signed</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Rating */}
          <div className="space-y-1.5">
            <Label>Rating</Label>
            <StarSelector
              value={rating}
              onChange={(v) => setValue("rating", v)}
            />
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
              {loading ? "Saving..." : mode === "create" ? "Create Source" : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
