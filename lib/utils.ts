import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "dd MMM yyyy");
}

/**
 * A task's human-readable ticket number, e.g. 42 → "TSK-0042". Padded to four
 * digits so the identifiers line up and sort sensibly as text; longer numbers
 * grow past four digits. Used everywhere a task is shown or referenced.
 */
export function formatTaskNumber(n: number | null | undefined): string {
  if (n == null) return "";
  return `TSK-${String(n).padStart(4, "0")}`;
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "dd MMM yyyy, HH:mm");
}

/**
 * "3 minutes ago", and similar.
 *
 * ⚠ THE ELEMENT RENDERING THIS MUST CARRY `suppressHydrationWarning`.
 *
 * The answer depends on the clock, so the server computes it at one instant and
 * the browser recomputes it at another. Cross a boundary in between — which for
 * anything recent is close to guaranteed, "less than a minute ago" becoming
 * "1 minute ago" — and the two strings differ. React treats that as a failed
 * hydration and reports minified error #418.
 *
 * Observed on production on the student page, where every visit logged it,
 * because the History panel renders activities created moments earlier.
 *
 * All five call sites are marked. Adding a sixth without the attribute puts the
 * error straight back, so check the element before reaching for this.
 */
export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function formatCurrency(
  value: number | null | undefined,
  currency = "USD"
): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}%`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "");
}

/**
 * Initials for an avatar.
 *
 * ★ CODE POINTS, NOT name[0].
 *
 * name[0] returns the first UTF-16 CODE UNIT. For a name beginning with an
 * astral character - an emoji, or scripts above the BMP - that is half a
 * surrogate pair: a lone surrogate, which renders as a replacement character
 * and does not survive a round trip identically.
 *
 * The visible symptom was a hydration error on /dashboard. React found the
 * initials span differing between server and client, printed both sides as
 * the same unreadable glyph, and regenerated the whole tree. The culprit was
 * a lead named with three emoji.
 *
 * Array.from iterates code points, so a surrogate pair is taken whole or not
 * at all. Splitting on /\s+/ rather than " " also stops a double space
 * producing an empty segment and an undefined initial.
 */
export function getInitials(name: string | null | undefined, fallback?: string): string {
  if (name?.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .map((part) => Array.from(part)[0] ?? "")
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  if (fallback) return Array.from(fallback).slice(0, 2).join("").toUpperCase();
  return "??";
}

export function calculateROI(
  enrollments: number,
  avgValue: number,
  totalCost: number
): number {
  if (totalCost === 0) return 0;
  return ((enrollments * avgValue - totalCost) / totalCost) * 100;
}

export function confidenceWeight(level: string): number {
  switch (level) {
    case "HIGH":
      return 0.8;
    case "MEDIUM":
      return 0.5;
    case "LOW":
      return 0.25;
    default:
      return 0;
  }
}

export function getMonthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString("default", {
    month: "long",
  });
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}
