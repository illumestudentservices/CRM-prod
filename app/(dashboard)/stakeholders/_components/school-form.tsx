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

const num = (v: unknown): number | undefined => {
  if (v === "" || v === undefined || v === null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const schoolSchema = z.object({
  name: z.string().min(1, "Name is required"),
  country: z.string().min(1, "Country is required"),
  city: z.string().optional(),
  address: z.string().optional(),
  website: z.string().url("Invalid URL").optional().or(z.literal("")),
  type: z.enum(["PUBLIC", "PRIVATE", "INTERNATIONAL", "BOARDING"]),
  principalName: z.string().optional(),
  principalEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  relationshipStatus: z.enum(["ACTIVE", "DEVELOPING", "DORMANT", "AT_RISK", "INACTIVE"]),
  studentVolume: z.preprocess(num, z.number().int().nonnegative().optional()),
  marketId: z.string().optional(),
  notes: z.string().optional(),
});

type SchoolFormValues = z.input<typeof schoolSchema>;

export function SchoolForm({ markets }: { markets: Array<{ id: string; name: string }> }) {
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
  } = useForm<SchoolFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schoolSchema) as any,
    defaultValues: { type: "PUBLIC", relationshipStatus: "DEVELOPING" },
  });

  const type = watch("type");
  const relationshipStatus = watch("relationshipStatus");
  const marketId = watch("marketId");

  async function onSubmit(values: SchoolFormValues) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stakeholders/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          city: values.city || null,
          address: values.address || null,
          website: values.website || null,
          principalName: values.principalName || null,
          principalEmail: values.principalEmail || null,
          phone: values.phone || null,
          marketId: values.marketId && values.marketId !== "none" ? values.marketId : null,
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
          Add School
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add School</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="school-name">
                Name <span className="text-red-500">*</span>
              </Label>
              <Input id="school-name" {...register("name")} />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="school-country">
                Country <span className="text-red-500">*</span>
              </Label>
              <Input id="school-country" {...register("country")} />
              {errors.country && <p className="text-xs text-red-500">{errors.country.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="school-city">City</Label>
              <Input id="school-city" {...register("city")} />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="school-address">Address</Label>
              <Input id="school-address" {...register("address")} />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="school-website">Website</Label>
              <Input id="school-website" placeholder="https://…" {...register("website")} />
              {errors.website && <p className="text-xs text-red-500">{errors.website.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setValue("type", v as SchoolFormValues["type"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLIC">Public</SelectItem>
                  <SelectItem value="PRIVATE">Private</SelectItem>
                  <SelectItem value="INTERNATIONAL">International</SelectItem>
                  <SelectItem value="BOARDING">Boarding</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Relationship Status</Label>
              <Select
                value={relationshipStatus}
                onValueChange={(v) => setValue("relationshipStatus", v as SchoolFormValues["relationshipStatus"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="DEVELOPING">Developing</SelectItem>
                  <SelectItem value="DORMANT">Dormant</SelectItem>
                  <SelectItem value="AT_RISK">At Risk</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 pt-1 mt-1 border-t border-slate-100 dark:border-slate-800" />

            <div className="space-y-1.5">
              <Label htmlFor="school-principal">Principal Name</Label>
              <Input id="school-principal" {...register("principalName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="school-principal-email">Principal Email</Label>
              <Input id="school-principal-email" type="email" {...register("principalEmail")} />
              {errors.principalEmail && <p className="text-xs text-red-500">{errors.principalEmail.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="school-phone">Phone</Label>
              <Input id="school-phone" {...register("phone")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="school-volume">Student Volume</Label>
              <Input id="school-volume" type="number" min={0} {...register("studentVolume")} />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Market</Label>
              <Select
                value={marketId ?? "none"}
                onValueChange={(v) => setValue("marketId", v === "none" ? undefined : v)}
              >
                <SelectTrigger><SelectValue placeholder="Select market…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {markets.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="school-notes">Notes</Label>
              <Textarea id="school-notes" rows={3} {...register("notes")} />
            </div>
          </div>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading} className="gap-1.5">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? "Creating…" : "Create School"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
