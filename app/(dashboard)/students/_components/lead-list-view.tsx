"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { UserCheck } from "lucide-react";
import { cn, formatDate, getInitials, getMonthName } from "@/lib/utils";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { LeadWithRelations } from "./lead-card";
import type { User } from "@prisma/client";

// ─── Stage helpers ─────────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  APPLICATION_SENT: "Application Sent",
  DOCUMENTS_RECEIVED: "Documents Received",
  OFFER_ISSUED: "Offer Issued",
  ENROLLED: "Enrolled",
  DEFERRED: "Deferred",
  REJECTED: "Rejected",
  LOST: "Lost",
};

export const STAGE_COLORS: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-700",
  CONTACTED: "bg-blue-100 text-blue-700",
  APPLICATION_SENT: "bg-indigo-100 text-indigo-700",
  DOCUMENTS_RECEIVED: "bg-violet-100 text-violet-700",
  OFFER_ISSUED: "bg-amber-100 text-amber-700",
  ENROLLED: "bg-green-100 text-green-700",
  DEFERRED: "bg-orange-100 text-orange-700",
  REJECTED: "bg-red-100 text-red-700",
  LOST: "bg-gray-100 text-gray-600",
};

function StageBadge({ stage }: { stage: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STAGE_COLORS[stage] ?? "bg-slate-100 text-slate-700"
      )}
    >
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}

// ─── Assign ICR modal ─────────────────────────────────────────────────────────

interface AssignICRModalProps {
  open: boolean;
  onClose: () => void;
  selectedLeads: LeadWithRelations[];
  icrUsers: Pick<User, "id" | "name" | "image">[];
  onAssigned: () => void;
}

function AssignICRModal({
  open,
  onClose,
  selectedLeads,
  icrUsers,
  onAssigned,
}: AssignICRModalProps) {
  const [icrId, setIcrId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const { toast } = useToast();

  async function handleAssign() {
    if (!icrId) return;
    setLoading(true);
    try {
      await Promise.all(
        selectedLeads.map((lead) =>
          fetch(`/api/leads/${lead.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignedICRId: icrId }),
          })
        )
      );
      toast({
        title: "ICR assigned",
        description: `Assigned ${selectedLeads.length} lead(s) successfully.`,
        variant: "success",
      });
      onAssigned();
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to assign ICR.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign ICR</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <p className="text-sm text-slate-500">
            Assign {selectedLeads.length} selected lead(s) to an ICR.
          </p>
          <Select value={icrId} onValueChange={setIcrId}>
            <SelectTrigger>
              <SelectValue placeholder="Select ICR..." />
            </SelectTrigger>
            <SelectContent>
              {icrUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-5 w-5">
                      {u.image && <AvatarImage src={u.image} />}
                      <AvatarFallback className="text-[9px]">
                        {getInitials(u.name)}
                      </AvatarFallback>
                    </Avatar>
                    {u.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={!icrId || loading}>
            {loading ? "Assigning..." : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface LeadListViewProps {
  leads: LeadWithRelations[];
  icrUsers?: Pick<User, "id" | "name" | "image">[];
}

export function LeadListView({ leads, icrUsers = [] }: LeadListViewProps) {
  const router = useRouter();
  const [selectedLeads, setSelectedLeads] = React.useState<LeadWithRelations[]>([]);
  const [assignModalOpen, setAssignModalOpen] = React.useState(false);

  const columns: ColumnDef<LeadWithRelations>[] = [
    {
      accessorKey: "fullName",
      header: "Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-[#1E3A5F]">
              {getInitials(row.original.fullName)}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate">{row.original.fullName}</p>
            {row.original.isDuplicate && (
              <p className="text-[10px] text-amber-600 font-medium">Possible duplicate</p>
            )}
          </div>
        </div>
      ),
      size: 200,
    },
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ getValue }) => (
        <span className="text-sm text-slate-600 truncate">{getValue() as string}</span>
      ),
      size: 200,
    },
    {
      accessorKey: "interestedProgram",
      header: "Program",
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="text-sm text-slate-700 truncate">{row.original.interestedProgram}</p>
          <p className="text-[11px] text-slate-400">
            {row.original.studyLevel.replace(/_/g, " ")}
          </p>
        </div>
      ),
      size: 180,
    },
    {
      accessorKey: "stage",
      header: "Stage",
      cell: ({ getValue }) => <StageBadge stage={getValue() as string} />,
      size: 160,
      filterFn: (row, _, filterValue) => {
        if (!filterValue) return true;
        return row.original.stage === filterValue;
      },
    },
    {
      id: "source",
      accessorFn: (row) => row.source?.name ?? "",
      header: "Source",
      cell: ({ row }) => (
        <span className="text-sm text-slate-600">{row.original.source?.name ?? "—"}</span>
      ),
      size: 140,
    },
    {
      id: "institution",
      accessorFn: (row) => row.institution?.name ?? "",
      header: "Institution",
      cell: ({ row }) => (
        <span className="text-sm text-slate-600 truncate">
          {row.original.institution?.name ?? "—"}
        </span>
      ),
      size: 180,
    },
    {
      id: "assignedICR",
      accessorFn: (row) => row.assignedICR?.name ?? "",
      header: "ICR",
      cell: ({ row }) =>
        row.original.assignedICR ? (
          <div className="flex items-center gap-1.5">
            <Avatar className="h-6 w-6">
              {row.original.assignedICR.image && (
                <AvatarImage src={row.original.assignedICR.image} />
              )}
              <AvatarFallback className="text-[10px]">
                {getInitials(row.original.assignedICR.name)}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-slate-600 truncate">
              {row.original.assignedICR.name}
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-400">Unassigned</span>
        ),
      size: 140,
    },
    {
      id: "intake",
      accessorFn: (row) => `${row.intakeMonth}/${row.intakeYear}`,
      header: "Intake",
      cell: ({ row }) => (
        <span className="text-xs text-slate-600 whitespace-nowrap">
          {getMonthName(row.original.intakeMonth).slice(0, 3)} {row.original.intakeYear}
        </span>
      ),
      size: 100,
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ getValue }) => (
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {formatDate(getValue() as Date)}
        </span>
      ),
      size: 110,
    },
  ];

  const bulkActions =
    selectedLeads.length > 0 ? (
      <Button
        size="sm"
        variant="outline"
        className="gap-2"
        onClick={() => setAssignModalOpen(true)}
      >
        <UserCheck className="h-4 w-4" />
        Assign ICR ({selectedLeads.length})
      </Button>
    ) : null;

  return (
    <>
      <DataTable
        columns={columns}
        data={leads}
        searchKey="fullName"
        searchPlaceholder="Search leads..."
        onRowClick={(lead) => router.push(`/students/${lead.id}`)}
        enableRowSelection
        onSelectionChange={setSelectedLeads}
        actions={bulkActions}
        emptyTitle="No leads found"
        emptyDescription="Try adjusting your filters or add a new lead."
      />

      <AssignICRModal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        selectedLeads={selectedLeads}
        icrUsers={icrUsers}
        onAssigned={() => router.refresh()}
      />
    </>
  );
}
