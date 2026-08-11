"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Loader2 } from "lucide-react";
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

// The five partner types visible on /recruitment-network/partners tabs.
// SourceType also holds WALK_IN / CAMPAIGN / DIGITAL, but those aren't
// partner-relationship rows — they get created from other flows.
const TYPE_OPTIONS = [
  { value: "AGENT", label: "Agent" },
  { value: "SCHOOL", label: "School" },
  { value: "REFERRAL_PARTNER", label: "Referral Partner" },
  { value: "PARTNER", label: "Partner" },
  { value: "EDUCATION_PARTNER", label: "Education Partner" },
] as const;

// agreementStatus is a free-text column in the schema; these are the values
// the seed data uses so the dropdown looks curated instead of a text box.
const AGREEMENT_OPTIONS = [
  { value: "SIGNED", label: "Signed" },
  { value: "PENDING", label: "Pending" },
  { value: "IN_NEGOTIATION", label: "In Negotiation" },
  { value: "EXPIRED", label: "Expired" },
  { value: "NONE", label: "None" },
];

const partnerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["AGENT", "SCHOOL", "REFERRAL_PARTNER", "PARTNER", "EDUCATION_PARTNER"]),
  country: z.string().min(1, "Country is required"),
  city: z.string().optional(),
  regionId: z.string().optional(),
  contactPerson: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  agreementStatus: z.string().optional(),
  rating: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === "" || v === undefined || v === null) return undefined;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : undefined;
    })
    .refine((n) => n === undefined || (n >= 1 && n <= 5), "Rating must be 1–5"),
  notes: z.string().optional(),
});

type PartnerFormValues = z.input<typeof partnerSchema>;

interface Region {
  id: string;
  name: string;
}

export function PartnerForm({
  regions,
  defaultType,
}: {
  regions: Region[];
  /**
   * When the user clicks "Add" while a tab is active, pre-select that tab's
   * type so agents-tab → AGENT etc. Not required.
   */
  defaultType?: "AGENT" | "SCHOOL" | "REFERRAL_PARTNER" | "PARTNER" | "EDUCATION_PARTNER";
}) {
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
  } = useForm<PartnerFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(partnerSchema) as any,
    defaultValues: {
      type: defaultType ?? "AGENT",
      agreementStatus: "PENDING",
    },
  });

  const type = watch("type");
  const regionId = watch("regionId");
  const agreementStatus = watch("agreementStatus");

  async function onSubmit(values: PartnerFormValues) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          // Empty strings need to become nulls for optional columns so Prisma
          // doesn't try to write "" into a nullable email column.
          email: values.email || null,
          city: values.city || null,
          contactPerson: values.contactPerson || null,
          phone: values.phone || null,
          regionId: values.regionId && values.regionId !== "none" ? values.regionId : null,
          agreementStatus:
            values.agreementStatus && values.agreementStatus !== "NONE"
              ? values.agreementStatus
              : null,
          rating: values.rating,
          notes: values.notes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (HTTP ${res.status})`);
      }
      setOpen(false);
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
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Partner
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Recruitment Partner</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="partner-name">
                Name <span className="text-red-500">*</span>
              </Label>
              <Input id="partner-name" placeholder="Partner name" {...register("name")} />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                Type <span className="text-red-500">*</span>
              </Label>
              <Select
                value={type}
                onValueChange={(v) =>
                  setValue("type", v as PartnerFormValues["type"], { shouldDirty: true })
                }
              >
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
              <Label htmlFor="partner-country">
                Country <span className="text-red-500">*</span>
              </Label>
              <Input id="partner-country" placeholder="Country" {...register("country")} />
              {errors.country && <p className="text-xs text-red-500">{errors.country.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="partner-city">City</Label>
              <Input id="partner-city" placeholder="City" {...register("city")} />
            </div>

            <div className="space-y-1.5">
              <Label>Region</Label>
              <Select
                value={regionId ?? "none"}
                onValueChange={(v) => setValue("regionId", v === "none" ? undefined : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select region…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {regions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 pt-1 mt-1 border-t border-slate-100 dark:border-slate-800" />

            <div className="space-y-1.5">
              <Label htmlFor="partner-contact">Contact Person</Label>
              <Input
                id="partner-contact"
                placeholder="Primary contact"
                {...register("contactPerson")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="partner-email">Email</Label>
              <Input
                id="partner-email"
                type="email"
                placeholder="contact@partner.example"
                {...register("email")}
              />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="partner-phone">Phone</Label>
              <Input id="partner-phone" placeholder="+1 555 …" {...register("phone")} />
            </div>

            <div className="space-y-1.5">
              <Label>Agreement Status</Label>
              <Select
                value={agreementStatus ?? "PENDING"}
                onValueChange={(v) => setValue("agreementStatus", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGREEMENT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="partner-rating">Rating (1–5)</Label>
              <Input
                id="partner-rating"
                type="number"
                min={1}
                max={5}
                step={1}
                {...register("rating")}
              />
              {errors.rating && (
                <p className="text-xs text-red-500">{errors.rating.message as string}</p>
              )}
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="partner-notes">Notes</Label>
              <Textarea
                id="partner-notes"
                rows={3}
                placeholder="Anything worth remembering…"
                {...register("notes")}
              />
            </div>
          </div>

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
            <Button type="submit" disabled={loading} className="gap-1.5">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? "Creating…" : "Create Partner"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
