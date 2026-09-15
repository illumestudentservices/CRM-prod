"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { focusFieldWhenReady } from "@/lib/lead-focus";
import { cn } from "@/lib/utils";
import { ELIGIBILITY_OUTCOMES } from "@/lib/lead-options";
import {
  SUBMISSION_METHOD_OPTIONS,
  OFFER_TYPE_OPTIONS,
  STUDENT_DECISION_OPTIONS,
  DEPOSIT_STATUS_OPTIONS,
  ACCEPTANCE_STATUS_OPTIONS,
  APPLICATION_STATUS_OPTIONS,
} from "@/lib/application-options";

/**
 * The stage-gate fields that do NOT live on the student, surfaced on the edit
 * form so everything a gate can ask for is reachable from one screen.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Walking a student from New Lead to Enrolled by hand meant moving between
 * three places: the edit form for the student's own fields, the journey panel
 * for the eligibility outcome, and the application panel for sixteen more. Each
 * is findable on its own; together they are a hunt, and the blocker list names
 * the field without saying where it is.
 *
 * ── WHY IT IS NOT ALWAYS SHOWN ──────────────────────────────────────────────
 *
 * These fields belong to OTHER records. The eligibility outcome is a property
 * of a journey, and a student may have several — one box on a form about the
 * student cannot honestly answer for three of them. The same applies, less
 * sharply, to applications. So the section appears only when there is exactly
 * one of each and there is therefore no ambiguity about what is being edited;
 * otherwise it says where to go instead of guessing.
 *
 * ── WHY IT SAVES ON CHANGE ──────────────────────────────────────────────────
 *
 * Each control writes to its own record through its own endpoint, so folding
 * them into the form's Save would mean up to three requests with no way to roll
 * back if the second failed — a half-saved form that reports success. Saving
 * each field as it changes matches the application panel, which already
 * behaves this way, and the section says so plainly rather than leaving people
 * to wonder whether Save covered it.
 */

interface ApplicationRow {
  id: string;
  applicationNumber: string | null;
  submissionEvidence: string | null;
  submissionDate: string | null;
  submissionMethod: string | null;
  status: string | null;
  lastInstitutionUpdateAt: string | null;
  expectedDecisionDate: string | null;
  outstandingRequirement: string | null;
  offerType: string | null;
  offerReceivedAt: string | null;
  studentDecision: string | null;
  depositStatus: string | null;
  depositDate: string | null;
  depositDeadline: string | null;
  acceptanceStatus: string | null;
  acceptanceDate: string | null;
}

interface InterestRow {
  id: string;
  institution?: { name: string } | null;
  eligibilityOutcome: string | null;
}

/** A date column rendered into the `YYYY-MM-DD` a date input needs. */
const dayValue = (v: string | null) => (v ? v.slice(0, 10) : "");
/** ...and back to the ISO datetime the API expects. Empty clears the column. */
const toIso = (v: string) => (v ? new Date(`${v}T00:00:00.000Z`).toISOString() : null);

function Field({
  label,
  name,
  children,
}: {
  label: string;
  /** The gate's field key — see the note on `FormField` in lead-form.tsx. */
  name?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5" data-field={name}>
      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</Label>
      {children}
    </div>
  );
}

function Choice({
  value,
  options,
  onChange,
  placeholder = "Not recorded",
}: {
  value: string | null;
  options: readonly { value: string; label: string }[];
  onChange: (v: string | null) => void;
  placeholder?: string;
}) {
  // A native select, matching the rest of this form. "" is the cleared state —
  // never a real option value, which is what Radix reserves it for too.
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function PipelineProgressFields({
  leadId,
  focusField,
}: {
  leadId: string;
  /**
   * A field in here that the user was sent to from a stage requirement.
   *
   * Its presence is what opens the section: arriving with it still collapsed
   * would mean the click landed the user on a form where the field they asked
   * for is not rendered at all, which is worse than not moving them.
   */
  focusField?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(!!focusField);
  const [loading, setLoading] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [apps, setApps] = React.useState<ApplicationRow[]>([]);
  const [interests, setInterests] = React.useState<InterestRow[]>([]);
  const [saving, setSaving] = React.useState<string | null>(null);

  // Fetched only when the section is opened. It is collapsed by default, and
  // most edits never touch it, so two requests on every Edit click would be
  // paid by everybody to serve a few.
  React.useEffect(() => {
    if (!open || loaded) return;
    setLoading(true);
    (async () => {
      try {
        const [a, i] = await Promise.all([
          fetch(`/api/leads/${leadId}/applications`).then((r) => (r.ok ? r.json() : null)),
          fetch(`/api/institution-interests?leadId=${leadId}&onlyOpen=true`).then((r) =>
            r.ok ? r.json() : null
          ),
        ]);
        setApps((a?.applications ?? a?.data ?? []).filter((x: ApplicationRow & { isActive?: boolean }) =>
          x.isActive === undefined ? true : x.isActive));
        setInterests(i?.data ?? i?.interests ?? []);
        setLoaded(true);
      } catch {
        toast({ title: "Could not load the pipeline fields", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [open, loaded, leadId, toast]);

  /**
   * Deliberately waits for `loaded`.
   *
   * The controls are rendered from the fetched application and interest, so
   * before that resolves there is nothing for the lookup to find. Keying the
   * effect on `loaded` rather than letting `focusFieldWhenReady` poll through
   * the whole request means a slow response cannot exhaust its timeout and
   * leave the section open at the top with no indication of where to look.
   */
  React.useEffect(() => {
    if (!focusField || !loaded) return;
    return focusFieldWhenReady(focusField);
  }, [focusField, loaded]);

  async function saveApp(field: string, value: unknown) {
    const app = apps[0];
    if (!app) return;
    setSaving(field);
    setApps(([first, ...rest]) => [{ ...first, [field]: value as never }, ...rest]);
    const res = await fetch(`/api/leads/${leadId}/applications`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: app.id, [field]: value }),
    });
    setSaving(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast({ title: d.error ?? "Could not save", variant: "destructive" });
      setLoaded(false); // force a reload so the screen stops showing a value that was refused
    }
  }

  async function saveInterest(field: string, value: unknown) {
    const interest = interests[0];
    if (!interest) return;
    setSaving(field);
    setInterests(([first, ...rest]) => [{ ...first, [field]: value as never }, ...rest]);
    const res = await fetch(`/api/institution-interests/${interest.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    setSaving(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast({ title: d.error ?? "Could not save", variant: "destructive" });
      setLoaded(false);
    }
  }

  const app = apps[0];
  const interest = interests[0];

  return (
    <div className="pt-4 mt-2 border-t border-slate-200 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Pipeline progress
        <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">
          — what the stage gates ask for
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-5">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            These belong to the journey and the application rather than to the student, so
            they <strong>save as soon as you change them</strong> — the Save button below
            covers the rest of the form.
          </p>

          {loading && (
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </p>
          )}

          {!loading && loaded && (
            <>
              {/* ── The journey ─────────────────────────────────────────── */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Journey</p>
                {interests.length === 0 ? (
                  <p className="text-xs rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    No institution journey yet. The Qualified stage needs at least one — add it
                    from <strong>Institution Interests</strong> on the student&apos;s page.
                  </p>
                ) : interests.length > 1 ? (
                  <p className="text-xs rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    {/* `{" "}` because JSX drops the whitespace between an
                        expression and a following line, which rendered this as
                        "has 2open journeys". */}
                    This student has {interests.length}{" "}
                    open journeys, and the eligibility outcome belongs to each one separately —
                    edit them on the student&apos;s page, under Institution Interests.
                  </p>
                ) : (
                  <Field name="eligibilityOutcome" label={`Eligibility outcome — ${interest?.institution?.name ?? "journey"}`}>
                    <Choice
                      value={interest?.eligibilityOutcome ?? null}
                      options={ELIGIBILITY_OUTCOMES}
                      placeholder="Not assessed"
                      onChange={(v) => saveInterest("eligibilityOutcome", v)}
                    />
                  </Field>
                )}
              </div>

              {/* ── The application ─────────────────────────────────────── */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Application</p>
                {!app ? (
                  <p className="text-xs rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    No application recorded yet. Everything from Application Submitted onwards
                    needs one — add it with <strong>Record application</strong> on the
                    student&apos;s page.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field name="applicationNumber" label="Application number">
                      <Input
                        defaultValue={app.applicationNumber ?? ""}
                        placeholder="Reference from the institution"
                        onBlur={(e) =>
                          e.target.value !== (app.applicationNumber ?? "") &&
                          saveApp("applicationNumber", e.target.value || null)
                        }
                      />
                    </Field>
                    <Field name="submissionEvidence" label="Evidence of submission">
                      <Input
                        defaultValue={app.submissionEvidence ?? ""}
                        placeholder="Used when there is no reference number"
                        onBlur={(e) =>
                          e.target.value !== (app.submissionEvidence ?? "") &&
                          saveApp("submissionEvidence", e.target.value || null)
                        }
                      />
                    </Field>
                    <Field name="submissionDate" label="Submitted on">
                      <Input
                        type="date"
                        defaultValue={dayValue(app.submissionDate)}
                        onChange={(e) => saveApp("submissionDate", toIso(e.target.value))}
                      />
                    </Field>
                    <Field name="submissionMethod" label="Submission method">
                      <Choice
                        value={app.submissionMethod}
                        options={SUBMISSION_METHOD_OPTIONS}
                        onChange={(v) => saveApp("submissionMethod", v)}
                      />
                    </Field>
                    <Field name="status" label="Application status">
                      <Choice
                        value={app.status}
                        options={APPLICATION_STATUS_OPTIONS}
                        onChange={(v) => saveApp("status", v)}
                      />
                    </Field>
                    <Field name="lastInstitutionUpdateAt" label="Last institutional update">
                      <Input
                        type="date"
                        defaultValue={dayValue(app.lastInstitutionUpdateAt)}
                        onChange={(e) => saveApp("lastInstitutionUpdateAt", toIso(e.target.value))}
                      />
                    </Field>
                    <Field name="expectedDecisionDate" label="Expected decision date">
                      <Input
                        type="date"
                        defaultValue={dayValue(app.expectedDecisionDate)}
                        onChange={(e) => saveApp("expectedDecisionDate", toIso(e.target.value))}
                      />
                    </Field>
                    <Field name="outstandingRequirement" label="Outstanding requirement">
                      <Input
                        defaultValue={app.outstandingRequirement ?? ""}
                        placeholder="What the institution is still waiting for"
                        onBlur={(e) =>
                          e.target.value !== (app.outstandingRequirement ?? "") &&
                          saveApp("outstandingRequirement", e.target.value || null)
                        }
                      />
                    </Field>
                    <Field name="offerType" label="Offer type">
                      <Choice
                        value={app.offerType}
                        options={OFFER_TYPE_OPTIONS}
                        onChange={(v) => saveApp("offerType", v)}
                      />
                    </Field>
                    <Field name="offerReceivedAt" label="Offer received on">
                      <Input
                        type="date"
                        defaultValue={dayValue(app.offerReceivedAt)}
                        onChange={(e) => saveApp("offerReceivedAt", toIso(e.target.value))}
                      />
                    </Field>
                    <Field name="studentDecision" label="Student decision">
                      <Choice
                        value={app.studentDecision}
                        options={STUDENT_DECISION_OPTIONS}
                        onChange={(v) => saveApp("studentDecision", v)}
                      />
                    </Field>
                    <Field name="depositStatus" label="Deposit status">
                      <Choice
                        value={app.depositStatus}
                        options={DEPOSIT_STATUS_OPTIONS}
                        onChange={(v) => saveApp("depositStatus", v)}
                      />
                    </Field>
                    <Field name="depositDate" label="Deposit paid on">
                      <Input
                        type="date"
                        defaultValue={dayValue(app.depositDate)}
                        onChange={(e) => saveApp("depositDate", toIso(e.target.value))}
                      />
                    </Field>
                    <Field name="depositDeadline" label="Deposit deadline">
                      <Input
                        type="date"
                        defaultValue={dayValue(app.depositDeadline)}
                        onChange={(e) => saveApp("depositDeadline", toIso(e.target.value))}
                      />
                    </Field>
                    <Field name="acceptanceStatus" label="Acceptance status">
                      <Choice
                        value={app.acceptanceStatus}
                        options={ACCEPTANCE_STATUS_OPTIONS}
                        onChange={(v) => saveApp("acceptanceStatus", v)}
                      />
                    </Field>
                    <Field name="acceptanceDate" label="Acceptance date">
                      <Input
                        type="date"
                        defaultValue={dayValue(app.acceptanceDate)}
                        onChange={(e) => saveApp("acceptanceDate", toIso(e.target.value))}
                      />
                    </Field>
                  </div>
                )}
              </div>

              {saving && (
                <p className={cn("text-xs text-slate-400 flex items-center gap-1.5")}>
                  <Loader2 className="h-3 w-3 animate-spin" /> Saving {saving}…
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
