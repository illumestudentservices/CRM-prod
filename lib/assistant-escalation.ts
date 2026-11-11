import { safeSend } from "@/lib/email";
import type { Role } from "@/lib/permissions";

/**
 * Emails the product owner when the help widget cannot answer something.
 *
 * ★ NOT CURRENTLY WIRED TO THE WIDGET (2026-11-11). The search route used to
 * call this on every miss, but the widget searches as the user types, so it
 * emailed IT per keystroke-stub. Searching now only logs `HELP_MISS`;
 * escalation is the explicit `sendSupportRequest` below, on a button click.
 * This is kept (and still unit-tested) as a ready digest/auto-report option.
 *
 * The value is not the individual email — it is learning which words staff use
 * that the catalogue does not know, and which features they expect to exist.
 * Each one is either an alias to add or a gap to build.
 *
 * Two protections, because an endpoint that emails on every unanswered question
 * is a spam cannon pointed at its owner:
 *
 *   DEDUPE — the same question is reported once per window, however many people
 *   ask it. Ten staff hitting the same gap should be one email that says ten,
 *   not ten emails.
 *
 *   CAP — a hard ceiling per window regardless of variety, so a bot or a bored
 *   user mashing the box cannot fill an inbox.
 *
 * State is in-process and resets on deploy. That is a deliberate trade: a table
 * would survive restarts but needs a migration and a cleanup job to answer a
 * question that does not need to be exact. Worst case after a restart is one
 * repeat of a question already sent.
 */

const RECIPIENT = process.env.HELP_ESCALATION_EMAIL ?? "";
const WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_PER_WINDOW = 12;

interface Seen {
  count: number;
  firstAt: number;
  notifiedAt: number;
  roles: Set<string>;
}

const seen = new Map<string, Seen>();
let windowStart = Date.now();
let sentThisWindow = 0;

/** Collapse trivially different phrasings so they dedupe together. */
function fingerprint(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function rollWindow(now: number) {
  if (now - windowStart < WINDOW_MS) return;
  windowStart = now;
  sentThisWindow = 0;
  for (const [k, v] of seen) {
    if (now - v.firstAt > WINDOW_MS) seen.delete(k);
  }
}

export interface EscalationResult {
  sent: boolean;
  reason: "sent" | "duplicate" | "capped" | "not_configured";
  occurrences: number;
}

/**
 * Report an unanswered question. Never throws and never blocks the response —
 * a failed notification must not turn a working "I could not find that" into an
 * error for the user who asked.
 */
export async function reportUnanswered(opts: {
  query: string;
  role: Role;
  kind: string;
  userEmail?: string | null;
}): Promise<EscalationResult> {
  if (!RECIPIENT) return { sent: false, reason: "not_configured", occurrences: 0 };

  const now = Date.now();
  rollWindow(now);

  const key = fingerprint(opts.query);
  const entry = seen.get(key) ?? { count: 0, firstAt: now, notifiedAt: 0, roles: new Set<string>() };
  entry.count += 1;
  entry.roles.add(opts.role);
  seen.set(key, entry);

  // Already reported this question in this window — the count keeps rising and
  // will be reflected next time the window rolls.
  if (entry.notifiedAt && now - entry.notifiedAt < WINDOW_MS) {
    return { sent: false, reason: "duplicate", occurrences: entry.count };
  }
  if (sentThisWindow >= MAX_PER_WINDOW) {
    return { sent: false, reason: "capped", occurrences: entry.count };
  }

  entry.notifiedAt = now;
  sentThisWindow += 1;

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px">
      <h2 style="margin:0 0 4px;font-size:17px">Someone could not find something in Illume Cloud</h2>
      <p style="margin:0 0 16px;color:#555;font-size:13px">
        The in-app help could not answer this. It is either a word the catalogue
        does not know, or a feature that does not exist yet.
      </p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr>
          <td style="padding:6px 10px 6px 0;color:#666">They asked</td>
          <td style="padding:6px 0"><strong>${esc(opts.query)}</strong></td>
        </tr>
        <tr>
          <td style="padding:6px 10px 6px 0;color:#666">Result</td>
          <td style="padding:6px 0">${esc(opts.kind === "restricted" ? "Exists, but their role cannot reach it" : "No match in the catalogue")}</td>
        </tr>
        <tr>
          <td style="padding:6px 10px 6px 0;color:#666">Asked by</td>
          <td style="padding:6px 0">${esc([...entry.roles].join(", "))}${opts.userEmail ? ` &middot; ${esc(opts.userEmail)}` : ""}</td>
        </tr>
        <tr>
          <td style="padding:6px 10px 6px 0;color:#666">Times asked</td>
          <td style="padding:6px 0">${entry.count}</td>
        </tr>
      </table>
      <p style="margin:16px 0 0;color:#666;font-size:12px">
        Repeats of this question are grouped for the next 6 hours rather than
        emailed again. If the feature exists, add the wording they used as an
        alias in <code>lib/assistant-catalog.ts</code>.
      </p>
    </div>`;

  try {
    await safeSend({
      to: RECIPIENT,
      subject: `Illume Cloud — help could not answer: "${opts.query.slice(0, 60)}"`,
      html,
    });
    return { sent: true, reason: "sent", occurrences: entry.count };
  } catch (err) {
    console.error("[assistant-escalation]", err);
    return { sent: false, reason: "not_configured", occurrences: entry.count };
  }
}

// ─── Explicit "message IT support" ───────────────────────────────────────────

/**
 * Sends a support message the user ASKED to send — the button in the help
 * widget, not the automatic miss report above.
 *
 * The difference matters, and it is the whole point of this change: the widget
 * used to email the owner on every unanswered keystroke (and it searches as you
 * type), which buried the inbox. Now searching emails NOBODY; only this, on a
 * deliberate click, does.
 *
 * Because it is user-initiated it does NOT dedupe — a person who clicks Send
 * expects their message to go, and silently collapsing it into an earlier one
 * would be a lie. It keeps only a generous per-process ceiling as an anti-abuse
 * valve, so a script cannot turn the button into a flood. Never throws.
 */
const SUPPORT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SUPPORT_MAX_PER_WINDOW = 100;
let supportWindowStart = Date.now();
let supportSentThisWindow = 0;

export interface SupportRequestResult {
  sent: boolean;
  reason: "sent" | "not_configured" | "capped" | "error";
}

export async function sendSupportRequest(opts: {
  query: string;
  detail?: string | null;
  role: Role;
  userEmail?: string | null;
  userName?: string | null;
}): Promise<SupportRequestResult> {
  if (!RECIPIENT) return { sent: false, reason: "not_configured" };

  const now = Date.now();
  if (now - supportWindowStart >= SUPPORT_WINDOW_MS) {
    supportWindowStart = now;
    supportSentThisWindow = 0;
  }
  if (supportSentThisWindow >= SUPPORT_MAX_PER_WINDOW) {
    return { sent: false, reason: "capped" };
  }
  supportSentThisWindow += 1;

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const who = opts.userName || opts.role;
  const detailRow = opts.detail?.trim()
    ? `<tr><td style="padding:6px 10px 6px 0;color:#666;vertical-align:top">Their message</td><td style="padding:6px 0;white-space:pre-wrap">${esc(opts.detail.trim())}</td></tr>`
    : "";

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px">
      <h2 style="margin:0 0 4px;font-size:17px">A staff member has messaged IT support</h2>
      <p style="margin:0 0 16px;color:#555;font-size:13px">
        Sent from the in-app help widget in Illume Cloud.
      </p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr>
          <td style="padding:6px 10px 6px 0;color:#666">They searched for</td>
          <td style="padding:6px 0"><strong>${esc(opts.query)}</strong></td>
        </tr>
        ${detailRow}
        <tr>
          <td style="padding:6px 10px 6px 0;color:#666">From</td>
          <td style="padding:6px 0">${esc(who)}${opts.userEmail ? ` &middot; <a href="mailto:${esc(opts.userEmail)}">${esc(opts.userEmail)}</a>` : ""}</td>
        </tr>
      </table>
      <p style="margin:16px 0 0;color:#666;font-size:12px">
        Reply directly to ${opts.userEmail ? esc(opts.userEmail) : "the sender"} to help them.
      </p>
    </div>`;

  try {
    await safeSend({
      to: RECIPIENT,
      subject: `Illume Cloud — IT support request from ${who}`,
      html,
    });
    return { sent: true, reason: "sent" };
  } catch (err) {
    console.error("[assistant-support]", err);
    return { sent: false, reason: "error" };
  }
}

/** Test seam — lets the suite assert dedupe and cap without sending mail. */
export function __resetEscalationState() {
  seen.clear();
  windowStart = Date.now();
  sentThisWindow = 0;
  supportWindowStart = Date.now();
  supportSentThisWindow = 0;
}
