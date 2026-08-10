"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2, Building2, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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

/**
 * The student's applications.
 *
 * Stages 4, 6 and 7 read their required fields from the active application, so
 * this is where an ICR records the application number, the offer, and the
 * deposit. Superseded applications stay listed — knowing a student was rejected
 * by one institution before being offered by another is the point of keeping
 * them as separate records.
 */

interface Application {
  id: string;
  institutionId: string;
  institution: { id: string; name: string };
  program: string;
  applicationNumber: string | null;
  submissionMethod: string | null;
  submissionDate: string | null;
  status: string;
  offerType: string | null;
  offerExpiryDate: string | null;
  studentDecision: string | null;
  depositDeadline: string | null;
  depositDeadlineNotApplicable: boolean;
  depositPaid: boolean;
  depositDate: string | null;
  acceptanceStatus: string | null;
  isActive: boolean;
}

const METHODS = [
  { value: "ONLINE_PORTAL", label: "Online portal" },
  { value: "EMAIL", label: "Email" },
  { value: "AGENT", label: "Via agent" },
  { value: "DIRECT", label: "Direct" },
  { value: "OTHER", label: "Other" },
];
const OFFER_TYPES = [
  { value: "UNCONDITIONAL", label: "Unconditional" },
  { value: "CONDITIONAL", label: "Conditional" },
  { value: "SCHOLARSHIP", label: "Scholarship" },
  { value: "REJECTED", label: "Rejected" },
];
const DECISIONS = [
  { value: "ACCEPTED", label: "Accepted" },
  { value: "DECLINED", label: "Declined" },
  { value: "UNDECIDED", label: "Undecided" },
];
const ACCEPTANCE = [
  { value: "ACCEPTED", label: "Accepted" },
  { value: "DEFERRED", label: "Deferred" },
  { value: "WITHDRAWN", label: "Withdrawn" },
];

const iso = (d: string) => new Date(d).toISOString();
const dayValue = (d: string | null) => (d ? d.slice(0, 10) : "");

export function ApplicationPanel({
  leadId,
  institutions,
  defaultProgram,
}: {
  leadId: string;
  institutions: { id: string; name: string }[];
  defaultProgram: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [apps, setApps] = React.useState<Application[] | null>(null);
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [institutionId, setInstitutionId] = React.useState("");
  const [program, setProgram] = React.useState(defaultProgram);
  const [appNumber, setAppNumber] = React.useState("");
  const [method, setMethod] = React.useState("");
  const [submitted, setSubmitted] = React.useState(new Date().toISOString().slice(0, 10));

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/leads/${leadId}/applications`);
    if (res.ok) setApps((await res.json()).applications ?? []);
  }, [leadId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institutionId,
          program: program.trim(),
          applicationNumber: appNumber.trim() || undefined,
          submissionMethod: method || undefined,
          submissionDate: submitted ? iso(submitted) : undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: d.error ?? "Could not save", variant: "destructive" });
        return;
      }
      toast({ title: "Application recorded" });
      setOpen(false);
      setInstitutionId("");
      setAppNumber("");
      setMethod("");
      await load();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function patch(applicationId: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/leads/${leadId}/applications`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId, ...payload }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast({ title: d.error ?? "Could not update", variant: "destructive" });
      return;
    }
    await load();
    router.refresh();
  }

  const active = apps?.find((a) => a.isActive);
  const superseded = (apps ?? []).filter((a) => !a.isActive);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {active
            ? `Active: ${active.institution.name}`
            : "No application recorded yet."}
        </p>
        <Button
          size="sm"
          variant={active ? "outline" : "default"}
          className={cn("gap-1.5", !active && "bg-[#0EA5E9] hover:bg-[#0EA5E9]/90")}
          onClick={() => setOpen(true)}
        >
          <FilePlus2 className="h-4 w-4" />
          {active ? "New application" : "Record application"}
        </Button>
      </div>

      {active && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{active.institution.name}</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">· {active.program}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Application number">
              <Input
                className="h-8 text-xs"
                defaultValue={active.applicationNumber ?? ""}
                onBlur={(e) =>
                  e.target.value !== (active.applicationNumber ?? "") &&
                  patch(active.id, { applicationNumber: e.target.value || null })
                }
              />
            </Field>
            <Field label="Submitted on">
              <Input
                type="date"
                className="h-8 text-xs"
                defaultValue={dayValue(active.submissionDate)}
                onBlur={(e) =>
                  patch(active.id, { submissionDate: e.target.value ? iso(e.target.value) : null })
                }
              />
            </Field>
            <Field label="Method">
              <Picker
                value={active.submissionMethod}
                options={METHODS}
                onChange={(v) => patch(active.id, { submissionMethod: v })}
              />
            </Field>
            <Field label="Offer type">
              <Picker
                value={active.offerType}
                options={OFFER_TYPES}
                onChange={(v) => patch(active.id, { offerType: v })}
              />
            </Field>
            <Field label="Offer expires">
              <Input
                type="date"
                className="h-8 text-xs"
                defaultValue={dayValue(active.offerExpiryDate)}
                onBlur={(e) =>
                  patch(active.id, { offerExpiryDate: e.target.value ? iso(e.target.value) : null })
                }
              />
            </Field>
            <Field label="Student decision">
              <Picker
                value={active.studentDecision}
                options={DECISIONS}
                onChange={(v) => patch(active.id, { studentDecision: v })}
              />
            </Field>
            <Field label="Deposit deadline">
              <Input
                type="date"
                className="h-8 text-xs"
                disabled={active.depositDeadlineNotApplicable}
                defaultValue={dayValue(active.depositDeadline)}
                onBlur={(e) =>
                  patch(active.id, { depositDeadline: e.target.value ? iso(e.target.value) : null })
                }
              />
            </Field>
            <Field label="Deposit paid on">
              <Input
                type="date"
                className="h-8 text-xs"
                defaultValue={dayValue(active.depositDate)}
                onBlur={(e) =>
                  patch(active.id, {
                    depositDate: e.target.value ? iso(e.target.value) : null,
                    depositPaid: !!e.target.value,
                  })
                }
              />
            </Field>
            <Field label="Acceptance status">
              <Picker
                value={active.acceptanceStatus}
                options={ACCEPTANCE}
                onChange={(v) => patch(active.id, { acceptanceStatus: v })}
              />
            </Field>
          </div>

          {/* Lets the ICR state that no deposit deadline applies, so the gate can
              tell a deliberate decision from an unfilled field. */}
          <label className="flex items-center gap-2 pt-1 cursor-pointer">
            <Checkbox
              checked={active.depositDeadlineNotApplicable}
              onCheckedChange={(v) =>
                patch(active.id, { depositDeadlineNotApplicable: v === true })
              }
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">No deposit deadline applies</span>
          </label>
        </div>
      )}

      {superseded.length > 0 && (
        <div className="pt-1">
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
            <Archive className="h-3 w-3" />
            Previous applications
          </p>
          <div className="space-y-1">
            {superseded.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 rounded-md bg-slate-50 dark:bg-slate-900/40 px-2.5 py-1.5"
              >
                <span className="font-medium text-slate-600 dark:text-slate-300">{a.institution.name}</span>
                <span className="text-slate-400 dark:text-slate-500">· {a.program}</span>
                {a.offerType === "REJECTED" && (
                  <span className="ml-auto text-red-600 dark:text-red-400">Rejected</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{active ? "New application" : "Record application"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {active && (
              <p className="text-xs text-slate-500 dark:text-slate-400 rounded-lg bg-slate-50 dark:bg-slate-900/40 p-2.5">
                This becomes the active application. The current one is kept on the
                record rather than replaced.
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Institution</Label>
              <Select value={institutionId} onValueChange={setInstitutionId}>
                <SelectTrigger><SelectValue placeholder="Select institution" /></SelectTrigger>
                <SelectContent>
                  {institutions.map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Programme</Label>
              <Input value={program} onChange={(e) => setProgram(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Application number</Label>
                <Input value={appNumber} onChange={(e) => setAppNumber(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Submitted on</Label>
                <Input type="date" value={submitted} onChange={(e) => setSubmitted(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue placeholder="How was it submitted?" /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!institutionId || !program.trim() || saving}
              onClick={create}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-slate-400 dark:text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function Picker({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
