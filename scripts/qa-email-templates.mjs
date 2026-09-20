/**
 * Every email template, rendered and checked against the client-support rules.
 *
 *   npx tsx --env-file=.env scripts/qa-email-templates.mjs
 *
 * ★ WHAT THIS CATCHES that a human preview does not: markup that renders
 * perfectly in a BROWSER and fails in an inbox. The logo that prompted this
 * work looked fine in every local preview — it was an inline <svg>, which
 * Gmail strips and Outlook cannot draw, so most recipients saw nothing at all.
 *
 * Nothing is sent. Templates are captured by intercepting safeSend's provider
 * call, so what is asserted is the exact HTML that would have gone out.
 *
 * Writes previews to <tmp>/email-previews/ for eyeballing.
 */
process.env.BREVO_API_KEY = "";   // must be cleared BEFORE lib/email.ts loads

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startSection, expect, summary } from "./qa-lib.mjs";

const OUT = path.join(os.tmpdir(), "email-previews");
fs.mkdirSync(OUT, { recursive: true });

// ── Capture what would have been sent ────────────────────────────────────────
const captured = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (typeof url === "string" && url.includes("api.brevo.com")) {
    const body = JSON.parse(init.body);
    captured.push({ subject: body.subject, html: body.htmlContent });
    return new Response("{}", { status: 201 });
  }
  return realFetch(url, init);
};
// safeSend short-circuits without a key, so give it one to reach the fetch.
process.env.BREVO_API_KEY = "test-key-not-real";

const email = await import("@/lib/email");

/** Renders one template and returns its HTML. */
async function render(name, fn) {
  captured.length = 0;
  try {
    await fn();
  } catch (e) {
    return { name, html: null, error: e.message };
  }
  const got = captured[0];
  if (got) {
    fs.writeFileSync(path.join(OUT, `${name}.html`), got.html);
  }
  return { name, html: got?.html ?? null, subject: got?.subject };
}

const LINK = "https://illumestudentservices.cloud/students/x";

// Every template that a person actually receives.
const TEMPLATES = [
  ["welcome", () => email.sendWelcomeEmail({
    to: "new.joiner@example.com", name: "Priya Sharma", employeeId: "ILL-0042",
    jobTitle: "International Client Representative",
    magicLinkUrl: "https://illumestudentservices.cloud/set-password?token=x",
  })],
  ["magic-link", () => email.sendMagicLinkEmail({
    to: "a@example.com", name: "Priya Sharma",
    magicLinkUrl: "https://illumestudentservices.cloud/reset?token=x", expiryHours: 72,
  })],
  ["mfa-code", () => email.sendMfaCodeEmail({
    to: "a@example.com", name: "Priya", code: "483920", expiryMinutes: 10,
    ip: "203.0.113.4",
  })],
  ["security-alert", () => email.sendSecurityAlertEmail({
    to: "a@example.com", alertType: "ROLE_CHANGED",
    targetName: "Priya Sharma", targetEmail: "priya@example.com",
    changedBy: "IT Admin", details: { From: "EMPLOYEE", To: "ICR" },
    actionUrl: "https://illumestudentservices.cloud/settings",
  })],
  ["account-locked", () => email.sendAccountLockedEmail({
    to: "a@example.com", name: "Priya", lockUntil: new Date(Date.now() + 9e5),
  })],
  ["new-lead", () => email.sendNewLeadEmail({
    to: "a@example.com", recipientName: "Priya", icrName: "Deepak Sharma",
    isManagerCopy: true,
    leads: [{ name: "Mei Ling Tan", url: LINK, possibleDuplicate: true,
      detail: [["Programme", "MSc Computing"], ["Intake", "Sep 2027"],
               ["Nationality", "Malaysian"], ["Email", "m@example.com"]] }],
    listUrl: "https://illumestudentservices.cloud/students",
  })],
  ["new-lead-batch", () => email.sendNewLeadEmail({
    to: "a@example.com", recipientName: "Priya", icrName: "Deepak Sharma",
    isManagerCopy: false,
    leads: Array.from({ length: 4 }, (_, i) => ({
      name: `Student ${i + 1}`, url: LINK, possibleDuplicate: i === 1,
      detail: [["Programme", "BSc Business"], ["Intake", "Jan 2028"], ["Nationality", "Indian"]],
    })),
    batch: { submitted: 5, created: 4, failed: 1 },
    listUrl: "https://illumestudentservices.cloud/students",
  })],
  ["lead-stage-change", () => email.sendLeadStageChangeEmail({
    to: "a@example.com", icrName: "Priya", leadName: "Mei Ling Tan",
    previousStage: "CONTACTED", newStage: "QUALIFIED", changedBy: "Deepak Sharma",
    note: "Eligibility confirmed.", leadUrl: LINK,
  })],
  ["leave-applied", () => email.sendLeaveAppliedEmail({
    to: "a@example.com", managerName: "Priya", employeeName: "Deepak Sharma",
    leaveType: "Annual", startDate: "2027-01-04", endDate: "2027-01-08",
    days: 5, reason: "Family holiday",
    leaveUrl: "https://illumestudentservices.cloud/hr",
  })],
  ["leave-decision", () => email.sendLeaveDecisionEmail({
    to: "a@example.com", employeeName: "Deepak", leaveType: "Annual",
    startDate: "2027-01-04", endDate: "2027-01-08", days: 5,
    action: "APPROVED", note: "Enjoy the break.",
    leaveUrl: "https://illumestudentservices.cloud/hr",
  })],
  ["account-request", () => email.sendAccountRequestEmail({
    to: "it@example.com", fullName: "Amara Okafor",
    personalEmail: "amara.okafor@gmail.com", jobTitle: "International Client Representative",
    requestedRole: "ICR", employmentType: "FULL_TIME", startDate: "2027-03-01",
    region: "West Africa", department: "Student Recruitment",
    phone: "+2348012345678", justification: "Backfill for the Lagos market.",
    requestedByName: "Priya Sharma",
    requestedByEmail: "priya@illumestudentservices.ca",
    reviewUrl: "https://illumestudentservices.cloud/hr",
  })],
  ["offboarding-request", () => email.sendOffboardingRequestEmail({
    to: "it@example.com", employeeName: "Amara Okafor", employeeCode: "ILL-0042",
    workEmail: "amara@illumestudentservices.ca",
    jobTitle: "International Client Representative", role: "ICR",
    department: "Student Recruitment", region: "West Africa",
    reason: "Resignation", lastWorkingDay: "2027-02-28",
    forwardingEmail: "amara.okafor@gmail.com",
    notes: "Handover to the Lagos team is complete.",
    revocationSteps: ["Disable the Microsoft 365 account", "Revoke CRM access", "Collect the laptop"],
    requestedByName: "Priya Sharma",
    requestedByEmail: "priya@illumestudentservices.ca",
    reviewUrl: "https://illumestudentservices.cloud/hr",
  })],
];

try {
  startSection("Render every template");
  const rendered = [];
  for (const [name, fn] of TEMPLATES) {
    const r = await render(name, fn);
    rendered.push(r);
    if (r.error) expect(false, `${name} renders`, r.error);
  }
  const ok = rendered.filter((r) => r.html);
  expect(ok.length >= 10, `${ok.length} of ${TEMPLATES.length} templates rendered`,
    rendered.filter((r) => !r.html).map((r) => r.name).join(", "));

  // ── The client-support rules ──────────────────────────────────────────────
  startSection("No markup that Gmail or Outlook cannot render");
  const RULES = [
    [/<svg[\s>]/i, "inline <svg> (Gmail strips it, Outlook cannot draw it)"],
    [/linear-gradient/i, "linear-gradient (unsupported in Outlook; white text can land on white)"],
    [/box-shadow/i, "box-shadow (silently dropped)"],
    [/fill-opacity/i, "fill-opacity (fades the mark)"],
    [/background:\s*rgba\(/i, "rgba() background (unreliable; this is what 'faded' looks like)"],
    [/#[0-9A-Fa-f]{8}\b/, "8-digit hex colour (invalid in Outlook)"],
  ];
  for (const [re, why] of RULES) {
    const bad = ok.filter((r) => re.test(r.html));
    expect(bad.length === 0, `no ${why}`, bad.map((r) => r.name).join(", "));
  }

  startSection("Branding and structure");
  for (const r of ok) {
    // The real hosted logo, not a drawing.
    expect(/<img[^>]+logo\.png/i.test(r.html), `${r.name}: uses the hosted logo PNG`);
    // Absolute, or the client cannot fetch it.
    expect(/src="https?:\/\//i.test(r.html), `${r.name}: image URL is absolute`);
    // Alt text, for image-blocking clients.
    expect(/<img[^>]+alt="[^"]+"/i.test(r.html), `${r.name}: logo has alt text`);
  }
  expect(ok.every((r) => r.html.includes("Illume Student Advisory Services")),
    "every email carries the full company name");
  expect(ok.every((r) => /max-width:600px/.test(r.html)),
    "every email is width-constrained to 600px");
  expect(ok.every((r) => /do not reply/i.test(r.html)),
    "every email says it is automated");

  startSection("Content hygiene");
  for (const bad of ["undefined", "NaN", "[object Object]", "${"]) {
    const hits = ok.filter((r) => r.html.includes(bad));
    expect(hits.length === 0, `no "${bad}" reaches a recipient`,
      hits.map((r) => r.name).join(", "));
  }
  // ★ No blank rows. A leftover `detailRows.map(() => ["", ""])` in the security
  // alert spread one empty stripe into the table for every detail it reported.
  // Every structural assertion passed while the email plainly looked broken —
  // this is the check that would have caught it.
  for (const r of ok) {
    const blanks = (r.html.match(/<td[^>]*><\/td>/gi) || []).length;
    expect(blanks === 0, `${r.name}: no empty table cells`, `${blanks} found`);
  }

  // Tag balance — a stray </table> collapses the layout in Outlook.
  for (const r of ok) {
    const o = (r.html.match(/<table/gi) || []).length;
    const c = (r.html.match(/<\/table>/gi) || []).length;
    expect(o === c, `${r.name}: table tags balanced (${o}/${c})`);
  }
  // Subjects should be plain and specific, not marketing.
  const emojiSubjects = rendered.filter((r) =>
    r.subject && /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u.test(r.subject));
  expect(emojiSubjects.length === 0,
    "no emoji in subject lines (reads as marketing; some filters score it)",
    emojiSubjects.map((r) => `${r.name}: ${r.subject}`).join(" | "));

  console.log(`\n   previews written to ${OUT}`);
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch;
  summary();
}
