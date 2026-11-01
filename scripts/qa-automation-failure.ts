/**
 * QA for 3b — reportAutomationFailure.
 *
 * Asserts that when a scheduled job's catch calls reportAutomationFailure(job, err):
 *   1. an AUTOMATION_FAILED audit row is written (userId null, entity CronJob,
 *      entityId = job, changes.message = the error text, truncated to 500);
 *   2. the helper never throws, even with a non-Error value;
 *   3. a second failure of the same job writes a SECOND independent row
 *      (every failed run is recorded, not deduped).
 *
 * Email is forced off (BREVO_API_KEY unset at runtime) so no real admin is
 * mailed — the notifyAdmins path still runs and must not throw.
 *
 * Run against the TEST database:
 *   BREVO_API_KEY= npx tsx --env-file=.env.local scripts/qa-automation-failure.ts
 */
import { db } from "@/lib/db";
import { reportAutomationFailure } from "@/lib/automation-failure";

let pass = 0;
let fail = 0;
function expect(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function run() {
  // A job name unique to this run so we only ever see our own rows.
  const job = `qa-automation-failure-${Date.now()}`;

  // --- 1. Error object ---------------------------------------------------
  await reportAutomationFailure(job, new Error("boom from qa"));
  let rows = await db.auditLog.findMany({
    where: { action: "AUTOMATION_FAILED", entityId: job },
    orderBy: { createdAt: "asc" },
  });
  expect("writes exactly one audit row for the first failure", rows.length === 1, `(got ${rows.length})`);
  if (rows[0]) {
    expect("audit row userId is null (system)", rows[0].userId === null);
    expect("audit row entity is CronJob", rows[0].entity === "CronJob");
    expect("audit row entityId is the job name", rows[0].entityId === job);
    const msg = (rows[0].changes as { message?: string } | null)?.message;
    expect("audit row records the error message", msg === "boom from qa", `(got ${JSON.stringify(msg)})`);
  }

  // --- 2. Non-Error value must not throw, still records -------------------
  let threw = false;
  try {
    await reportAutomationFailure(job, "a plain string failure");
  } catch {
    threw = true;
  }
  expect("does not throw on a non-Error value", !threw);

  // --- 3. Long message is truncated to 500 chars -------------------------
  const longJob = `${job}-long`;
  await reportAutomationFailure(longJob, new Error("x".repeat(900)));
  const longRow = await db.auditLog.findFirst({
    where: { action: "AUTOMATION_FAILED", entityId: longJob },
  });
  const longMsg = (longRow?.changes as { message?: string } | null)?.message ?? "";
  expect("long error message truncated to 500 chars", longMsg.length === 500, `(got ${longMsg.length})`);

  // --- 4. Every failed run is its own row (no dedupe) --------------------
  rows = await db.auditLog.findMany({ where: { action: "AUTOMATION_FAILED", entityId: job } });
  expect("second failure of same job writes a second row", rows.length === 2, `(got ${rows.length})`);

  // --- cleanup -----------------------------------------------------------
  await db.auditLog.deleteMany({ where: { action: "AUTOMATION_FAILED", entityId: { in: [job, longJob] } } });
  // notifyAdmins also writes in-app notifications whose message carries the job
  // name — remove ours so the test leaves no residue in the test DB.
  await db.notification.deleteMany({ where: { type: "ADMIN_ALERT", message: { contains: job } } });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => {
  console.error("qa-automation-failure crashed", e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
