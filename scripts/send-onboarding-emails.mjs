/**
 * Send the onboarding (welcome) email, with the staff guide attached.
 *
 *   node --import tsx scripts/send-onboarding-emails.mjs            # dry run
 *   node --import tsx scripts/send-onboarding-emails.mjs --test <email>
 *   node --import tsx scripts/send-onboarding-emails.mjs --commit [--limit N]
 *
 * ★ MUST RUN ON THE VPS, from /var/www/illume-crm.
 *
 * BREVO_API_KEY only exists there, and so does the production database. Run it
 * locally and it reads the TEST database and silently sends nothing — the
 * worst possible outcome, because it looks like it worked.
 *
 * ★ DRY RUN IS THE DEFAULT, AND IT IS NOT A FORMALITY.
 *
 * Each send issues a magic link that expires in 72 hours and INVALIDATES any
 * link the person already had. Sending to the wrong list does not just spam
 * people; it hands eighty-odd staff a clock they did not know had started, and
 * the real invitation a week later is the second email they ignore. So the dry
 * run prints the exact recipients and writes nothing.
 *
 * ★ WHO IS IN SCOPE.
 *
 * Active employees whose account has never had a password set
 * (passwordChangedAt IS NULL). That is the definition of "has not onboarded",
 * and it is self-correcting: anybody who acts on the email drops out of the
 * list, so a second run chases only the people who have not, without anyone
 * having to keep a spreadsheet of who was emailed.
 *
 * A ledger row is still written per person (action ONBOARDING_EMAIL_SENT) and
 * re-sending is refused unless --resend is passed, so an accidental repeat run
 * an hour later does not email everybody again while they are still reading
 * the first one.
 */
import "dotenv/config";

const { db } = await import("@/lib/db");
const { createMagicLink } = await import("@/lib/magic-link");
const { sendWelcomeEmail } = await import("@/lib/email");
const { staffGuideAttachment } = await import("@/lib/staff-guide");

// ── Arguments ───────────────────────────────────────────────────────────────
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
const ONLY = list("--only");
const EXCLUDE = list("--exclude");
const LIMIT = Number(val("--limit") ?? 0) || 0;
const DELAY_MS = Number(val("--delay-ms") ?? 1200) || 1200;

/**
 * Accounts that are in the data but are not people to onboard. Emailing a
 * shared mailbox a personal "set your password" link is how a live credential
 * ends up in an inbox several people can read.
 */
const NEVER_EMAIL = new Set([
  "admin@illumestudentservices.cloud", // the seeded system account
  "it@illumestudentservices.ca",       // shared IT mailbox
  "deepdarshansingrodia22@gmail.com",  // the account used for QA
]);

// ── The attachment, once, before anything is sent ───────────────────────────
const guide = staffGuideAttachment();
if (!guide) {
  console.error(
    "\nREFUSING TO RUN: the staff guide could not be read, and delivering it\n" +
      "is the whole point of this run. Fix the path and try again.\n",
  );
  await db.$disconnect();
  process.exit(2);
}
console.log(`staff guide: ${guide.name} — ${(guide.content.length / 1048576).toFixed(2)} MB encoded\n`);

const displayName = (u) =>
  u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;

// ── A single test send ──────────────────────────────────────────────────────
if (TEST) {
  const user = await db.user.findFirst({
    where: { email: TEST.toLowerCase(), deletedAt: null },
    select: {
      id: true, email: true, name: true, firstName: true, lastName: true,
      employee: { select: { employeeId: true, jobTitle: true } },
    },
  });
  if (!user) {
    console.error(`No account for ${TEST}.`);
    console.error(`A test goes to a real account so the link inside it is real;`);
    console.error(`it must not borrow a staff member's.`);
    await db.$disconnect();
    process.exit(2);
  }

  console.log("TEST SEND — one email. Nobody else is touched.");
  console.log(`  to:      ${user.email}`);
  console.log(`  as:      ${displayName(user)}`);
  console.log(`  record:  ${user.employee?.employeeId ?? "(no employee row)"}`);
  console.log(`  link:    a real 72-hour link for THIS account\n`);

  const magicLinkUrl = await createMagicLink(user.id, 72);
  await sendWelcomeEmail({
    to: user.email,
    name: displayName(user),
    employeeId: user.employee?.employeeId ?? "ILL-0000",
    jobTitle: user.employee?.jobTitle ?? "Regional Manager",
    magicLinkUrl,
  });
  console.log("sent — subject starts \"Welcome to Illume\".");
  await db.$disconnect();
  process.exit(0);
}

// ── The real list ───────────────────────────────────────────────────────────
const candidates = await db.employee.findMany({
  where: {
    isActive: true,
    user: { deletedAt: null, isActive: true, passwordChangedAt: null },
  },
  select: {
    id: true, employeeId: true, jobTitle: true,
    user: { select: { id: true, email: true, name: true, firstName: true, lastName: true } },
  },
  orderBy: { employeeId: "asc" },
});

const already = new Set(
  (
    await db.auditLog.findMany({
      where: { action: "ONBOARDING_EMAIL_SENT", entity: "User" },
      select: { entityId: true },
    })
  ).map((r) => r.entityId),
);

const skipped = { never: [], excluded: [], notOnly: [], already: [] };
let queue = [];

for (const e of candidates) {
  const email = e.user.email.toLowerCase();
  if (NEVER_EMAIL.has(email)) { skipped.never.push(email); continue; }
  if (EXCLUDE.includes(email)) { skipped.excluded.push(email); continue; }
  if (ONLY.length && !ONLY.includes(email)) { skipped.notOnly.push(email); continue; }
  if (already.has(e.user.id) && !RESEND) { skipped.already.push(email); continue; }
  queue.push(e);
}

if (LIMIT && queue.length > LIMIT) {
  console.log(`--limit ${LIMIT}: holding back ${queue.length - LIMIT} for a later batch\n`);
  queue = queue.slice(0, LIMIT);
}

console.log(`${candidates.length} active account(s) have never set a password`);
console.log(`  not a person / never email:      ${skipped.never.length}`);
if (EXCLUDE.length) console.log(`  --exclude:                      ${skipped.excluded.length}`);
if (ONLY.length) console.log(`  outside --only:                 ${skipped.notOnly.length}`);
console.log(`  already emailed (use --resend):  ${skipped.already.length}`);
console.log(`\n  ${COMMIT ? "SENDING TO" : "WOULD SEND TO"}: ${queue.length}\n`);
console.log(COMMIT ? "MODE: COMMIT — emails will go out\n" : "MODE: dry run — nothing will be sent\n");

for (const e of queue) {
  console.log(`  ${e.employeeId.padEnd(10)} ${displayName(e.user).slice(0, 26).padEnd(28)} ${e.user.email}`);
}
if (skipped.never.length) {
  console.log(`\n  held back as not-a-person:`);
  for (const s of skipped.never) console.log(`      ${s}`);
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

for (const [i, e] of queue.entries()) {
  const label = `${e.employeeId} ${e.user.email}`;
  try {
    const magicLinkUrl = await createMagicLink(e.user.id, 72);
    await sendWelcomeEmail({
      to: e.user.email,
      name: displayName(e.user),
      employeeId: e.employeeId,
      jobTitle: e.jobTitle,
      magicLinkUrl,
    });

    // The ledger is written AFTER the send, not before: a row claiming an
    // email went out when it did not is worse than no row at all, because the
    // next run would skip that person and nobody would notice they were never
    // invited.
    await db.auditLog
      .create({
        data: {
          userId: actor?.id ?? null,
          action: "ONBOARDING_EMAIL_SENT",
          entity: "User",
          entityId: e.user.id,
          changes: {
            email: e.user.email,
            employeeId: e.employeeId,
            linkExpiresInHours: 72,
            attachment: guide.name,
            via: "scripts/send-onboarding-emails.mjs",
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

  // Brevo's transactional rate limit is generous, but a 3.6 MB attachment
  // eighty times in a tight loop is a good way to find the burst limit the
  // hard way. The pause costs two minutes across the whole run.
  if (i < queue.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
}

console.log("=".repeat(60));
console.log(`  sent:   ${sent}`);
console.log(`  failed: ${failed.length}`);
for (const f of failed) console.log(`      ${f.label} — ${f.why}`);

const remaining = await db.employee.count({
  where: { isActive: true, user: { deletedAt: null, isActive: true, passwordChangedAt: null } },
});
console.log(`\n  ${remaining} account(s) still have no password set.`);
console.log(`  Links expire in 72 hours. Re-run this after that to chase whoever`);
console.log(`  has not acted — they will still be in the list, and anyone who has`);
console.log(`  set a password will have dropped out of it.`);
console.log("=".repeat(60));

await db.$disconnect();
