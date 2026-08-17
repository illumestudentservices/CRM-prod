"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { HelpCircle, X, Search, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Where do I…?" — the in-app help widget.
 *
 * Answers come from /api/assistant, which is a deterministic lookup over the
 * feature catalogue and the permission matrix. There is no model behind it, so
 * answers are instant and free; this component can therefore search as the user
 * types rather than making them submit and wait.
 *
 * Imports nothing from lib/ except `cn`. A "use client" file that reaches
 * @/lib/db pulls `pg` into the browser bundle and fails the build with
 * "Can't resolve 'dns'" — the mistake that took a page sweep from 38 routes
 * to 0.
 */

interface Match {
  key: string;
  name: string;
  route: string;
  summary: string;
  can: string[];
}

interface StatAnswer {
  title: string;
  lines: Array<{ label: string; value: string }>;
  route: string;
  routeLabel: string;
}

interface Answer {
  kind: "found" | "restricted" | "not_found" | "stats";
  message: string;
  matches: Match[];
  askRoles?: string[];
  stats?: StatAnswer;
}

/** Starting points, so an empty box is never a dead end. */
const SUGGESTIONS = [
  "Where are my students?",
  "How do I book travel?",
  "Where do I do a handover?",
  "What's on my to do list?",
];

export function HelpWidget() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [answer, setAnswer] = React.useState<Answer | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Escape closes; Ctrl/Cmd-/ opens. Bound once, at the document, so the
  // shortcut works wherever focus happens to be.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "/" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Close on an outside click, but only while open — otherwise every click in
  // the app pays for a listener that does nothing.
  React.useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Search as they type. Debounced because a keystroke is cheaper than a round
  // trip even when the round trip is only a lookup.
  React.useEffect(() => {
    const q = query.trim();
    if (!q) {
      setAnswer(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (!cancelled) setAnswer(json.data);
      } catch {
        // A blank panel would read as "no such feature", which is the opposite
        // of the truth when the request simply failed.
        if (!cancelled) {
          setAnswer(null);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function go(route: string) {
    setOpen(false);
    setQuery("");
    router.push(route);
  }

  return (
    <>
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Help — find a feature"
        aria-expanded={open}
        className={cn(
          "fixed bottom-4 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full sm:bottom-5 sm:right-5 sm:h-11 sm:w-11",
          "bg-[#1E3A5F] text-white shadow-lg transition-transform hover:scale-105",
          "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1E3A5F]"
        )}
      >
        {open ? <X className="h-5 w-5" /> : <HelpCircle className="h-5 w-5" />}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Find a feature"
          className={cn(
            "fixed bottom-20 right-5 z-40 flex w-[min(24rem,calc(100vw-2.5rem))] flex-col",
            "rounded-xl border border-slate-200 bg-white shadow-2xl",
            "dark:border-slate-700 dark:bg-slate-900"
          )}
        >
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Find a feature
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ask where something lives, or whether you can use it.
            </p>
          </div>

          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. where are my students"
              aria-label="What are you looking for?"
              className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-slate-400"
            />
            {loading && <span className="text-xs text-slate-400">…</span>}
          </div>

          <div className="flex-1 overflow-y-auto p-3 sm:max-h-80">
            {failed && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Could not reach the help service. Try again in a moment.
              </p>
            )}

            {!query.trim() && !failed && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Try asking
                </p>
                <ul className="space-y-1">
                  {SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <button
                        onClick={() => setQuery(s)}
                        className="w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {answer && (
              <div className="space-y-3">
                <p
                  className={cn(
                    "text-sm",
                    answer.kind === "restricted"
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-slate-700 dark:text-slate-200"
                  )}
                >
                  {answer.message}
                </p>

                {answer.stats && (
                  <div className="rounded-md border border-slate-100 p-2 dark:border-slate-800">
                    <dl className="space-y-0.5">
                      {answer.stats.lines.map((l) => (
                        <div key={l.label} className="flex items-baseline justify-between gap-3 text-sm">
                          {/* Indented sub-lines arrive with leading spaces, which
                              HTML collapses — the padding class restores the
                              hierarchy the label intends. */}
                          <dt className={cn(
                            "text-slate-600 dark:text-slate-300",
                            l.label.startsWith("  ") && "pl-3 text-xs text-slate-500"
                          )}>
                            {l.label.trim()}
                          </dt>
                          <dd className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
                            {l.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <button
                      onClick={() => go(answer.stats!.route)}
                      className="mt-2 text-xs text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200"
                    >
                      Open {answer.stats.routeLabel}
                    </button>
                  </div>
                )}

                {answer.matches.length > 0 && (
                  <ul className="space-y-1">
                    {answer.matches.map((m) => (
                      <li key={m.key}>
                        <button
                          onClick={() => go(m.route)}
                          className="group flex w-full items-start gap-2 rounded-md border border-slate-100 p-2 text-left hover:border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                              {m.name}
                            </span>
                            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                              {m.route}
                            </span>
                          </div>
                          <CornerDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Escalation. Deliberately a mailto rather than an endpoint
                    that fires on its own: a human decides to send it, so this
                    cannot become a way to flood IT with every typo. */}
                {answer.kind !== "found" && (
                  <a
                    href={`mailto:it@illumestudentservices.ca?subject=${encodeURIComponent(
                      "Illume Cloud — cannot find a feature"
                    )}&body=${encodeURIComponent(
                      `I was looking for: ${query}\n\nWhat I was trying to do:\n`
                    )}`}
                    className="inline-block text-xs text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    Ask IT about this
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
