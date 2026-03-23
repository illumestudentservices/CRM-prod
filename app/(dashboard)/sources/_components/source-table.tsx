"use client";

import * as React from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Eye, PowerOff, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { type SourceType } from "@prisma/client";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatPercent } from "@/lib/utils";
import { SourceForm } from "./source-form";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Region {
  id: string;
  name: string;
}

export interface SourceRow {
  id: string;
  name: string;
  type: SourceType;
  country: string;
  city: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  agreementStatus: string | null;
  rating: number | null;
  isActive: boolean;
  totalLeads: number;
  enrolledLeads: number;
  conversionRate: number;
  region: Region | null;
}

interface SourceTableProps {
  sources: SourceRow[];
  filterType: SourceType | null;
  regions: Region[];
}

// ─── Badge colors per type ─────────────────────────────────────────────────

const TYPE_BADGE: Record<SourceType, string> = {
  AGENT: "bg-blue-100 text-blue-700 border-blue-200",
  SCHOOL: "bg-indigo-100 text-indigo-700 border-indigo-200",
  WALK_IN: "bg-slate-100 text-slate-700 border-slate-200",
  CAMPAIGN: "bg-green-100 text-green-700 border-green-200",
  DIGITAL: "bg-violet-100 text-violet-700 border-violet-200",
  PARTNER: "bg-amber-100 text-amber-700 border-amber-200",
};

const TYPE_LABEL: Record<SourceType, string> = {
  AGENT: "Agent",
  SCHOOL: "School",
  WALK_IN: "Walk-in",
  CAMPAIGN: "Campaign",
  DIGITAL: "Digital",
  PARTNER: "Partner",
};

// ─── Star Rating ───────────────────────────────────────────────────────────

function StarRating({ rating }: { rating: number | null }) {
  const filled = rating ?? 0;
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i < filled ? "fill-amber-400 text-amber-400" : "fill-slate-100 text-slate-300"
          }`}
        />
      ))}
    </div>
  );
}

// ─── Actions cell ─────────────────────────────────────────────────────────

function ActionsCell({ source, regions }: { source: SourceRow; regions: Region[] }) {
  const router = useRouter();
  const [deactivating, setDeactivating] = React.useState(false);

  const handleDeactivate = async () => {
    if (!confirm(`Deactivate "${source.name}"?`)) return;
    setDeactivating(true);
    try {
      await fetch(`/api/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      router.refresh();
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <SourceForm source={source} regions={regions} mode="edit" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => router.push(`/sources/${source.id}`)}>
            <Eye className="h-4 w-4 mr-2" /> View
          </DropdownMenuItem>
          {source.isActive && (
            <DropdownMenuItem
              onClick={handleDeactivate}
              disabled={deactivating}
              className="text-red-600 focus:text-red-600"
            >
              <PowerOff className="h-4 w-4 mr-2" />
              {deactivating ? "Deactivating..." : "Deactivate"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ─── Column Definitions ────────────────────────────────────────────────────

function buildColumns(regions: Region[]): ColumnDef<SourceRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium text-slate-900">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${
            TYPE_BADGE[row.original.type]
          }`}
        >
          {TYPE_LABEL[row.original.type]}
        </span>
      ),
    },
    {
      id: "location",
      header: "Country / Region",
      cell: ({ row }) => (
        <div className="text-sm">
          <p className="text-slate-900">{row.original.country}</p>
          {row.original.region && (
            <p className="text-slate-500 text-xs">{row.original.region.name}</p>
          )}
        </div>
      ),
    },
    {
      id: "contact",
      header: "Contact",
      cell: ({ row }) => (
        <div className="text-sm">
          {row.original.contactPerson && (
            <p className="text-slate-900">{row.original.contactPerson}</p>
          )}
          {row.original.email && (
            <p className="text-slate-500 text-xs">{row.original.email}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "rating",
      header: "Rating",
      cell: ({ row }) => <StarRating rating={row.original.rating} />,
    },
    {
      accessorKey: "totalLeads",
      header: "Leads",
      cell: ({ row }) => (
        <span className="text-sm font-medium text-slate-700">
          {row.original.totalLeads}
        </span>
      ),
    },
    {
      accessorKey: "conversionRate",
      header: "Conversion",
      cell: ({ row }) => (
        <span className="text-sm font-medium text-slate-700">
          {formatPercent(row.original.conversionRate)}
        </span>
      ),
    },
    {
      accessorKey: "isActive",
      header: "Status",
      cell: ({ row }) =>
        row.original.isActive ? (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            Active
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
            Inactive
          </Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => <ActionsCell source={row.original} regions={regions} />,
      size: 100,
    },
  ];
}

// ─── Component ─────────────────────────────────────────────────────────────

export function SourceTable({ sources, filterType, regions }: SourceTableProps) {
  const router = useRouter();
  const columns = React.useMemo(() => buildColumns(regions), [regions]);

  return (
    <DataTable
      columns={columns}
      data={sources}
      searchKey="name"
      searchPlaceholder="Search sources..."
      onRowClick={(row) => router.push(`/sources/${row.id}`)}
      emptyTitle="No sources found"
      emptyDescription={
        filterType
          ? `No ${TYPE_LABEL[filterType]} sources yet. Add one to get started.`
          : "No sources found. Add one to get started."
      }
    />
  );
}
