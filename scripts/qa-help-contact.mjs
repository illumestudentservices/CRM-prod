/**
 * Help widget: searching emails NOBODY; the "Send a message to IT support"
 * button is the only thing that emails IT.
 *
 * Before this, /api/assistant emailed the owner on every unanswered search, and
 * the widget searches as you type — so IT got a message per keystroke-stub.
 * Now a miss only logs HELP_MISS, and escalation is the explicit
 * /api/assistant/contact endpoint.
 *
 * Reads the dev-server email log: with HELP_ESCALATION_EMAIL set but no
 * BREVO_API_KEY, safeSend logs `[email] Skipped … to: <addr>, subject: <subj>`
 * instead of sending, so we can see exactly who would have been emailed.
 *
 *   start dev with:  BREVO_API_KEY= HELP_ESCALATION_EMAIL=it-qa@illume.local npm run dev
 *   DEV_LOG=<path> npx tsx --env-file=.env.local scripts/qa-help-contact.mjs
 */
import fs from "node:fs";
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, sleep } from "./qa-lib.mjs";

const OWNER = "it-qa@illume.local"; // must match HELP_ESCALATION_EMAIL on the dev server
const DEV_LOG = process.env.DEV_LOG;
if (!DEV_LOG || !fs.existsSync(DEV_LOG)) {
  console.error(`[fatal] DEV_LOG not found: ${DEV_LOG}`);
  process.exit(1);
}

let logOffset = fs.statSync(DEV_LOG).size;
function newEmailLines() {
  const size = fs.statSync(DEV_LOG).size;
  const fd = fs.openSync(DEV_LOG, "r");
  const buf = Buffer.alloc(Math.max(0, size - logOffset));
  if (buf.length) fs.readSync(fd, buf, 0, buf.length, logOffset);
  fs.closeSync(fd);
  logOffset = size;
  return buf.toString("utf8").split("\n").filter((l) => l.includes("[email]"));
}
const emailedOwner = (lines, needle) =>
  lines.some((l) => l.includes(`to: ${OWNER}`) && l.includes(needle));

let user;
try {
  user = await createAndLogin({ role: "ICR" });

  // Validation: the endpoint rejects an empty query (once).
  startSection("contact endpoint validates input");
  {
    const r = await api(user.jar, "POST", "/api/assistant/contact", { query: "" });
    expect(r.status === 422, "empty query is rejected (422)", `got ${r.status}`);
  }

  for (let round = 1; round <= 3; round++) {
    const miss = `zzxq nonexistent feature ${Date.now()}-${round}`;

    // ── 1. A missed SEARCH emails nobody ────────────────────────────────────
    startSection(`round ${round}: searching a miss does NOT email IT`);
    newEmailLines();
    let r = await api(user.jar, "POST", "/api/assistant", { query: miss });
    expect(r.status === 200, "search returns 200", `got ${r.status}`);
    await sleep(900);
    const afterSearch = newEmailLines();
    expect(!afterSearch.some((l) => /IT support request|help could not answer/i.test(l)),
      "no escalation email was sent by the search", `lines: ${afterSearch.join(" | ") || "none"}`);

    // ── 2. The BUTTON (contact endpoint) emails IT ──────────────────────────
    startSection(`round ${round}: pressing "Send to IT support" emails IT`);
    newEmailLines();
    r = await api(user.jar, "POST", "/api/assistant/contact", { query: miss, detail: `please help ${round}` });
    expect(r.status === 200, "contact returns 200", `got ${r.status}: ${JSON.stringify(r.payload)?.slice(0,160)}`);
    expect(r.payload?.data?.sent === true, "endpoint reports it was sent");
    await sleep(1000);
    const afterContact = newEmailLines();
    expect(emailedOwner(afterContact, "IT support request"),
      "IT support received the message email", `lines: ${afterContact.join(" | ") || "none"}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (user) await destroyUser(user).catch(() => {});
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
