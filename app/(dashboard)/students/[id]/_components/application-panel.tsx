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
import { Textarea } from "@/components/ui/textarea";
import {
  ACCEPTANCE_STATUS_OPTIONS,
  APPLICATION_STATUS_OPTIONS,
  DEPOSIT_STATUS_OPTIONS,
  OFFER_TYPE_OPTIONS,
  STUDENT_DECISION_OPTIONS,
  SUBMISSION_METHOD_OPTIONS,
} from "@/lib/application-options";
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
  /** Spec §9 "Offer date". Held all along; nothing on screen could set it. */
  offerReceivedAt: string | null;
  offerExpiryDate: string | null;
  /** Spec §9 "Conditions, where applicable". */
  offerConditions: string | null;
  studentDecision: string | null;
  depositDeadline: string | null;
  depositDeadlineNotApplicable: boolean;
  depositPaid: boolean;
  depositDate: string | null;
  /** Spec §10 — the six deposit statuses the boolean below cannot express. */
  depositStatus: string | null;
  /** Spec §10 — when the acceptance was recorded (migration 037). */
  acceptanceDate: string | null;
  /** Spec §8 Stage 5 (migration 037). */
  lastInstitutionUpdateAt: string | null;
  expectedDecisionDate: string | null;
  outstandingRequirement: string | null;
  /** Spec §7 — the alternative to a reference number (migration 037). */
  submissionEvidence: string | null;
  depositAmount: number | null;
  depositCurrency: string | null;
  acceptanceStatus: string | null;
  isActive: boolean;
}

// Option lists come from lib/application-options.ts, which is also what the
// API's zod schemas are derived from. They used to be declared here as well,
// and the two lists disagreed: this panel offered 4 offer types and 3 student
// decisions where the specification names 5 and 6.
const METHODS = SUBMISSION_METHOD_OPTIONS;
const OFFER_TYPES = OFFER_TYPE_OPTIONS;
const DECISIONS = STUDENT_DECISION_OPTIONS;
const ACCEPTANCE = ACCEPTANCE_STATUS_OPTIONS;
const DEPOSIT_STATUSES = DEPOSIT_STATUS_OPTIONS;
const APP_STATUSES = APPLICATION_STATUS_OPTIONS;

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
            <Field label="Application status">
              <Picker
                value={active.status}
                options={APP_STATUSES}
                onChange={(v) => patch(active.id, { status: v })}
              />
            </Field>
            <Field label="Offer type">
              <Picker
                value={active.offerType}
                options={OFFER_TYPES}
                onChange={(v) => patch(active.id, { offerType: v })}
              />
            </Field>
            <Field label="Offer received on">
              <Input
                type="date"
                className="h-8 text-xs"
                defaultValue={dayValue(active.offerReceivedAt)}
                onBlur={(e) =>
                  patch(active.id, { offerReceivedAt: e.target.value ? iso(e.target.value) : null })
                }
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
            {/* Spec §10. The boolean this replaces could say only paid or not,
                so an institution that waived the deposit — or never asked for
                one — left the student stuck one stage short of Enrolled. The
                server derives `depositPaid` from this, so the two agree. */}
            <Field label="Deposit status">
              <Picker
                value={active.depositStatus}
                options={DEPOSIT_STATUSES}
                onChange={(v) => patch(active.id, { depositStatus: v })}
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
                    // Only implied when no explicit status has been recorded —
                    // otherwise typing a date would silently overwrite "Waived".
                    ...(active.depositStatus ? {} : { depositPaid: !!e.target.value }),
                  })
                }
              />
            </Field>
            <Field label="Deposit amount">
              <Input
                type="number"
                min={0}
                step="0.01"
                className="h-8 text-xs"
                defaultValue={active.depositAmount ?? ""}
                onBlur={(e) =>
                  patch(active.id, {
                    // An empty box means "not recorded", not zero.
                    depositAmount: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Currency">
              <Input
                className="h-8 text-xs uppercase"
                maxLength={3}
                placeholder="CAD"
                defaultValue={active.depositCurrency ?? ""}
                onBlur={(e) =>
                  e.target.value.toUpperCase() !== (active.depositCurrency ?? "") &&
                  patch(active.id, { depositCurrency: e.target.value || null })
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
            <Field label="Accepted on">
              <Input
                type="date"
                className="h-8 text-xs"
                defaultValue={dayValue(active.acceptanceDate)}
                onBlur={(e) =>
                  patch(active.id, { acceptanceDate: e.target.value ? iso(e.target.value) : null })
                }
              />
            </Field>
            {/* Spec §8 Stage 5. All three columns are new in migration 037;
                before that the Awaiting Decision stage had nothing to ask for. */}
            <Field label="Last institutional update">
              <Input
                type="date"
                className="h-8 text-xs"
                defaultValue={dayValue(active.lastInstitutionUpdateAt)}
                onBlur={(e) =>
                  patch(active.id, {
                    lastInstitutionUpdateAt: e.target.value ? iso(e.target.value) : null,
                  })
                }
              />
            </Field>
            <Field label="Expected decision">
              <Input
                type="date"
                className="h-8 text-xs"
                defaultValue={dayValue(active.expectedDecisionDate)}
                onBlur={(e) =>
                  patch(active.id, {
                    expectedDecisionDate: e.target.value ? iso(e.target.value) : null,
                  })
                }
              />
            </Field>
          </div>

          {/* Spec §8 — what the institution is waiting for. Required by the gate
              only when the status says they have actually asked for something. */}
          <Field label="Outstanding requirement">
            <Textarea
              rows={2}
              className="text-xs"
              placeholder="What is the institution waiting for?"
              defaultValue={active.outstandingRequirement ?? ""}
              onBlur={(e) =>
                e.target.value !== (active.outstandingRequirement ?? "") &&
                patch(active.id, { outstandingRequirement: e.target.value || null })
              }
            />
          </Field>

          {/* Spec §7 — the alternative to a reference number. An application
              submitted by email, or to an institution that issues no reference,
              could not previously leave this stage at all. */}
          <Field label="Evidence of submission (if no reference number)">
            <Textarea
              rows={2}
              className="text-xs"
              placeholder="Confirmation email, portal screenshot reference, who confirmed and when"
              defaultValue={active.submissionEvidence ?? ""}
              onBlur={(e) =>
                e.target.value !== (active.submissionEvidence ?? "") &&
                patch(active.id, { submissionEvidence: e.target.value || null })
              }
            />
          </Field>

          {/* Spec §9 "Conditions, where applicable" — full width, because
              conditions are prose and never fitted in a grid cell. */}
          <Field label="Offer conditions">
            <Textarea
              rows={2}
              className="text-xs"
              placeholder="Conditions attached to the offer, if any"
              defaultValue={active.offerConditions ?? ""}
              onBlur={(e) =>
                e.target.value !== (active.offerConditions ?? "") &&
                patch(active.id, { offerConditions: e.target.value || null })
              }
            />
          </Field>

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
