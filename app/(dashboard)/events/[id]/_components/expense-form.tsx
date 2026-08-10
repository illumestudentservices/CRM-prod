"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Schema ────────────────────────────────────────────────────────────────

const expenseSchema = z.object({
  description: z.string().min(1, "Description is required"),
  amount: z.coerce.number().positive("Amount must be positive"),
  category: z.enum(["Travel", "Venue", "Marketing", "Materials", "Staff", "Other"]).optional(),
});

type ExpenseFormValues = z.infer<typeof expenseSchema>;

interface ExpenseFormProps {
  eventId: string;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ExpenseForm({ eventId }: ExpenseFormProps) {
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
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema) as never,
    defaultValues: { category: "Other" },
  });

  const onSubmit = async (data: ExpenseFormValues) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to add expense");
      }
      setOpen(false);
      reset();
      // Optimistic: router refresh will update the totals
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
        <Button size="sm" variant="outline" className="gap-2">
          <Plus className="h-4 w-4" />
          Add Expense
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Expense</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="description">
              Description <span className="text-red-500">*</span>
            </Label>
            <Input
              id="description"
              {...register("description")}
              placeholder="e.g. Venue hire"
            />
            {errors.description && (
              <p className="text-xs text-red-500">{errors.description.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount">
              Amount (USD) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              {...register("amount")}
              placeholder="0.00"
            />
            {errors.amount && (
              <p className="text-xs text-red-500">{errors.amount.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select
              defaultValue="Other"
              onValueChange={(v) =>
                setValue("category", v as ExpenseFormValues["category"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Travel">Travel</SelectItem>
                <SelectItem value="Venue">Venue</SelectItem>
                <SelectItem value="Marketing">Marketing</SelectItem>
                <SelectItem value="Materials">Materials</SelectItem>
                <SelectItem value="Staff">Staff</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
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
              {loading ? "Adding..." : "Add Expense"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
