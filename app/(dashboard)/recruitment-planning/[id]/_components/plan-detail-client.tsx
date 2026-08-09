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

export function PlanDetailClient({ plan, currentUserId, currentUserRole }: { plan: Plan; currentUserId: string; currentUserRole: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "budget" | "travel" | "variations">("overview");

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

      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded p-2">{error}</div>}

      {isLocked && (
        <div className="text-sm bg-yellow-50 border border-yellow-200 rounded p-2">
          This plan is locked. To change scope or budget, submit a Variation Request from the Variations tab.
        </div>
      )}

      <nav className="flex gap-2 border-b">
        {(["overview", "budget", "travel", "variations"] as const).map(t => (
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
      )}

      {tab === "budget" && <BudgetTab plan={plan} canEdit={canEdit} />}
      {tab === "travel" && <TravelTab plan={plan} />}
      {tab === "variations" && <VariationsTab plan={plan} canRequest={["APPROVED", "ACTIVE"].includes(plan.status)} canApprove={["HQ_EXECUTIVE", "SUPER_ADMIN"].includes(currentUserRole)} />}
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
              <tr key={b.id} className="border-t">
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
          {error && <p className="text-sm text-red-600">{error}</p>}
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
              {pt.activatedAt && <> · <span className="text-green-700">Active travel record created</span></>}
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
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
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
              <tr key={v.id} className="border-t">
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
