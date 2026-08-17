"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SEGMENT_LABELS, FORECAST_SEGMENTS } from "@/lib/forecasting";
import type { ForecastSegmentKey } from "@prisma/client";

/**
 * The forecast entry grid: four segments by three outcomes.
 *
 * The layout is spec §13 made visible. When the Regional Manager has adjusted a
 * figure, the ICR's original stays on screen beside it rather than being
 * replaced — the reason the database keeps both is so a reader can see the two
 * professional judgements, and a UI that showed only the winning number would
 * throw that away at the last step.
 *
 * Imports only types and plain constants from lib. A "use client" file that
 * reaches @/lib/db pulls `pg` into the browser bundle and fails the build.
 */

interface Segment {
  segment: ForecastSegmentKey;
  icrApplications: number;
  icrDeposits: number;
  icrEnrolments: number;
  rmApplications: number | null;
  rmDeposits: number | null;
  rmEnrolments: number | null;
}

type Field = "applications" | "deposits" | "enrolments";
const FIELDS: Array<{ key: Field; label: string }> = [
  { key: "applications", label: "Applications" },
  { key: "deposits", label: "Deposits" },
  { key: "enrolments", label: "Enrolments" },
];

export function ForecastGrid({
  forecastId, segments, mode, locked,
}: {
  forecastId: string;
  segments: Segment[];
  /** Which set of columns this user writes. The server decides; this only renders. */
  mode: "icr" | "rm" | "read";
  locked: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = React.useState<Segment[]>(segments);
  const [saving, setSaving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const icrOf = (s: Segment, f: Field) =>
    f === "applications" ? s.icrApplications : f === "deposits" ? s.icrDeposits : s.icrEnrolments;
  const rmOf = (s: Segment, f: Field) =>
    f === "applications" ? s.rmApplications : f === "deposits" ? s.rmDeposits : s.rmEnrolments;

  /** What the reader should act on: the RM figure where set, otherwise the ICR's. */
  const shown = (s: Segment, f: Field) => rmOf(s, f) ?? icrOf(s, f);

  function setLocal(seg: ForecastSegmentKey, f: Field, value: number) {
    setRows((rs) =>
      rs.map((r) => {
        if (r.segment !== seg) return r;
        const key = (mode === "icr" ? "icr" : "rm") +
          f.charAt(0).toUpperCase() + f.slice(1);
        return { ...r, [key]: value } as Segment;
      })
    );
  }

  async function save(seg: ForecastSegmentKey) {
    const r = rows.find((x) => x.segment === seg);
    if (!r) return;
    setSaving(seg);
    setError(null);
    try {
      const body =
        mode === "icr"
          ? {
              segment: seg,
              applications: r.icrApplications,
              deposits: r.icrDeposits,
              enrolments: r.icrEnrolments,
            }
          : {
              segment: seg,
              applications: r.rmApplications ?? r.icrApplications,
              deposits: r.rmDeposits ?? r.icrDeposits,
              enrolments: r.rmEnrolments ?? r.icrEnrolments,
            };
      const res = await fetch(`/api/forecasts/${forecastId}/segments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? `Could not save (${res.status}).`);
        return;
      }
      setRows((rs) => rs.map((x) => (x.segment === seg ? { ...x, ...json.data } : x)));
      router.refresh();
    } finally {
      setSaving(null);
    }
  }

  /** Clears an RM adjustment. Distinct from setting it to the ICR's number:
   *  null records "I agree", a value records "I decided the same". */
  async function clearAdjustment(seg: ForecastSegmentKey) {
    setSaving(seg);
    setError(null);
    try {
      const res = await fetch(`/api/forecasts/${forecastId}/segments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: seg, applications: 0, deposits: 0, enrolments: 0, clearAdjustment: true,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.error ?? "Could not clear."); return; }
      setRows((rs) => rs.map((x) => (x.segment === seg ? { ...x, ...json.data } : x)));
      router.refresh();
    } finally {
      setSaving(null);
    }
  }

  const editable = !locked && (mode === "icr" || mode === "rm");

  const total = (f: Field) => rows.reduce((n, r) => n + shown(r, f), 0);
  const icrTotal = (f: Field) => rows.reduce((n, r) => n + icrOf(r, f), 0);

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr>
              <th className="p-2 text-left font-medium">Segment</th>
              {FIELDS.map((f) => (
                <th key={f.key} className="p-2 text-right font-medium">{f.label}</th>
              ))}
              {editable && <th className="p-2" />}
            </tr>
          </thead>
          <tbody>
            {FORECAST_SEGMENTS.map((key) => {
              const r = rows.find((x) => x.segment === key);
              if (!r) return null;
              const adjusted = FIELDS.some((f) => rmOf(r, f.key) !== null);
              return (
                <tr key={key} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-2">
                    {SEGMENT_LABELS[key]}
                    {adjusted && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        RM adjusted
                      </span>
                    )}
                  </td>
                  {FIELDS.map((f) => {
                    const rm = rmOf(r, f.key);
                    const icr = icrOf(r, f.key);
                    return (
                      <td key={f.key} className="p-2 text-right">
                        {editable ? (
                          <input
                            type="number"
                            min={0}
                            aria-label={`${SEGMENT_LABELS[key]} ${f.label}`}
                            value={mode === "icr" ? icr : (rm ?? icr)}
                            onChange={(e) => setLocal(key, f.key, Number(e.target.value) || 0)}
                            className="w-20 rounded border border-slate-200 bg-transparent p-1 text-right dark:border-slate-700"
                          />
                        ) : (
                          <span className="tabular-nums">{shown(r, f.key)}</span>
                        )}
                        {/* The original, kept visible whenever it differs. */}
                        {rm !== null && rm !== icr && (
                          <div className="text-[11px] text-slate-400 line-through">{icr}</div>
                        )}
                      </td>
                    );
                  })}
                  {editable && (
                    <td className="p-2 text-right">
                      <Button size="sm" variant="outline" disabled={saving === key}
                        onClick={() => void save(key)}>
                        {saving === key ? "…" : "Save"}
                      </Button>
                      {mode === "rm" && adjusted && (
                        <button
                          onClick={() => void clearAdjustment(key)}
                          className="ml-2 text-xs text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200"
                        >
                          Use ICR figure
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60">
            <tr>
              <td className="p-2 font-medium">Total</td>
              {FIELDS.map((f) => (
                <td key={f.key} className="p-2 text-right font-medium tabular-nums">
                  {total(f.key)}
                  {icrTotal(f.key) !== total(f.key) && (
                    <div className="text-[11px] font-normal text-slate-400 line-through">
                      {icrTotal(f.key)}
                    </div>
                  )}
                </td>
              ))}
              {editable && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {mode === "icr"
          ? "These are your figures. The Regional Manager may adjust them; your originals are kept either way."
          : mode === "rm"
            ? "Your adjustments are recorded separately. The ICR's original figures are never overwritten."
            : "Struck-through figures are the ICR's originals where the Regional Manager adjusted them."}
      </p>
    </div>
  );
}
