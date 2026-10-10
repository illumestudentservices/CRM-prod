/**
 * The follow-up to the onboarding run: did the email arrive, and the Q&A invite.
 *
 *   node --import tsx scripts/send-erp-session-email.mjs                 # dry run
 *   node --import tsx scripts/send-erp-session-email.mjs --test <email>
 *   node --import tsx scripts/send-erp-session-email.mjs --commit [--join-url <url>]
 *
 * ★ MUST RUN ON THE VPS, from /var/www/illume-crm — BREVO_API_KEY and the
 * production database only exist there. Run it locally and it reads the test
 * database and sends nothing, while looking like it worked.
 *
 * ★ WHO GETS IT.
 *
 * By default, exactly the people the onboarding run emailed — read back from
 * the ONBOARDING_EMAIL_SENT ledger, not re-derived from a query. The body says
 * "we have sent you a welcome email", so it must only reach people for whom
 * that is true. Guessing the audience a second time is how somebody who never
 * received one gets told to check their junk folder for it.
 *
 * --everyone widens it to all active staff, for the Q&A invite alone. The 13
 * people who were already set up never had an onboarding email, so use that
 * only if you accept that the opening line does not apply to them.
 *
 * ★ THE LEDGER IS SEPARATE FROM THE ONBOARDING ONE.
 *
 * Action ERP_SESSION_EMAIL_SENT, so a re-run of either script cannot be
 * confused by the other's rows, and "who have we already told?" has one
 * answer per message.
 */
import "dotenv/config";

const { db } = await import("@/lib/db");
const { sendErpSessionEmail } = await import("@/lib/email");
const { staffGuideAttachment } = await import("@/lib/staff-guide");

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const list = (n) =>
  (val(n) ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const TEST = val("--test");
const COMMIT = flag("--commit");
const RESEND = flag("--resend");
const EVERYONE = flag("--everyone");
const JOIN_URL = val("--join-url");
const EXCLUDE = list("--exclude");
const LIMIT = Number(val("--limit") ?? 0) || 0;
const DELAY_MS = Number(val("--delay-ms") ?? 1200) || 1200;

const NEVER_EMAIL = new Set([
  "admin@illumestudentservices.cloud",
  "it@illumestudentservices.ca",
  "deepdarshansingrodia22@gmail.com",
]);

const guide = staffGuideAttachment();
if (!guide) {
  console.error("\nREFUSING TO RUN: the email promises an attached guide and it cannot be read.\n");
  await db.$disconnect();
  process.exit(2);
}
console.log(`staff guide: ${guide.name} — ${(guide.content.length / 1048576).toFixed(2)} MB encoded`);
console.log(
  JOIN_URL
    ? `join link:   ${JOIN_URL}`
    : `join link:   none given — the email will say a calendar invite follows separately`,
);
console.log();

const displayName = (u) =>
  u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;

// ── A single test send ──────────────────────────────────────────────────────
if (TEST) {
  const user = await db.user.findFirst({
    where: { email: TEST.toLowerCase(), deletedAt: null },
    select: { email: true, name: true, firstName: true, lastName: true },
  });
  if (!user) {
    console.error(`No account for ${TEST}.`);
    await db.$disconnect();
    process.exit(2);
  }
  console.log(`TEST SEND — one email to ${user.email}. Nobody else is touched.\n`);
  const ok = await sendErpSessionEmail({
    to: user.email,
    name: displayName(user),
    joinUrl: JOIN_URL,
    attachments: [guide],
  });
  console.log(ok ? "sent." : "NOT ACCEPTED by Brevo — see the error above.");
  await db.$disconnect();
  process.exit(ok ? 0 : 1);
}

// ── The audience ────────────────────────────────────────────────────────────
let users;
if (EVERYONE) {
  users = await db.user.findMany({
    where: { deletedAt: null, isActive: true, employee: { isActive: true } },
    select: { id: true, email: true, name: true, firstName: true, lastName: true },
    orderBy: { email: "asc" },
  });
  console.log(`--everyone: all ${users.length} active staff\n`);
} else {
  const ledger = await db.auditLog.findMany({
    where: { action: "ONBOARDING_EMAIL_SENT", entity: "User" },
    select: { entityId: true },
  });
  const ids = [...new Set(ledger.map((r) => r.entityId))];
  users = await db.user.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, email: true, name: true, firstName: true, lastName: true },
    orderBy: { email: "asc" },
  });
  console.log(`${users.length} person(s) received the onboarding email\n`);
}

const alreadyTold = new Set(
  (
    await db.auditLog.findMany({
      where: { action: "ERP_SESSION_EMAIL_SENT", entity: "User" },
      select: { entityId: true },
    })
  ).map((r) => r.entityId),
);

const skipped = { never: [], excluded: [], already: [] };
let queue = [];
for (const u of users) {
  const email = u.email.toLowerCase();
  if (NEVER_EMAIL.has(email)) { skipped.never.push(email); continue; }
  if (EXCLUDE.includes(email)) { skipped.excluded.push(email); continue; }
  if (alreadyTold.has(u.id) && !RESEND) { skipped.already.push(email); continue; }
  queue.push(u);
}

if (LIMIT && queue.length > LIMIT) {
  console.log(`--limit ${LIMIT}: holding back ${queue.length - LIMIT}\n`);
  queue = queue.slice(0, LIMIT);
}

console.log(`  not a person / never email:     ${skipped.never.length}`);
if (EXCLUDE.length) console.log(`  --exclude:                      ${skipped.excluded.length}`);
console.log(`  already told (use --resend):     ${skipped.already.length}`);
console.log(`\n  ${COMMIT ? "SENDING TO" : "WOULD SEND TO"}: ${queue.length}\n`);
console.log(COMMIT ? "MODE: COMMIT — emails will go out\n" : "MODE: dry run — nothing will be sent\n");

for (const u of queue) {
  console.log(`  ${displayName(u).slice(0, 28).padEnd(30)} ${u.email}`);
}

if (!COMMIT) {
  console.log(`\nDry run. Add --commit to send. Nothing was written.`);
  await db.$disconnect();
  process.exit(0);
}

// ── Send ────────────────────────────────────────────────────────────────────
const actor = await db.user.findFirst({
  where: { email: "it@illumestudentservices.ca", deletedAt: null },
  select: { id: true },
});

let sent = 0;
const failed = [];
console.log("\n" + "=".repeat(60));

for (const [i, u] of queue.entries()) {
  const label = u.email;
  try {
    const ok = await sendErpSessionEmail({
      to: u.email,
      name: displayName(u),
      joinUrl: JOIN_URL,
      attachments: [guide],
    });
    if (!ok) throw new Error("Brevo did not accept the message");

    // Written only after Brevo accepts it — a row claiming an email went out
    // when it did not would make the next run skip that person silently.
    await db.auditLog
      .create({
        data: {
          userId: actor?.id ?? null,
          action: "ERP_SESSION_EMAIL_SENT",
          entity: "User",
          entityId: u.id,
          changes: {
            email: u.email,
            session: "2026-10-13T11:30:00Z",
            joinUrl: JOIN_URL ?? null,
            attachment: guide.name,
            via: "scripts/send-erp-session-email.mjs",
          },
        },
      })
      .catch(() => {});

    sent++;
    console.log(`  ${String(i + 1).padStart(3)}/${queue.length}  sent    ${label}`);
  } catch (err) {
    failed.push({ label, why: err?.message ?? String(err) });
    console.log(`  ${String(i + 1).padStart(3)}/${queue.length}  FAILED  ${label} — ${err?.message}`);
  }
  if (i < queue.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
}

console.log("=".repeat(60));
console.log(`  sent:   ${sent}`);
console.log(`  failed: ${failed.length}`);
for (const f of failed) console.log(`      ${f.label} — ${f.why}`);
console.log("=".repeat(60));

await db.$disconnect();
