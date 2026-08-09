"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function NewPlanButton({ defaultIcrId }: { defaultIcrId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    icrId: defaultIcrId,
    quarter: (Math.floor(new Date().getMonth() / 3) + 1) as number,
    year: new Date().getFullYear(),
    reportingCurrency: "USD",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const resp = await fetch("/api/recruitment-planning/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      setError(j?.error ?? `HTTP ${resp.status}`);
      return;
    }
    const created = await resp.json();
    setOpen(false);
    startTransition(() => router.push(`/recruitment-planning/${created.id}`));
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
      >
        + New plan
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded p-6 w-96 space-y-3 shadow-xl"
      >
        <h2 className="font-semibold text-lg">New Quarterly Plan</h2>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <label className="block text-sm">
          Quarter
          <select
            value={form.quarter}
            onChange={(e) => setForm({ ...form, quarter: Number(e.target.value) })}
            className="border rounded px-2 py-1 text-sm w-full mt-1"
          >
            {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          Year
          <input
            type="number"
            min={2024} max={2035}
            value={form.year}
            onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
            className="border rounded px-2 py-1 text-sm w-full mt-1"
          />
        </label>
        <label className="block text-sm">
          Reporting currency
          <select
            value={form.reportingCurrency}
            onChange={(e) => setForm({ ...form, reportingCurrency: e.target.value })}
            className="border rounded px-2 py-1 text-sm w-full mt-1"
          >
            {["USD", "EUR", "GBP", "CAD", "AUD", "AED", "INR", "SGD", "MYR"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={() => setOpen(false)} className="flex-1 px-3 py-2 border rounded text-sm">Cancel</button>
          <button type="submit" disabled={pending} className="flex-1 px-3 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
            {pending ? "Creating..." : "Create draft"}
          </button>
        </div>
      </form>
    </div>
  );
}
