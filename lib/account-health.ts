import type { AccountHealth } from "@prisma/client";

/**
 * One place that decides what the account health traffic-light is called.
 *
 * The business has two names for this and both are in daily use. The CRM shipped
 * with the colour vocabulary — Green / Amber / Red / Grey — while the client list
 * the regional team maintains calls the same judgement the "Client HPI" and
 * records it as Happy / Concerned / Alarmed. They are the same rating: the
 * spreadsheet's column is imported straight into `Institution.accountHealth` by
 * scripts/enrich-clients.mjs.
 *
 * Keeping both words together, rather than picking a winner, is deliberate.
 * Somebody who has only ever seen the spreadsheet needs to recognise "Concerned"
 * on the card; somebody who set the rating through the Account Health panel
 * needs to recognise "Amber". A screen showing one word and a screen showing the
 * other for the same client is how people conclude they are looking at two
 * different numbers.
 */
export const HEALTH_LABELS: Record<
  AccountHealth,
  {
    /** The colour, as the Account Health panel has always shown it. */
    colour: string;
    /** The client list's word for the same rating. */
    sentiment: string;
    /** Both, for headings and dropdowns where there is room. */
    full: string;
    hint: string;
  }
> = {
  GREEN: {
    colour: "Green",
    sentiment: "Happy",
    full: "Green — Happy",
    hint: "No concerns.",
  },
  AMBER: {
    colour: "Amber",
    sentiment: "Concerned",
    full: "Amber — Concerned",
    hint: "Needs a corrective action and an owner.",
  },
  RED: {
    colour: "Red",
    sentiment: "Alarmed",
    full: "Red — Alarmed",
    hint: "Needs a corrective action and an owner.",
  },
  GREY: {
    colour: "Grey",
    sentiment: "Not assessed",
    full: "Grey — Not Assessed",
    hint: "No assessment recorded yet.",
  },
};

/** Pill styling per rating. Grey is muted on purpose: it is an absence, not a state. */
export const HEALTH_PILL: Record<AccountHealth, string> = {
  GREEN: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  AMBER: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  RED: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  GREY: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

/** The order these should be offered and counted in — best to worst, absence last. */
export const HEALTH_ORDER: AccountHealth[] = ["GREEN", "AMBER", "RED", "GREY"];
