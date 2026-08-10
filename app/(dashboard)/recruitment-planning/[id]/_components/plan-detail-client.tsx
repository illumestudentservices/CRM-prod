"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plan = any;

const TRANSITIONS: Record<string, { to: string; label: string; role: string[] }[]> = {
  DRAFT: [{ to: "SUBMITTED", label: "Submit for review", role: ["ICR", "SUPER_ADMIN"] }],
  RETURNED: [{ to: "SUBMITTED", label: "Re-submit", role: ["ICR", "SUPER_ADMIN"] }],
  SUBMITTED: [{ to: "REGIONAL_MANAGER_REVIEW", label: "Take for RM review", role: ["REGIONAL_MANAGER", "SUPER_ADMIN"] }],
  REGIONAL_MANAGER_REVIEW: [
    { to: "ACCOUNT_MANAGER_REVIEW", label: "Send to AM review", role: ["HQ_EXECUTIVE", "SUPER_ADMIN"] },
    { to: "RETURNED", label: "Return to ICR", role: ["REGIONAL_MANAGER", "SUPER_ADMIN"] },
  ],
  ACCOUNT_MANAGER_REVIEW: [
    { to: "INTERNAL_FINAL_REVIEW", label: "Send to Internal Final", role: ["HQ_EXECUTIVE", "SUPER_ADMIN"] },
    { to: "RETURNED", label: "Return", role: ["HQ_EXECUTIVE", "SUPER_ADMIN"] },
  ],
  INTERNAL_FINAL_REVIEW: [
    { to: "APPROVED", label: "Approve", role: ["HQ_EXECUTIVE", "SUPER_ADMIN"] },
    { to: "CLIENT_REVIEW", label: "Send to Client", role: ["HQ_EXECUTIVE", "SUPER_ADMIN"] },
    { to: "RETURNED", label: "Return", role: ["HQ_EXECUTIVE", "SUPER_ADMIN"] },
  ],
  CLIENT_REVIEW: [
    { to: "APPROVED", label: "Client approved", role: ["HQ_EXECUTIVE", "SUPER_ADMIN"] },
    { to: "RETURNED", label: "Return", role: ["HQ_EXECUTIVE", "SUPER_ADMIN"] },
  ],
  APPROVED: [{ to: "COMPLETED", label: "Mark completed", role: ["REGIONAL_MANAGER", "HQ_EXECUTIVE", "SUPER_ADMIN"] }],
  ACTIVE: [{ to: "COMPLETED", label: "Mark completed", role: ["REGIONAL_MANAGER", "HQ_EXECUTIVE", "SUPER_ADMIN"] }],
  COMPLETED: [{ to: "CLOSED", label: "Close", role: ["SUPER_ADMIN"] }],
};

// Available events + institutions load server-side so the picker doesn't need
// to fetch on mount. Shape kept loose because the picker only reads name/date.
type EventOpt = { id: string; name: string; date: string; city: string; country: string; status: string };
type InstitutionOpt = { id: string; name: string };

export function PlanDetailClient({
  plan,
  currentUserId,
  currentUserRole,
  availableEvents,
  availableInstitutions,
}: {
  plan: Plan;
  currentUserId: string;
  currentUserRole: string;
  availableEvents: EventOpt[];
  availableInstitutions: InstitutionOpt[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "budget" | "travel" | "events" | "variations">("overview");

  const availableTransitions = (TRANSITIONS[plan.status] ?? []).filter(t => t.role.includes(currentUserRole));
  const canEdit = ["DRAFT", "RETURNED"].includes(plan.status) && (currentUserRole !== "ICR" || plan.icrId === currentUserId);
  const isLocked = ["APPROVED", "ACTIVE", "COMPLETED", "CLOSED"].includes(plan.status);

  async function doTransition(to: string) {
    setError(null);
    const notes = prompt(`Optional notes for the ${to.replaceAll("_", " ").toLowerCase()} step:`);
    const resp = await fetch(`/api/recruitment-planning/plans/${plan.id}/transition`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toStatus: to, notes: notes || undefined }),
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      setError(j?.error ?? `HTTP ${resp.status}`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Q{plan.quarter} {plan.year} — {plan.icr.name}</h1>
          <p className="text-sm text-muted-foreground">
            {plan.institution?.name ?? plan.market?.name ?? "General plan"} · Currency {plan.reportingCurrency} · Status <strong>{plan.status}</strong>
          </p>
        </div>
        <div className="flex gap-2">
          {availableTransitions.map(t => (
            <button
              key={t.to}
              disabled={pending}
              onClick={() => doTransition(t.to)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-sm text-red-600 dark:text-red-300 border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 rounded p-2">{error}</div>}

      {isLocked && (
        <div className="text-sm bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30 dark:text-yellow-200 rounded p-2">
          This plan is locked. To change scope or budget, submit a Variation Request from the Variations tab.
        </div>
      )}

      <nav className="flex gap-2 border-b">
        {(["overview", "budget", "travel", "events", "variations"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm ${tab === t ? "border-b-2 border-blue-600 font-medium" : ""}`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h3 className="font-medium mb-2">Approval trail</h3>
              <ul className="text-sm space-y-1">
                <li>Regional Manager: {plan.regionalManager?.name ?? "—"} {plan.regionalReviewedAt && `(${new Date(plan.regionalReviewedAt).toISOString().slice(0, 10)})`}</li>
                <li>Account Manager: {plan.accountManager?.name ?? "—"} {plan.accountReviewedAt && `(${new Date(plan.accountReviewedAt).toISOString().slice(0, 10)})`}</li>
                <li>VP Reviewer: {plan.vpReviewer?.name ?? "—"} {plan.internalFinalReviewedAt && `(${new Date(plan.internalFinalReviewedAt).toISOString().slice(0, 10)})`}</li>
                <li>Client review: {plan.clientReviewedAt ? new Date(plan.clientReviewedAt).toISOString().slice(0, 10) : "—"}</li>
                <li>Approved: {plan.approvedAt ? new Date(plan.approvedAt).toISOString().slice(0, 10) : "—"}</li>
              </ul>
            </div>
            <div>
              <h3 className="font-medium mb-2">Planned Field Activities</h3>
              {plan.plannedFieldActivities.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
              <ul className="text-sm space-y-1">
                {plan.plannedFieldActivities.map((f: {id: string; activityType: string; plannedCount: number; actualCount: number}) => (
                  <li key={f.id}>{f.activityType}: {f.plannedCount} planned / {f.actualCount} actual</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Spec §11 (Recruitment Planning) — Quarterly Reconciliation. Planned
              vs Actual variance across budget, travel, event participation
              and field activities. Uses the plan's own stored numbers; the
              nightly reconciliation cron computes actuals from Field Ops. */}
          <ReconciliationCard plan={plan} />
        </div>
      )}

      {tab === "budget" && <BudgetTab plan={plan} canEdit={canEdit} />}
      {tab === "travel" && <TravelTab plan={plan} />}
      {tab === "events" && (
        <EventsTab
          plan={plan}
          canEdit={canEdit}
          availableEvents={availableEvents}
          availableInstitutions={availableInstitutions}
        />
      )}
      {tab === "variations" && <VariationsTab plan={plan} canRequest={["APPROVED", "ACTIVE"].includes(plan.status)} canApprove={["HQ_EXECUTIVE", "SUPER_ADMIN"].includes(currentUserRole)} />}
    </div>
  );
}

/**
 * Spec §11 — Quarterly Reconciliation card. Compares planned / approved /
 * actual across the plan's line items so an RM can see variance at a glance.
 *
 * The plan doesn't store "approved" as separate figures — approval locks the
 * plan and everything Planned becomes Approved. So the display is
 * (Planned = Approved) vs Actual. Deltas flip red when over budget or short
 * on delivery, green when under budget or ahead of plan.
 */
function ReconciliationCard({ plan }: { plan: Plan }) {
  // Budget: sum planned budgetItems (as approved) vs travelItems' actualCost
  // + plannedFieldActivities' actual (we don't have a "field ops actual $"
  // column yet — so this reconciles Travel-actual against Budget-planned).
  const plannedBudget = (plan.budgetItems ?? []).reduce(
    (sum: number, b: { convertedAmount: number | null; amount: number }) =>
      sum + (b.convertedAmount ?? b.amount ?? 0),
    0
  );
  const actualTravel = (plan.plannedTravel ?? []).reduce(
    (sum: number, t: { estimatedCost: number | null }) => sum + (t.estimatedCost ?? 0),
    0
  );
  const budgetVariance = plannedBudget - actualTravel;

  // Field activity delivery
  const plannedFieldTotal = (plan.plannedFieldActivities ?? []).reduce(
    (sum: number, f: { plannedCount: number }) => sum + f.plannedCount,
    0
  );
  const actualFieldTotal = (plan.plannedFieldActivities ?? []).reduce(
    (sum: number, f: { actualCount: number }) => sum + f.actualCount,
    0
  );

  const eventsPlanned = (plan.plannedEvents ?? []).length;

  return (
    <div className="rounded border border-slate-200 dark:border-slate-800 p-4">
      <h3 className="font-medium mb-3">Quarterly Reconciliation</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Budget (converted)</p>
          <p className="text-sm">
            Planned: <strong className="tabular-nums">{plannedBudget.toFixed(0)} {plan.reportingCurrency}</strong>
          </p>
          <p className="text-sm">
            Committed travel: <strong className="tabular-nums">{actualTravel.toFixed(0)} {plan.reportingCurrency}</strong>
          </p>
          <p className={`text-xs mt-1 ${budgetVariance < 0 ? "text-red-700 dark:text-red-300" : "text-green-700 dark:text-green-300"}`}>
            {budgetVariance >= 0 ? "Under budget" : "Over budget"}: {Math.abs(budgetVariance).toFixed(0)} {plan.reportingCurrency}
          </p>
        </div>

        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Field Activities</p>
          <p className="text-sm">
            Planned: <strong className="tabular-nums">{plannedFieldTotal}</strong>
          </p>
          <p className="text-sm">
            Delivered: <strong className="tabular-nums">{actualFieldTotal}</strong>
          </p>
          <p className={`text-xs mt-1 ${actualFieldTotal >= plannedFieldTotal ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300"}`}>
            {plannedFieldTotal > 0
              ? `${Math.round((actualFieldTotal / plannedFieldTotal) * 100)}% completion`
              : "No planned activities"}
          </p>
        </div>

        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Event Participations</p>
          <p className="text-sm">
            Planned: <strong className="tabular-nums">{eventsPlanned}</strong>
          </p>
          <p className="text-xs mt-1 text-slate-500 dark:text-slate-400">
            Actual attendance is recorded on the event itself.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Spec §4B — Event Participation tab. Pick from existing Recruitment Events;
 * "Propose New Event" is a secondary CTA that opens the events form in a new
 * tab so the ICR can add the event to the network and come back.
 */
function EventsTab({
  plan,
  canEdit,
  availableEvents,
  availableInstitutions,
}: {
  plan: Plan;
  canEdit: boolean;
  availableEvents: EventOpt[];
  availableInstitutions: InstitutionOpt[];
}) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    eventId: "",
    institutionRepresentedId: "",
    purpose: "",
    estimatedCost: "",
    estimatedCurrency: plan.reportingCurrency,
    expectedLeads: "",
    expectedApplications: "",
    expectedEnrolments: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.eventId) {
      setError("Pick an event from the list, or Propose New Event.");
      return;
    }
    if (!form.institutionRepresentedId) {
      setError("Pick which institution you're representing at this event.");
      return;
    }
    const resp = await fetch(
      `/api/recruitment-planning/plans/${plan.id}/event-participations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: form.eventId,
          institutionRepresentedId: form.institutionRepresentedId,
          purpose: form.purpose || undefined,
          estimatedCost: form.estimatedCost ? Number(form.estimatedCost) : undefined,
          estimatedCurrency: form.estimatedCurrency || "USD",
          expectedLeads: form.expectedLeads ? parseInt(form.expectedLeads, 10) : undefined,
          expectedApplications: form.expectedApplications
            ? parseInt(form.expectedApplications, 10)
            : undefined,
          expectedEnrolments: form.expectedEnrolments
            ? parseInt(form.expectedEnrolments, 10)
            : undefined,
        }),
      }
    );
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      setError(j?.error ?? `HTTP ${resp.status}`);
      return;
    }
    setShowAdd(false);
    setForm({
      eventId: "",
      institutionRepresentedId: "",
      purpose: "",
      estimatedCost: "",
      estimatedCurrency: plan.reportingCurrency,
      expectedLeads: "",
      expectedApplications: "",
      expectedEnrolments: "",
    });
    router.refresh();
  }

  const entries = plan.plannedEvents ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">Event Participation</h3>
        <div className="flex gap-2">
          {/* Spec §4B — Propose New Event is a secondary CTA that navigates
              to the events form. Adds the event to the Recruitment Network
              first, then the ICR comes back to link it here. */}
          <a
            href="/events/new"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm px-3 py-1 border rounded hover:bg-muted"
          >
            Propose New Event
          </a>
          {canEdit && (
            <button
              onClick={() => setShowAdd((s) => !s)}
              className="text-sm px-3 py-1 border rounded hover:bg-muted"
            >
              {showAdd ? "Cancel" : "+ Add existing event"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-300 mb-2">{error}</p>}

      {entries.length === 0 && !showAdd && (
        <p className="text-sm text-muted-foreground">
          No events referenced yet. Pick one from the Recruitment Network to link it here.
        </p>
      )}

      {entries.length > 0 && (
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Event</th>
              <th className="text-left p-2">Location</th>
              <th className="text-left p-2">Institution Represented</th>
              <th className="text-right p-2">Est. Cost</th>
              <th className="text-right p-2">Expected Leads</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(
              (e: {
                id: string;
                event: EventOpt;
                institutionRepresented: { name: string };
                purpose: string | null;
                estimatedCost: number | null;
                estimatedCurrency: string | null;
                expectedLeads: number | null;
              }) => (
                <tr key={e.id} className="border-t dark:border-slate-800">
                  <td className="p-2">
                    <a href={`/events/${e.event.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                      {e.event.name}
                    </a>
                    <div className="text-xs text-muted-foreground">
                      {new Date(e.event.date).toISOString().slice(0, 10)}
                    </div>
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {e.event.city}, {e.event.country}
                  </td>
                  <td className="p-2">{e.institutionRepresented.name}</td>
                  <td className="p-2 text-right tabular-nums">
                    {e.estimatedCost != null
                      ? `${e.estimatedCost} ${e.estimatedCurrency ?? plan.reportingCurrency}`
                      : "—"}
                  </td>
                  <td className="p-2 text-right tabular-nums">{e.expectedLeads ?? "—"}</td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}

      {showAdd && canEdit && (
        <form onSubmit={submit} className="border rounded p-3 mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="text-xs text-slate-500 dark:text-slate-400">Event</label>
              <select
                value={form.eventId}
                onChange={(e) => setForm({ ...form, eventId: e.target.value })}
                className="border rounded px-2 py-1 text-sm w-full"
                required
              >
                <option value="">Pick a Recruitment Event…</option>
                {availableEvents.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} — {new Date(ev.date).toISOString().slice(0, 10)} · {ev.city}, {ev.country}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 dark:text-slate-400">Institution Represented</label>
              <select
                value={form.institutionRepresentedId}
                onChange={(e) => setForm({ ...form, institutionRepresentedId: e.target.value })}
                className="border rounded px-2 py-1 text-sm w-full"
                required
              >
                <option value="">Pick a client institution…</option>
                {availableInstitutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
            <input
              placeholder="Purpose"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              className="border rounded px-2 py-1 text-sm col-span-2"
            />
            <input
              type="number"
              placeholder="Est. cost"
              value={form.estimatedCost}
              onChange={(e) => setForm({ ...form, estimatedCost: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            />
            <select
              value={form.estimatedCurrency}
              onChange={(e) => setForm({ ...form, estimatedCurrency: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            >
              {["USD", "EUR", "GBP", "CAD", "AUD", "AED", "INR"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Expected leads"
              value={form.expectedLeads}
              onChange={(e) => setForm({ ...form, expectedLeads: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            />
            <input
              type="number"
              placeholder="Expected applications"
              value={form.expectedApplications}
              onChange={(e) => setForm({ ...form, expectedApplications: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            />
            <input
              type="number"
              placeholder="Expected enrolments"
              value={form.expectedEnrolments}
              onChange={(e) => setForm({ ...form, expectedEnrolments: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            />
          </div>
          <button
            type="submit"
            className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Save
          </button>
        </form>
      )}
    </div>
  );
}

function BudgetTab({ plan, canEdit }: { plan: Plan; canEdit: boolean }) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    category: "FLIGHTS",
    description: "",
    amount: 0,
    currency: plan.reportingCurrency,
    exchangeRate: 1,
    exchangeRateSource: "",
    allocation: "PLAN",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const resp = await fetch(`/api/recruitment-planning/plans/${plan.id}/budget-items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        exchangeRateDate: new Date().toISOString(),
      }),
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      setError(j?.error ?? `HTTP ${resp.status}`);
      return;
    }
    setShowAdd(false);
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">Budget items</h3>
        {canEdit && (
          <button onClick={() => setShowAdd(s => !s)} className="text-sm px-3 py-1 border rounded hover:bg-muted">
            {showAdd ? "Cancel" : "+ Add item"}
          </button>
        )}
      </div>

      {plan.budgetItems.length === 0 && !showAdd && <p className="text-sm text-muted-foreground">No budget items yet.</p>}

      {plan.budgetItems.length > 0 && (
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Category</th>
              <th className="text-left p-2">Description</th>
              <th className="text-right p-2">Amount</th>
              <th className="text-right p-2">Converted</th>
              <th className="text-left p-2">Allocation</th>
            </tr>
          </thead>
          <tbody>
            {plan.budgetItems.map((b: {id: string; category: string; description: string | null; amount: number; currency: string; convertedAmount: number | null; reportingCurrency: string | null; allocation: string}) => (
              <tr key={b.id} className="border-t dark:border-slate-800">
                <td className="p-2">{b.category}</td>
                <td className="p-2">{b.description}</td>
                <td className="p-2 text-right">{b.amount} {b.currency}</td>
                <td className="p-2 text-right">{b.convertedAmount ? `${b.convertedAmount.toFixed(0)} ${b.reportingCurrency}` : "—"}</td>
                <td className="p-2">{b.allocation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && canEdit && (
        <form onSubmit={submit} className="border rounded p-3 mt-3 space-y-2">
          {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="border rounded px-2 py-1 text-sm">
              {["FLIGHTS", "ACCOMMODATION", "LOCAL_TRANSPORT", "EVENT_REGISTRATION", "MARKETING_MATERIALS", "MEALS", "MISCELLANEOUS"].map(c => <option key={c}>{c}</option>)}
            </select>
            <select value={form.allocation} onChange={e => setForm({ ...form, allocation: e.target.value })} className="border rounded px-2 py-1 text-sm">
              {["PLAN", "SHARED_EVENT", "INSTITUTION_PARTICIPATION", "ICR_TRAVEL", "GENERAL_ACTIVITY"].map(a => <option key={a}>{a}</option>)}
            </select>
            <input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="border rounded px-2 py-1 text-sm col-span-2" />
            <input type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} className="border rounded px-2 py-1 text-sm" />
            <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} className="border rounded px-2 py-1 text-sm">
              {["USD", "EUR", "GBP", "CAD", "AUD", "AED", "INR", "SGD", "MYR"].map(c => <option key={c}>{c}</option>)}
            </select>
            <input type="number" step="0.0001" placeholder="Exchange rate" value={form.exchangeRate} onChange={e => setForm({ ...form, exchangeRate: Number(e.target.value) })} className="border rounded px-2 py-1 text-sm" />
            <input placeholder="Rate source (e.g. Bank of Baroda TT rate)" value={form.exchangeRateSource} onChange={e => setForm({ ...form, exchangeRateSource: e.target.value })} className="border rounded px-2 py-1 text-sm" />
          </div>
          <button type="submit" className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
        </form>
      )}
    </div>
  );
}

function TravelTab({ plan }: { plan: Plan }) {
  return (
    <div>
      <h3 className="font-medium mb-2">Planned Travel</h3>
      {plan.plannedTravel.length === 0 && <p className="text-sm text-muted-foreground">No planned travel yet.</p>}
      <ul className="text-sm space-y-2">
        {plan.plannedTravel.map((pt: {id: string; destination: string; country: string; plannedStart: string; plannedEnd: string; purpose: string; estimatedCost: number | null; estimatedCurrency: string | null; activatedAt: string | null}) => (
          <li key={pt.id} className="border rounded p-2">
            <div className="font-medium">{pt.destination}, {pt.country}</div>
            <div className="text-xs text-muted-foreground">
              {new Date(pt.plannedStart).toISOString().slice(0, 10)} — {new Date(pt.plannedEnd).toISOString().slice(0, 10)}
              {pt.estimatedCost && <> · {pt.estimatedCost} {pt.estimatedCurrency}</>}
              {pt.activatedAt && <> · <span className="text-green-700 dark:text-green-300">Active travel record created</span></>}
            </div>
            <div className="text-xs">{pt.purpose}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VariationsTab({ plan, canRequest, canApprove }: { plan: Plan; canRequest: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ type: "INCREASE_BUDGET", reason: "", incrementalCost: 0 });
  const [showAdd, setShowAdd] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const resp = await fetch(`/api/recruitment-planning/plans/${plan.id}/variations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
    });
    if (!resp.ok) { const j = await resp.json().catch(() => ({})); setError(j?.error ?? `HTTP ${resp.status}`); return; }
    setShowAdd(false); router.refresh();
  }

  async function decide(id: string, decision: "APPROVED" | "RETURNED") {
    const notes = prompt("Review notes:");
    const resp = await fetch(`/api/recruitment-planning/variations/${id}/approve`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, reviewNotes: notes || undefined }),
    });
    if (!resp.ok) { const j = await resp.json().catch(() => ({})); setError(j?.error ?? `HTTP ${resp.status}`); return; }
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">Variation Requests</h3>
        {canRequest && <button onClick={() => setShowAdd(s => !s)} className="text-sm px-3 py-1 border rounded hover:bg-muted">{showAdd ? "Cancel" : "+ Request variation"}</button>}
      </div>
      {error && <div className="text-sm text-red-600 dark:text-red-300 mb-2">{error}</div>}
      {plan.variationRequests.length === 0 && !showAdd && <p className="text-sm text-muted-foreground">No variations yet.</p>}
      {plan.variationRequests.length > 0 && (
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Requested by</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Reason</th>
              <th className="text-right p-2">Cost</th>
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {plan.variationRequests.map((v: {id: string; type: string; requestedBy: {name: string|null}; status: string; reason: string; incrementalCost: number | null}) => (
              <tr key={v.id} className="border-t dark:border-slate-800">
                <td className="p-2">{v.type}</td>
                <td className="p-2">{v.requestedBy.name}</td>
                <td className="p-2">{v.status}</td>
                <td className="p-2 max-w-xs truncate">{v.reason}</td>
                <td className="p-2 text-right">{v.incrementalCost ?? "—"}</td>
                <td className="p-2">
                  {v.status === "SUBMITTED" && canApprove && (
                    <div className="flex gap-1">
                      <button onClick={() => decide(v.id, "APPROVED")} className="text-xs px-2 py-1 bg-green-600 text-white rounded">Approve</button>
                      <button onClick={() => decide(v.id, "RETURNED")} className="text-xs px-2 py-1 bg-gray-500 text-white rounded">Return</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showAdd && canRequest && (
        <form onSubmit={submit} className="border rounded p-3 mt-3 space-y-2">
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="border rounded px-2 py-1 text-sm w-full">
            {["ADD_TRAVEL", "CANCEL_TRAVEL", "ADD_RECRUITMENT_EVENT", "CANCEL_RECRUITMENT_EVENT", "INCREASE_BUDGET", "DECREASE_BUDGET", "ADD_FIELD_ACTIVITY", "REMOVE_FIELD_ACTIVITY", "OTHER"].map(t => <option key={t}>{t}</option>)}
          </select>
          <textarea placeholder="Reason (required)" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="border rounded px-2 py-1 text-sm w-full" rows={3} required />
          <input type="number" placeholder="Incremental cost" value={form.incrementalCost} onChange={e => setForm({ ...form, incrementalCost: Number(e.target.value) })} className="border rounded px-2 py-1 text-sm w-full" />
          <button type="submit" className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700">Submit</button>
        </form>
      )}
    </div>
  );
}
