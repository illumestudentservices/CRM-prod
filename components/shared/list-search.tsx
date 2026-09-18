"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * A search box that drives a `q` URL parameter.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Three list pages — partners, events and campaigns — each honoured a `q`
 * parameter in their database query while rendering no input at all. The
 * capability was built and simply unreachable: you could only search by editing
 * the URL. This is the missing half, written once.
 *
 * ── WHY IT STAYS IN THE URL ─────────────────────────────────────────────────
 *
 * Every one of those pages filters on the SERVER and caps its query with
 * `take`. Filtering the loaded rows in the browser would search only the
 * fetched page and report anything past the cap as not existing. Keeping the
 * term in the URL also means a refresh, the back button and a shared link all
 * behave.
 */
export function ListSearch({
  placeholder = "Search…",
  label = "Search",
  className = "max-w-xs",
}: {
  placeholder?: string;
  /** Accessible name. Give each page its own so tests can tell them apart. */
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlQ = params.get("q") ?? "";
  const [value, setValue] = React.useState(urlQ);

  // Follow the URL when it changes elsewhere — the back button, or a tab link
  // that drops the term.
  React.useEffect(() => setValue(urlQ), [urlQ]);

  React.useEffect(() => {
    if (value === urlQ) return;
    // Debounced: pushing per keystroke is one server round trip per character.
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set("q", value);
      else next.delete("q");
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    }, 400);
    return () => clearTimeout(t);
  }, [value, urlQ, params, pathname, router]);

  return (
    <div className={`relative flex-1 min-w-[200px] ${className}`}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pl-8 h-9 text-sm"
      />
    </div>
  );
}
