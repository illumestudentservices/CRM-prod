"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Market = any;

const KIND_LABELS: Record<string, string> = {
  VISA_CHANGE: "Visa change",
  SCHOOL_UPDATE: "School update",
  COMPETITOR_OBSERVATION: "Competitor observation",
  NEW_OPPORTUNITY: "New opportunity",
  GOVERNMENT_ANNOUNCEMENT: "Govt announcement",
  OTHER: "Other",
};

export function MarketDetailClient({ market, currentUserRole }: { market: Market; currentUserRole: string }) {
  const router = useRouter();
  const [suggestKind, setSuggestKind] = useState("VISA_CHANGE");
  const [suggestText, setSuggestText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canReview = ["REGIONAL_MANAGER", "SUPER_ADMIN"].includes(currentUserRole);
  const canSuggest = ["ICR", "REGIONAL_MANAGER", "SUPER_ADMIN"].includes(currentUserRole);

  async function submitSuggestion(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (suggestText.trim().length < 5) { setError("Please write at least a sentence."); return; }
    const resp = await fetch("/api/market-intelligence/suggestions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId: market.id, kind: suggestKind, originalText: suggestText }),
    });
    if (!resp.ok) { const j = await resp.json().catch(() => ({})); setError(j?.error ?? `HTTP ${resp.status}`); return; }
    setSuggestText("");
    router.refresh();
  }

  async function review(id: string, decision: "APPROVED" | "REJECTED" | "EDITED") {
    let editedText: string | undefined;
    if (decision === "EDITED") {
      const t = prompt("Edited text:");
      if (!t) return;
      editedText = t;
    }
    const reviewNotes = prompt("Review notes (optional):") ?? undefined;
    const resp = await fetch(`/api/market-intelligence/suggestions/${id}/review`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, editedText, reviewNotes }),
    });
    if (!resp.ok) { const j = await resp.json().catch(() => ({})); setError(j?.error ?? `HTTP ${resp.status}`); return; }
    router.refresh();
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{market.name}</h1>
        <p className="text-sm text-muted-foreground">
          Priority: <strong>{market.priority}</strong> · Potential: <strong>{market.potential}</strong> · Risk: <strong>{market.politicalRiskLevel}</strong> · RM: {market.regionalManager?.name ?? "—"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <IntelBox label="Overview" text={market.overview} />
        <IntelBox label="Strategic recommendations" text={market.strategicRecommendations} />
        <IntelBox label="Recruitment opportunities" text={market.recruitmentOpportunities} />
        <IntelBox label="Visa trends" text={market.visaTrends} />
        <IntelBox label="Currency trends" text={market.currencyTrends} />
        <IntelBox label="Competitor institutions" text={market.competitorInstitutions} />
      </div>

      <section id="suggestions">
        <h2 className="text-lg font-semibold mb-2">Suggestions</h2>
        {error && <div className="text-sm text-red-600 dark:text-red-300 mb-2">{error}</div>}

        {canSuggest && (
          <form onSubmit={submitSuggestion} className="border rounded p-3 mb-4 space-y-2">
            <div className="text-sm font-medium">Suggest an update</div>
            <select value={suggestKind} onChange={e => setSuggestKind(e.target.value)} className="border rounded px-2 py-1 text-sm">
              {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <textarea
              placeholder="What did you observe?"
              value={suggestText}
              onChange={e => setSuggestText(e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm"
              rows={3}
            />
            <button type="submit" className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700">Submit for RM review</button>
          </form>
        )}

        <ul className="space-y-2">
          {market.updateSuggestions.length === 0 && <li className="text-sm text-muted-foreground">No suggestions yet.</li>}
          {market.updateSuggestions.map((s: {id: string; kind: string; status: string; originalText: string; editedText: string | null; submittedBy: {name: string | null}; submittedAt: string; reviewedBy: {name: string | null} | null; reviewNotes: string | null}) => (
            <li key={s.id} className="border rounded p-3 text-sm">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <strong>{KIND_LABELS[s.kind]}</strong> · from {s.submittedBy.name} · {new Date(s.submittedAt).toISOString().slice(0, 10)}
                </div>
                <span className={
                  s.status === "PENDING" ? "text-xs px-2 py-0.5 bg-yellow-100 dark:bg-yellow-500/15 text-yellow-800 dark:text-yellow-300 rounded" :
                  s.status === "APPROVED" || s.status === "EDITED" ? "text-xs px-2 py-0.5 bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300 rounded" :
                  "text-xs px-2 py-0.5 bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-300 rounded"
                }>{s.status}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap">{s.editedText ?? s.originalText}</div>
              {s.reviewNotes && <div className="text-xs text-muted-foreground mt-1">Review: {s.reviewNotes}</div>}
              {s.status === "PENDING" && canReview && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => review(s.id, "APPROVED")} className="text-xs px-2 py-1 bg-green-600 text-white rounded">Approve</button>
                  <button onClick={() => review(s.id, "EDITED")} className="text-xs px-2 py-1 bg-blue-600 text-white rounded">Edit + approve</button>
                  <button onClick={() => review(s.id, "REJECTED")} className="text-xs px-2 py-1 bg-gray-500 text-white rounded">Reject</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function IntelBox({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="border rounded p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className="text-sm whitespace-pre-wrap">{text || <span className="text-muted-foreground italic">Not yet recorded.</span>}</div>
    </div>
  );
}
