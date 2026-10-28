/**
 * Verifies the two email-notification rules the user asked for:
 *
 *   1. STAGE CHANGE → the assigned ICR ALWAYS gets the email, including when
 *      the ICR moved their OWN lead (previously that case sent nothing).
 *   2. CLOSING a lead → BOTH the assigned ICR and that ICR's manager get a
 *      "Lead Closed" email (previously a close sent no email at all).
 *
 * How it asserts: with no BREVO_API_KEY in .env.local, safeSend() does not send
 * — it logs  `[email] Skipped (no BREVO_API_KEY) — to: <addr>, subject: <subj>`.
 * We drive the real /api/leads/[id]/stage and /close routes as an RM and as an
 * ICR, then read those log lines from the dev-server log to confirm exactly who
 * would have been emailed.
 *
 *   DEV_LOG=<path> npx tsx --env-file=.env.local scripts/qa-lead-stage-close-emails.mjs
 */
import fs from "node:fs";
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, sleep } from "./qa-lib.mjs";

const DEV_LOG = process.env.DEV_LOG;
if (!DEV_LOG || !fs.existsSync(DEV_LOG)) {
  console.error(`[fatal] DEV_LOG not found: ${DEV_LOG}`);
  process.exit(1);
}

const REGION_ID = "d46440e9-6cc3-4ab8-be49-8eac11f59e81"; // Africa
const SOURCE_ID = "src-003"; // StudyAbroad UAE

// Read only the log lines written since the last checkpoint, so each action's
// emails are judged on their own and not confused with an earlier one.
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
// Did an email go `to: <addr>` with a subject containing <needle>?
function emailed(lines, addr, needle) {
  return lines.some((l) => l.includes(`to: ${addr}`) && l.includes(needle));
}

let rm, icr, lead1, lead2;
try {
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: REGION_ID } });
  icr = await createAndLogin({ role: "ICR", withEmployee: true, extra: { regionId: REGION_ID } });

  // The ICR reports to the RM — this is the link resolveManager() follows.
  await db.employee.update({ where: { id: icr.employee.id }, data: { managerId: rm.employee.id } });

  // A lead that already satisfies the NEW_LEAD → CONTACTED gate, assigned to the
  // ICR and in the RM's region so both can act on it.
  const baseLead = {
    firstName: "QA", nationality: "Nigerian", countryOfResidence: "Nigeria",
    interestedProgram: "Business", intakeYear: 2027, intakeMonth: 9, studyLevel: "UNDERGRADUATE",
    email: "qa-stagelead@illume.local", phone: "+2348000000000",
    sourceId: SOURCE_ID, intendedDestination: "Canada", leadTemperature: "WARM",
    regionId: REGION_ID, assignedICRId: icr.user.id, createdById: icr.user.id,
    stage: "NEW_LEAD",
  };
  lead1 = await db.lead.create({ data: { ...baseLead, lastName: "LeadOne" } });
  lead2 = await db.lead.create({ data: { ...baseLead, lastName: "LeadTwo" } });

  // Leaving NEW_LEAD requires a future activity booked. One per lead so both the
  // RM move and the ICR move pass the gate cleanly (no override needed).
  for (const l of [lead1, lead2]) {
    await db.leadActivity.create({
      data: {
        leadId: l.id, userId: icr.user.id, kind: "ENGAGEMENT", type: "FOLLOW_UP",
        description: "Scheduled follow-up call", scheduledFor: new Date(Date.now() + 7 * 86400000),
      },
    });
  }

  newEmailLines(); // drop anything logged during setup

  // ── 1. RM moves the ICR's lead → ICR is emailed, RM is not ──────────────
  startSection("Stage change by RM → assigned ICR emailed");
  const r1 = await api(rm.jar, "PATCH", `/api/leads/${lead1.id}/stage`, { stage: "CONTACTED" });
  expect(r1.status === 200, "RM stage change accepted", `got ${r1.status}: ${JSON.stringify(r1.payload)?.slice(0,200)}`);
  await sleep(1500);
  let lines = newEmailLines();
  expect(emailed(lines, icr.email, "moved to Contacted"), "assigned ICR got the stage-change email");
  expect(!emailed(lines, rm.email, "Lead Update"), "RM did NOT get a stage-change email (ICR-only)");

  // ── 2. ICR moves THEIR OWN lead → ICR still emailed (the new behaviour) ──
  startSection("Stage change by the ICR on their OWN lead → still emailed");
  const r2 = await api(icr.jar, "PATCH", `/api/leads/${lead2.id}/stage`, { stage: "CONTACTED" });
  expect(r2.status === 200, "ICR stage change accepted", `got ${r2.status}: ${JSON.stringify(r2.payload)?.slice(0,200)}`);
  await sleep(1500);
  lines = newEmailLines();
  expect(emailed(lines, icr.email, "moved to Contacted"), "ICR got the email for their OWN lead move");

  // ── 3. RM closes the lead → ICR AND manager both emailed ────────────────
  startSection("Lead close → ICR + manager both emailed");
  const r3 = await api(rm.jar, "POST", `/api/leads/${lead1.id}/close`, {
    outcome: "LOST", lostReason: "NO_RESPONSE",
    lostDate: new Date().toISOString(), notes: "QA close test — no response after follow-ups.",
  });
  expect(r3.status === 200, "close accepted", `got ${r3.status}: ${JSON.stringify(r3.payload)?.slice(0,200)}`);
  await sleep(1800);
  lines = newEmailLines();
  expect(emailed(lines, icr.email, "Lead Closed"), "assigned ICR got the close email");
  expect(emailed(lines, rm.email, "Lead Closed"), "the ICR's manager got the close email");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const l of [lead1, lead2]) {
    if (l) {
      await db.leadActivity.deleteMany({ where: { leadId: l.id } }).catch(() => {});
      await db.leadChecklistItem.deleteMany({ where: { leadId: l.id } }).catch(() => {});
      await db.auditLog.deleteMany({ where: { entity: "Lead", entityId: l.id } }).catch(() => {});
      await db.lead.delete({ where: { id: l.id } }).catch(() => {});
    }
  }
  if (icr) await db.employee.update({ where: { id: icr.employee.id }, data: { managerId: null } }).catch(() => {});
  if (icr) await destroyUser(icr);
  if (rm) await destroyUser(rm);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
