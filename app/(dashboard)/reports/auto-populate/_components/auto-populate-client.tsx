"use client";

import { useState } from "react";

interface Option { id: string; name: string | null }

interface Payload {
  icrId: string;
  institutionId?: string;
  reportingMonth: number;
  reportingYear: number;
  recruitment: { uniqueStudents: number; institutionInterests: number; applications: number };
  pipelineByStage: Record<string, number>;
  serviceDelivery: {
    activitiesPlanned: number;
    activitiesCompleted: number;
    activitiesOverdue: number;
    completionRate: number;
    schoolVisits: number;
    agentMeetings: number;
    events: number;
  };
  weeklyActivities: Array<{ id: string; type: string; target: number; completed: number; weekOfMonth: number }>;
}

export function AutoPopulateClient({ icrs, institutions, selfId }: { icrs: Option[]; institutions: Option[]; selfId: string }) {
  const now = new Date();
  const [form, setForm] = useState({
    icrId: selfId,
    institutionId: "",
    reportingMonth: now.getMonth() + 1,
    reportingYear: now.getFullYear(),
  });
  const [data, setData] = useState<Payload | null>(null);
  const [narrative, setNarrative] = useState({ outcomes: "", challenges: "", observations: "", opportunities: "", support: "", priorities: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null); setLoading(true);
    try {
      const resp = await fetch("/api/reports/auto-populate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, institutionId: form.institutionId || undefined }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        setError(j?.error ?? `HTTP ${resp.status}`);
        setData(null);
      } else {
        setData(await resp.json());
      }
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <div className="border rounded p-4 grid grid-cols-4 gap-3 items-end">
        <label className="text-sm">
          ICR
          <select value={form.icrId} onChange={e => setForm({ ...form, icrId: e.target.value })} className="border rounded px-2 py-1 text-sm w-full mt-1">
            {icrs.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Institution (optional)
          <select value={form.institutionId} onChange={e => setForm({ ...form, institutionId: e.target.value })} className="border rounded px-2 py-1 text-sm w-full mt-1">
            <option value="">All institutions</option>
            {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Month
          <input type="number" min={1} max={12} value={form.reportingMonth} onChange={e => setForm({ ...form, reportingMonth: Number(e.target.value) })} className="border rounded px-2 py-1 text-sm w-full mt-1" />
        </label>
        <label className="text-sm">
          Year
          <input type="number" min={2020} max={2035} value={form.reportingYear} onChange={e => setForm({ ...form, reportingYear: Number(e.target.value) })} className="border rounded px-2 py-1 text-sm w-full mt-1" />
        </label>
        <button onClick={generate} disabled={loading} className="col-span-4 sm:col-span-1 px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
          {loading ? "Generating…" : "Generate report"}
        </button>
      </div>

      {error && <div className="text-sm text-red-600 border border-red-200 rounded p-2 bg-red-50">{error}</div>}

      {data && (
        <div className="space-y-4">
          <section className="border rounded p-4">
            <h2 className="font-semibold text-sm mb-2">Recruitment counts (spec §21)</h2>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Metric label="Unique students" value={data.recruitment.uniqueStudents} />
              <Metric label="Institution interests" value={data.recruitment.institutionInterests} />
              <Metric label="Applications" value={data.recruitment.applications} />
            </div>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-semibold text-sm mb-2">Pipeline by stage</h2>
            <div className="grid grid-cols-4 gap-2 text-sm">
              {Object.entries(data.pipelineByStage).map(([stage, n]) => (
                <div key={stage} className="border rounded p-2">
                  <div className="text-xs text-muted-foreground">{stage.replace(/_/g, " ")}</div>
                  <div className="text-lg font-semibold">{n}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-semibold text-sm mb-2">Service delivery</h2>
            <div className="grid grid-cols-4 gap-2 text-sm">
              <Metric label="Activities planned" value={data.serviceDelivery.activitiesPlanned} />
              <Metric label="Completed" value={data.serviceDelivery.activitiesCompleted} />
              <Metric label="Overdue" value={data.serviceDelivery.activitiesOverdue} />
              <Metric label="Completion %" value={data.serviceDelivery.completionRate} />
              <Metric label="School visits" value={data.serviceDelivery.schoolVisits} />
              <Metric label="Agent meetings" value={data.serviceDelivery.agentMeetings} />
              <Metric label="Events" value={data.serviceDelivery.events} />
            </div>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-semibold text-sm mb-2">Narrative (ICR-authored)</h2>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(narrative).map(([k, v]) => (
                <label key={k} className="text-sm">
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                  <textarea
                    value={v}
                    onChange={e => setNarrative({ ...narrative, [k]: e.target.value })}
                    className="w-full border rounded px-2 py-1 text-sm mt-1"
                    rows={3}
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              This is the preview endpoint. Once you're happy with the narrative, wire it into your monthly report row via the Reports tab.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded p-2 bg-white">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
