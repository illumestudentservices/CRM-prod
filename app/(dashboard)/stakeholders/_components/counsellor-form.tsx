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

const counsellorSchema = z.object({
  name: z.string().min(1, "Name is required"),
  schoolId: z.string().min(1, "School is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  position: z.string().optional(),
  influenceScore: z.preprocess(num, z.number().int().min(1).max(10).optional()),
});

type CounsellorFormValues = z.input<typeof counsellorSchema>;

export function CounsellorForm({
  schools,
  defaultSchoolId,
}: {
  schools: Array<{ id: string; name: string }>;
  defaultSchoolId?: string;
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
  } = useForm<CounsellorFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(counsellorSchema) as any,
    defaultValues: { schoolId: defaultSchoolId ?? "" },
  });

  const schoolId = watch("schoolId");

  async function onSubmit(values: CounsellorFormValues) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stakeholders/counsellors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          email: values.email || null,
          phone: values.phone || null,
          position: values.position || null,
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
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { reset(); setError(null); } }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Counsellor
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Counsellor</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="counsellor-name">
                Name <span className="text-red-500">*</span>
              </Label>
              <Input id="counsellor-name" {...register("name")} />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>
                School <span className="text-red-500">*</span>
              </Label>
              <Select
                value={schoolId}
                onValueChange={(v) => setValue("schoolId", v)}
              >
                <SelectTrigger><SelectValue placeholder="Select school…" /></SelectTrigger>
                <SelectContent>
                  {schools.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.schoolId && <p className="text-xs text-red-500">{errors.schoolId.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="counsellor-email">Email</Label>
              <Input id="counsellor-email" type="email" {...register("email")} />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="counsellor-phone">Phone</Label>
              <Input id="counsellor-phone" {...register("phone")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="counsellor-position">Position</Label>
              <Input id="counsellor-position" placeholder="e.g. Head of Careers" {...register("position")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="counsellor-score">Influence Score (1–10)</Label>
              <Input id="counsellor-score" type="number" min={1} max={10} {...register("influenceScore")} />
              {errors.influenceScore && <p className="text-xs text-red-500">{errors.influenceScore.message as string}</p>}
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
              {loading ? "Creating…" : "Create Counsellor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
