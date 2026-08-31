"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
import { ELIGIBILITY_OUTCOMES, ENROLMENT_STATUSES } from "@/lib/lead-options";

interface Interest {
  id: string;
  institutionId: string;
  institution: { id: string; name: string; country: string };
  program: string | null;
  intakeYear: number;
  intakeMonth: number;
  studyLevel: string;
  stage: string;
  eligibilityOutcome: string | null;
  /** Spec §11 — recorded once the journey reaches Enrolled. */
  enrolmentStatus: string | null;
  assignedICRId: string | null;
  assignedICR: { id: string; name: string | null } | null;
  closedAt: string | null;
  lostReason: string | null;
}

interface InstitutionOption { id: string; name: string; country: string }
interface UserOption { id: string; name: string | null }

const STAGE_LABELS: Record<string, string> = {
  NEW_LEAD: "New Lead", CONTACTED: "Contacted", QUALIFIED: "Qualified",
  APPLICATION_SUBMITTED: "Application Submitted", AWAITING_DECISION: "Awaiting Decision",
  OFFER_RECEIVED: "Offer Received", DEPOSIT_PAID: "Deposit Paid", ENROLLED: "Enrolled",
  LOST: "Lost", DEFERRED: "Deferred", APPLICATION_REJECTED: "Application Rejected",
};

export function InstitutionInterestsPanel({
  leadId, institutions, icrUsers, defaultStudyLevel, defaultIntakeYear, defaultIntakeMonth,
}: {
  leadId: string;
  institutions: InstitutionOption[];
  icrUsers: UserOption[];
  defaultStudyLevel: string;
  defaultIntakeYear: number;
  defaultIntakeMonth: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [interests, setInterests] = useState<Interest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    institutionId: institutions[0]?.id ?? "",
    program: "",
    intakeYear: defaultIntakeYear,
    intakeMonth: defaultIntakeMonth,
    studyLevel: defaultStudyLevel,
    assignedICRId: "",
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const r = await fetch(`/api/institution-interests?leadId=${leadId}&onlyOpen=false`);
      if (r.ok) {
        const j = await r.json();
        if (mounted) setInterests(j.data);
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [leadId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.institutionId) { setError("Institution is required."); return; }
    const resp = await fetch("/api/institution-interests", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadId, ...form }),
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      setError(j?.error ?? `HTTP ${resp.status}`);
      return;
    }
    const created = await resp.json();
    setInterests(prev => [{
      ...created,
      institution: institutions.find(i => i.id === created.institutionId) ?? { id: created.institutionId, name: "?", country: "?" },
      assignedICR: null,
      eligibilityOutcome: null,
      enrolmentStatus: null,
      closedAt: null,
      lostReason: null,
    }, ...prev]);
    setShowAdd(false);
    startTransition(() => router.refresh());
  }

  async function closeInterest(id: string) {
    const outcome = prompt("Outcome? Type LOST, DEFERRED, or APPLICATION_REJECTED:");
    if (!outcome) return;
    const body: Record<string, unknown> = { outcome };
    if (outcome === "LOST") body.lostReason = prompt("Lost reason (NO_RESPONSE / FINANCIAL / COMPETITOR / ACADEMIC / VISA / PERSONAL / OTHER):") ?? "OTHER";
    if (outcome === "DEFERRED") {
      body.deferredIntakeYear = Number(prompt("Deferred intake year:") ?? "0");
      body.deferredIntakeMonth = Number(prompt("Deferred intake month (1-12):") ?? "0");
    }
    const resp = await fetch(`/api/institution-interests/${id}/close`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      alert(j?.error ?? `HTTP ${resp.status}`);
      return;
    }
    startTransition(() => router.refresh());
    // refresh local list
    const r = await fetch(`/api/institution-interests?leadId=${leadId}&onlyOpen=false`);
    if (r.ok) setInterests((await r.json()).data);
  }

  /**
   * Saves one field on an interest and reflects it locally.
   *
   * The route treats "" as "no change", so clearing a value is deliberately not
   * offered — an eligibility assessment is not something you un-record.
   */
  async function patchInterest(id: string, patch: Record<string, unknown>) {
    const resp = await fetch(`/api/institution-interests/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      alert(j?.error ?? `HTTP ${resp.status}`);
      return;
    }
    setInterests(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));
    startTransition(() => router.refresh());
  }

  async function reopen(id: string) {
    const resp = await fetch(`/api/institution-interests/${id}/reopen`, { method: "POST" });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      alert(j?.error ?? `HTTP ${resp.status}`);
      return;
    }
    startTransition(() => router.refresh());
    const r = await fetch(`/api/institution-interests?leadId=${leadId}&onlyOpen=false`);
    if (r.ok) setInterests((await r.json()).data);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{interests.length} institution journeys for this student</div>
        </div>
        <button onClick={() => setShowAdd(s => !s)} className="text-sm px-3 py-1 border rounded hover:bg-muted">
          {showAdd ? "Cancel" : "+ Add interest"}
        </button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!loading && interests.length === 0 && !showAdd && (
        <p className="text-sm text-muted-foreground">No institution interests yet — add one to start tracking a recruitment journey.</p>
      )}

      {interests.map(i => (
        <div key={i.id} className={`border rounded p-3 text-sm ${i.closedAt ? "opacity-70" : ""}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">
                {i.institution.name}
                {i.program && <span className="text-muted-foreground"> · {i.program}</span>}
                <span className="ml-2 text-xs px-2 py-0.5 bg-muted rounded">{STAGE_LABELS[i.stage] ?? i.stage}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Intake {i.intakeMonth}/{i.intakeYear} · {i.studyLevel}
                {i.assignedICR?.name && <> · ICR {i.assignedICR.name}</>}
                {i.eligibilityOutcome && <> · {i.eligibilityOutcome.replace(/_/g, " ")}</>}
                {i.closedAt && <> · Closed {new Date(i.closedAt).toISOString().slice(0, 10)}{i.lostReason ? ` (${i.lostReason})` : ""}</>}
              </div>
            </div>
            <div className="flex gap-1">
              {!i.closedAt && (
                <button onClick={() => closeInterest(i.id)} className="text-xs px-2 py-1 border rounded hover:bg-muted">Close</button>
              )}
              {i.closedAt && (
                <button onClick={() => reopen(i.id)} className="text-xs px-2 py-1 border rounded hover:bg-muted">Reopen</button>
              )}
            </div>
          </div>

          {/* Spec §6 and §11. Both columns existed and neither had any control:
              the eligibility outcome was rendered above but could not be set,
              which made Stage 3's assessment — the whole point of Qualified —
              unrecordable, and the enrolment status was written by nothing at
              all. Progression past Qualified now turns on the first of these. */}
          {!i.closedAt && (
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs">
                <span className="block text-muted-foreground mb-0.5">Eligibility outcome</span>
                <select
                  value={i.eligibilityOutcome ?? ""}
                  onChange={e => patchInterest(i.id, { eligibilityOutcome: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
                >
                  <option value="">Not assessed</option>
                  {ELIGIBILITY_OUTCOMES.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              {i.stage === "ENROLLED" && (
                <label className="text-xs">
                  <span className="block text-muted-foreground mb-0.5">Enrolment status</span>
                  <select
                    value={i.enrolmentStatus ?? ""}
                    onChange={e => patchInterest(i.id, { enrolmentStatus: e.target.value })}
                    className="w-full border rounded px-2 py-1 text-sm bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
                  >
                    <option value="">Not recorded</option>
                    {ENROLMENT_STATUSES.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          {/* Per-interest attachments — LOR for this institution, offer letter, etc. */}
          <div className="mt-2">
            <AttachmentsPanel parentType="INSTITUTION_INTEREST" parentId={i.id} compact readOnly={!!i.closedAt} />
          </div>
        </div>
      ))}

      {showAdd && (
        <form onSubmit={submit} className="border rounded p-3 space-y-2 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/30">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <select value={form.institutionId} onChange={e => setForm({ ...form, institutionId: e.target.value })} className="border rounded px-2 py-1 text-sm bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200">
              <option value="">Select institution</option>
              {institutions.map(i => <option key={i.id} value={i.id}>{i.name} ({i.country})</option>)}
            </select>
            <input placeholder="Programme" value={form.program} onChange={e => setForm({ ...form, program: e.target.value })} className="border rounded px-2 py-1 text-sm bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200" />
            <input type="number" placeholder="Intake year" min={2020} max={2035} value={form.intakeYear} onChange={e => setForm({ ...form, intakeYear: Number(e.target.value) })} className="border rounded px-2 py-1 text-sm bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200" />
            <input type="number" placeholder="Intake month" min={1} max={12} value={form.intakeMonth} onChange={e => setForm({ ...form, intakeMonth: Number(e.target.value) })} className="border rounded px-2 py-1 text-sm bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200" />
            <select value={form.studyLevel} onChange={e => setForm({ ...form, studyLevel: e.target.value })} className="border rounded px-2 py-1 text-sm bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200">
              {["UNDERGRADUATE", "POSTGRADUATE", "PATHWAY", "FOUNDATION"].map(s => <option key={s}>{s}</option>)}
            </select>
            <select value={form.assignedICRId} onChange={e => setForm({ ...form, assignedICRId: e.target.value })} className="border rounded px-2 py-1 text-sm bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200">
              <option value="">Assign ICR (optional)</option>
              {icrUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={pending} className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {pending ? "Creating..." : "Create interest"}
          </button>
        </form>
      )}
    </div>
  );
}
