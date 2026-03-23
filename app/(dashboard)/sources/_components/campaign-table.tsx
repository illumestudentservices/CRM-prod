"use client";

import * as React from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { DataTable } from "@/components/shared/data-table";
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
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CampaignRow {
  id: string;
  name: string;
  channel: string;
  startDate: Date | string;
  endDate: Date | string | null;
  budget: number | null;
  actualSpend: number | null;
  leadsGenerated: number;
}

interface CampaignTableProps {
  campaigns: CampaignRow[];
}

// ─── ROI Helper ────────────────────────────────────────────────────────────

const ESTIMATED_LEAD_VALUE = 500; // USD per lead

function calcROI(campaign: CampaignRow): number | null {
  if (!campaign.actualSpend || campaign.actualSpend === 0) return null;
  return (
    ((campaign.leadsGenerated * ESTIMATED_LEAD_VALUE - campaign.actualSpend) /
      campaign.actualSpend) *
    100
  );
}

// ─── Campaign Form Schema ──────────────────────────────────────────────────

const campaignSchema = z.object({
  name: z.string().min(1, "Name is required"),
  channel: z.string().min(1, "Channel is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
  budget: z.coerce.number().positive("Budget must be positive").optional(),
  actualSpend: z.coerce.number().positive().optional(),
  notes: z.string().optional(),
});

type CampaignFormValues = z.infer<typeof campaignSchema>;

// ─── Add Campaign Dialog ───────────────────────────────────────────────────

function AddCampaignDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignSchema) as never,
  });

  const onSubmit = async (data: CampaignFormValues) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to create campaign");
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
        <Button className="gap-2 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90">
          <Plus className="h-4 w-4" />
          Add Campaign
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">
              Campaign Name <span className="text-red-500">*</span>
            </Label>
            <Input id="name" {...register("name")} placeholder="e.g. Summer 2025 Drive" />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="channel">
              Channel <span className="text-red-500">*</span>
            </Label>
            <Input id="channel" {...register("channel")} placeholder="e.g. Google Ads, Facebook" />
            {errors.channel && (
              <p className="text-xs text-red-500">{errors.channel.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="startDate">
                Start Date <span className="text-red-500">*</span>
              </Label>
              <Input id="startDate" type="date" {...register("startDate")} />
              {errors.startDate && (
                <p className="text-xs text-red-500">{errors.startDate.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate">End Date</Label>
              <Input id="endDate" type="date" {...register("endDate")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="budget">Budget (USD)</Label>
              <Input
                id="budget"
                type="number"
                step="0.01"
                {...register("budget")}
                placeholder="0.00"
              />
              {errors.budget && (
                <p className="text-xs text-red-500">{errors.budget.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="actualSpend">Actual Spend (USD)</Label>
              <Input
                id="actualSpend"
                type="number"
                step="0.01"
                {...register("actualSpend")}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" {...register("notes")} rows={3} />
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
              {loading ? "Creating..." : "Create Campaign"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Columns ───────────────────────────────────────────────────────────────

const columns: ColumnDef<CampaignRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium text-slate-900">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "channel",
    header: "Channel",
    cell: ({ row }) => (
      <span className="text-sm text-slate-700">{row.original.channel}</span>
    ),
  },
  {
    id: "dateRange",
    header: "Date Range",
    cell: ({ row }) => (
      <div className="text-sm text-slate-700">
        {formatDate(row.original.startDate)}
        {row.original.endDate && ` — ${formatDate(row.original.endDate)}`}
      </div>
    ),
  },
  {
    accessorKey: "budget",
    header: "Budget",
    cell: ({ row }) => (
      <span className="text-sm">{formatCurrency(row.original.budget)}</span>
    ),
  },
  {
    accessorKey: "actualSpend",
    header: "Actual Spend",
    cell: ({ row }) => (
      <span className="text-sm">{formatCurrency(row.original.actualSpend)}</span>
    ),
  },
  {
    accessorKey: "leadsGenerated",
    header: "Leads",
    cell: ({ row }) => (
      <span className="text-sm font-medium">{row.original.leadsGenerated}</span>
    ),
  },
  {
    id: "roi",
    header: "ROI",
    cell: ({ row }) => {
      const roi = calcROI(row.original);
      if (roi === null) return <span className="text-slate-400 text-sm">—</span>;
      return (
        <span
          className={`text-sm font-medium ${roi >= 0 ? "text-green-600" : "text-red-600"}`}
        >
          {roi >= 0 ? "+" : ""}
          {formatPercent(roi)}
        </span>
      );
    },
  },
];

// ─── Component ─────────────────────────────────────────────────────────────

export function CampaignTable({ campaigns }: CampaignTableProps) {
  return (
    <DataTable
      columns={columns}
      data={campaigns}
      searchKey="name"
      searchPlaceholder="Search campaigns..."
      actions={<AddCampaignDialog />}
      emptyTitle="No campaigns yet"
      emptyDescription="Create your first campaign to track marketing ROI."
    />
  );
}
