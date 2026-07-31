"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";
import { stageBadgeClass } from "@/lib/lead-pipeline";
import { displayName } from "@/lib/person-name";

interface LeadRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  stage: string;
  nationality: string;
  countryOfResidence: string;
  interestedProgram: string;
  institution?: { name: string } | null;
  assignedICR?: { name: string | null } | null;
  createdAt: string;
}

interface DrillDownSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  filters: Record<string, string>;
}


export function DrillDownSheet({
  open,
  onClose,
  title,
  description,
  filters,
}: DrillDownSheetProps) {
  const router = useRouter();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: "50", ...filters });
    fetch(`/api/leads?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        setLeads(json.data ?? []);
        setTotal(json.meta?.total ?? (json.data ?? []).length);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtersKey]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0 pb-3 border-b border-slate-100">
          <DialogTitle className="text-slate-900">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
          {!loading && (
            <p className="text-xs text-slate-400 mt-1">
              {total} lead{total !== 1 ? "s" : ""}
              {total > 50 ? " (showing first 50)" : ""}
            </p>
          )}
        </DialogHeader>

        <div className="overflow-y-auto flex-1 mt-4 pr-1">
          {loading ? (
            <div className="space-y-3">
              {Array(6).fill(0).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : leads.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <p className="text-sm">No leads found for this filter.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {leads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => { router.push(`/students/${lead.id}`); onClose(); }}
                  className="w-full text-left px-3 py-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800 truncate">
                          {displayName(lead)}
                        </span>
                        <ExternalLink className="h-3 w-3 text-slate-300 group-hover:text-slate-500 shrink-0 transition-colors" />
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {lead.email} · {lead.interestedProgram}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {lead.countryOfResidence}
                        {lead.institution?.name ? ` · ${lead.institution.name}` : ""}
                        {lead.assignedICR?.name ? ` · ${lead.assignedICR.name}` : ""}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                        stageBadgeClass(lead.stage)
                      }`}
                    >
                      {lead.stage.replace(/_/g, " ")}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
