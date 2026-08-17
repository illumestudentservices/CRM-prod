"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * The Transition Report body: fifteen sections, each showing the live CRM
 * context beside the outgoing ICR's commentary.
 *
 * Spec §3 — "Retrieve existing CRM information → Present it within the
 * Transition Report → Ask the outgoing ICR to comment" — is the whole layout.
 * The panel on the right of each section is read-only and comes from the owning
 * module; the box on the left is the only thing this module stores.
 *
 * Only types and plain constants are imported from lib; nothing here reaches
 * the database, which would drag `pg` into the browser bundle and break the
 * build.
 */

interface Section {
  key: string;
  title: string;
  spec: number;
  required: boolean;
  narrative: string | null;
  completedAt: string | null;
}

interface Ctx {
  source: "live" | "snapshot";
  capturedAt?: string | null;
  counts?: {
    activeInterests: number;
    stillOwnedByOutgoing?: number;
    openTasks: number;
    openRisks: number;
  };
  pipeline?: Array<{ id: string; stage: string; assignedICRId: string | null; lead: { firstName: string; lastName: string } }>;
  tasks?: Array<{ id: string; title: string; priority: string; status: string }>;
  risks?: Array<{ id: string; title: string; impact: number }>;
}

interface Payload {
  id: string;
  status: string;
  declarationConfirmedAt: string | null;
  sections: Section[];
  context: Ctx;
  permissions: { canEdit: boolean; canReview: boolean; locked: boolean };
  readiness: { ok: boolean; errors: string[]; warnings: string[] };
  events: Array<{ id: string; toStatus: string; comments: string | null; createdAt: string; actedBy: { name: string | null } }>;
}

export function ReportEditor({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [data, setData] = React.useState<Payload | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [reasons, setReasons] = React.useState<string[]>([]);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/transition-reports/${reportId}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setData(json.data);
      setDrafts(
        Object.fromEntries(json.data.sections.map((s: Section) => [s.key, s.narrative ?? ""]))
      );
      setLoadError(null);
    } catch {
      // An empty report body would read as "nothing to hand over", which is the
      // opposite of the truth when the fetch simply failed.
      setLoadError("Could not load this report.");
    }
  }, [reportId]);

  React.useEffect(() => { void load(); }, [load]);

  async function saveSection(key: string, completed?: boolean) {
    setSavingKey(key);
    setActionError(null);
    try {
      const res = await fetch(`/api/transition-reports/${reportId}/sections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: key, narrative: drafts[key] ?? "", ...(completed !== undefined && { completed }) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) setActionError(json?.error ?? `Could not save (${res.status}).`);
      else await load();
    } finally {
      setSavingKey(null);
    }
  }

  async function post(path: string, body: unknown) {
    setBusy(true);
    setActionError(null);
    setReasons([]);
    try {
      const res = await fetch(`/api/transition-reports/${reportId}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(json?.error ?? `Failed (${res.status}).`);
        setReasons(json?.reasons ?? []);
      } else {
        await load();
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <p className="rounded-lg border border-red-200 dark:border-red-900 p-4 text-sm text-red-700 dark:text-red-300">
        {loadError}{" "}
        <button onClick={() => void load()} className="underline">Try again</button>
      </p>
    );
  }
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;

  const done = data.sections.filter((s) => s.completedAt).length;
  const { canEdit, canReview, locked } = data.permissions;
  const c = data.context.counts;

  return (
    <div className="space-y-5">
      {/* Handover position — the numbers that decide whether this can close. */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="font-medium">{done}/15 sections complete</span>
          {c && (
            <>
              <span className={c.stillOwnedByOutgoing ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
                {c.stillOwnedByOutgoing ?? 0} student(s) still assigned to the outgoing ICR
              </span>
              <span>{c.openTasks} open task(s)</span>
              <span>{c.openRisks} open risk(s)</span>
            </>
          )}
          <span className="ml-auto rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs">
            {data.context.source === "snapshot"
              ? `Frozen at handover${data.context.capturedAt ? ` · ${new Date(data.context.capturedAt).toLocaleDateString()}` : ""}`
              : "Live CRM data"}
          </span>
        </div>
        {data.context.source === "snapshot" && (
          <p className="mt-2 text-xs text-slate-500">
            This report is final. The figures below are as they stood on the handover date, not as they are now.
          </p>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">{actionError}</p>
          {reasons.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-red-700 dark:text-red-300">
              {reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Sections */}
      <div className="space-y-4">
        {data.sections.map((s) => (
          <section key={s.key} className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="font-medium text-slate-900 dark:text-slate-100">{s.title}</h3>
              {s.required && !s.completedAt && (
                <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">
                  required
                </span>
              )}
              {s.completedAt && (
                <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-800 dark:text-emerald-200">
                  complete
                </span>
              )}
            </div>

            <SectionContext sectionKey={s.key} ctx={data.context} />

            <textarea
              value={drafts[s.key] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
              disabled={!canEdit}
              rows={4}
              placeholder={canEdit ? "Your handover notes for this section…" : "No notes recorded."}
              className="mt-2 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-transparent p-2 text-sm disabled:opacity-70"
            />

            {canEdit && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" disabled={savingKey === s.key}
                  onClick={() => void saveSection(s.key)}>
                  {savingKey === s.key ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" disabled={savingKey === s.key || !(drafts[s.key] ?? "").trim()}
                  onClick={() => void saveSection(s.key, !s.completedAt)}>
                  {s.completedAt ? "Mark incomplete" : "Save & mark complete"}
                </Button>
              </div>
            )}
          </section>
        ))}
      </div>

      {/* Declaration + workflow */}
      {!locked && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
          {canEdit && (
            <div className="flex items-center gap-3">
              <input
                id="decl"
                type="checkbox"
                checked={!!data.declarationConfirmedAt}
                disabled={busy}
                onChange={(e) => void post("/declaration", { confirmed: e.target.checked })}
              />
              <label htmlFor="decl" className="text-sm">
                I confirm this handover report is complete and accurate.
              </label>
            </div>
          )}

          {!data.readiness.ok && data.readiness.errors.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Still outstanding:
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm text-slate-500 dark:text-slate-400">
                {data.readiness.errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {canEdit && (data.status === "ASSIGNED" || data.status === "IN_PROGRESS") && (
              <Button disabled={busy || !data.readiness.ok}
                onClick={() => void post("/status", { to: "SUBMITTED_TO_RM" })}>
                Submit to Regional Manager
              </Button>
            )}
            {canEdit && data.status === "AMENDMENTS_REQUIRED" && (
              <Button disabled={busy || !data.readiness.ok}
                onClick={() => void post("/status", { to: "RESUBMITTED" })}>
                Resubmit
              </Button>
            )}
            {canReview && (data.status === "SUBMITTED_TO_RM" || data.status === "RESUBMITTED") && (
              <>
                <Button variant="outline" disabled={busy}
                  onClick={() => {
                    const why = window.prompt("What needs to change?");
                    if (why?.trim()) void post("/status", { to: "AMENDMENTS_REQUIRED", comments: why });
                  }}>
                  Return for amendments
                </Button>
                <Button disabled={busy} onClick={() => void post("/status", { to: "ACCEPTED_BY_RM" })}>
                  Accept
                </Button>
              </>
            )}
            {canReview && data.status === "ACCEPTED_BY_RM" && (
              <Button disabled={busy} onClick={() => void post("/status", { to: "FINAL" })}>
                Finalise handover
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Spec §5: full workflow history retained. */}
      <details className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Workflow history ({data.events.length})
        </summary>
        <ul className="mt-3 space-y-2 text-sm">
          {data.events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-3 text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-800 dark:text-slate-200">{e.toStatus}</span>
              <span>{e.actedBy?.name ?? "—"}</span>
              <span>{new Date(e.createdAt).toLocaleString()}</span>
              {e.comments && <span className="w-full text-slate-500">“{e.comments}”</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * The CRM read-out shown above the narrative box, chosen per section.
 *
 * Only the sections that have a natural CRM source get one. Inventing a panel
 * for every section would push the ICR to describe what is already on screen,
 * which is the duplication spec §3 warns against.
 */
function SectionContext({ sectionKey, ctx }: { sectionKey: string; ctx: Ctx }) {
  const box = "rounded-md bg-slate-50 dark:bg-slate-800/50 p-3 text-sm";

  if (sectionKey === "ACTIVE_STUDENT_PIPELINE" && ctx.pipeline) {
    if (ctx.pipeline.length === 0) {
      return <p className={box}>No active students for this institution.</p>;
    }
    return (
      <div className={box}>
        <p className="mb-1 font-medium">{ctx.pipeline.length} active student(s)</p>
        <ul className="space-y-0.5 text-slate-600 dark:text-slate-400">
          {ctx.pipeline.slice(0, 8).map((p) => (
            <li key={p.id}>
              {p.lead.firstName} {p.lead.lastName} — {p.stage.replaceAll("_", " ").toLowerCase()}
            </li>
          ))}
          {ctx.pipeline.length > 8 && <li>…and {ctx.pipeline.length - 8} more</li>}
        </ul>
      </div>
    );
  }

  if (sectionKey === "OUTSTANDING_TASKS_COMMITMENTS" && ctx.tasks) {
    if (ctx.tasks.length === 0) return <p className={box}>No open tasks.</p>;
    return (
      <div className={box}>
        <p className="mb-1 font-medium">{ctx.tasks.length} open task(s)</p>
        <ul className="space-y-0.5 text-slate-600 dark:text-slate-400">
          {ctx.tasks.slice(0, 6).map((t) => (
            <li key={t.id}>{t.title} — {t.priority.toLowerCase()}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (sectionKey === "OUTSTANDING_ISSUES_RISKS" && ctx.risks) {
    if (ctx.risks.length === 0) return <p className={box}>No open risks.</p>;
    return (
      <div className={box}>
        <p className="mb-1 font-medium">{ctx.risks.length} open risk(s)</p>
        <ul className="space-y-0.5 text-slate-600 dark:text-slate-400">
          {ctx.risks.slice(0, 6).map((r) => (
            <li key={r.id}>{r.title} — impact {r.impact}</li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}
