/**
 * Moves ONE production account to emailed sign-in codes, safely.
 *
 *   node --env-file=.env scripts/prod-enable-email-otp.mjs <email>
 *   node --env-file=.env scripts/prod-enable-email-otp.mjs <email> --commit
 *   node --env-file=.env scripts/prod-enable-email-otp.mjs <email> --revert
 *
 * DRY RUN IS THE DEFAULT.
 *
 * ── WHY THIS EXISTS RATHER THAN JUST CLICKING THE BUTTON ────────────────────
 *
 * The Settings screen is the normal way. This is for the FIRST account, where
 * nobody has yet seen the mail actually arrive from production, and where the
 * account in question is a SUPER_ADMIN who would be locked out of a live system
 * if it did not.
 *
 * So the order is deliberate and it is the whole point of the script:
 *
 *   1. Refuse outright unless the account has backup codes. They are the way
 *      back in if the mail never arrives, and switching without them is betting
 *      a production admin account on an untested mail route.
 *   2. Send a REAL test email first and check the provider accepted it.
 *   3. Only then change the method.
 *
 * A failure at step 2 leaves the account exactly as it was. The common failure
 * here is not code — it is a provider rejecting the recipient domain, which no
 * amount of local testing would catch.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const [, , email, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");
const REVERT = flags.includes("--revert");

if (!email) {
  console.error("usage: prod-enable-email-otp.mjs <email> [--commit] [--revert]");
  process.exit(2);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

try {
  const [{ d }] = await db.$queryRawUnsafe("SELECT current_database() AS d");
  console.log(`\n${COMMIT ? "COMMIT" : "DRY RUN"} — database ${d}\n`);

  const user = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, deletedAt: null },
    select: {
      id: true, email: true, name: true, role: true,
      twoFactorEnabled: true, twoFactorSecret: true, twoFactorBackupCodes: true,
      mfaMethod: true, mfaAttempts: true, mfaLockedUntil: true,
    },
  });
  if (!user) {
    console.error(`No live account for ${email}`);
    process.exit(1);
  }

  const backupCodes = user.twoFactorBackupCodes.length;
  console.log(`  account        ${user.email} (${user.role})`);
  console.log(`  MFA enabled    ${user.twoFactorEnabled}`);
  console.log(`  method now     ${user.mfaMethod}`);
  console.log(`  backup codes   ${backupCodes}`);
  console.log(`  app secret     ${user.twoFactorSecret ? "present" : "MISSING"}`);
  console.log(`  locked         ${user.mfaLockedUntil ?? "no"}`);
  console.log();

  if (REVERT) {
    console.log("REVERT — back to the authenticator app, and destroy any live emailed code.");
    if (!COMMIT) { console.log("\nDry run. Add --commit to apply.\n"); process.exit(0); }
    await db.user.update({
      where: { id: user.id },
      data: {
        mfaMethod: "TOTP",
        emailOtpHash: null, emailOtpExpiresAt: null, emailOtpAttempts: 0,
        mfaAttempts: 0, mfaLockedUntil: null,
      },
    });
    console.log("Done — the account is back on its authenticator app.\n");
    process.exit(0);
  }

  // ── Guards ───────────────────────────────────────────────────────────────
  if (!user.twoFactorEnabled) {
    console.error("STOP: this account has not finished MFA setup. Enrol it first.");
    process.exit(1);
  }
  if (backupCodes === 0) {
    console.error(
      "STOP: no backup codes. They are the only way back in if the email never arrives.\n" +
      "      Reset this account's MFA and re-enrol so a fresh set is issued, then run this again."
    );
    process.exit(1);
  }
  if (!user.twoFactorSecret) {
    console.error("STOP: no authenticator secret, so there would be no way to switch back without re-enrolling.");
    process.exit(1);
  }

  if (!COMMIT) {
    console.log("PLAN");
    console.log("  1. send a real test code to this mailbox and check the provider accepted it");
    console.log(`  2. if accepted, set mfaMethod EMAIL (currently ${user.mfaMethod})`);
    console.log(`  Way back in if anything fails: ${backupCodes} backup codes, or --revert.`);
    console.log("\nDry run — nothing sent, nothing changed. Add --commit to apply.\n");
    process.exit(0);
  }

  // ── 1. Prove the mail actually goes ──────────────────────────────────────
  const { sendMfaCodeEmail } = await import("../lib/email.ts");
  const { issueEmailOtp, EMAIL_OTP_TTL_MS } = await import("../lib/mfa.ts");

  // Clear the cooldown so this send is never refused by a previous one.
  await db.user.update({ where: { id: user.id }, data: { emailOtpSentAt: null } });

  const issued = await issueEmailOtp(user.id);
  if (!issued.ok) {
    console.error(`STOP: could not issue a code (${issued.reason}).`);
    process.exit(1);
  }

  console.log("Sending a real code to the mailbox...");
  const sent = await sendMfaCodeEmail({
    to: user.email,
    name: user.name ?? user.email,
    code: issued.code,
    expiryMinutes: Math.round(EMAIL_OTP_TTL_MS / 60000),
    ip: null,
  });

  if (!sent) {
    // Leave the account alone. This is the failure worth catching: a provider
    // refusing the recipient domain looks fine in every local test.
    await db.user.update({
      where: { id: user.id },
      data: { emailOtpHash: null, emailOtpExpiresAt: null, emailOtpAttempts: 0 },
    });
    console.error(
      "\nSTOP: the mail provider did not accept the message.\n" +
      "      The account has NOT been changed and is still on its authenticator app.\n" +
      "      Check BREVO_API_KEY and whether the sender domain may send to this recipient.\n"
    );
    process.exit(1);
  }

  console.log("  provider accepted the message.");
  // The code is NOT printed. It is a live credential for ten minutes, and this
  // output goes to a terminal and a shell history.
  console.log("  the code is in the mailbox — it is deliberately not printed here.\n");

  // ── 2. Switch the method ─────────────────────────────────────────────────
  await db.user.update({ where: { id: user.id }, data: { mfaMethod: "EMAIL" } });
  await db.auditLog.create({
    data: {
      userId: user.id,
      action: "MFA_METHOD_CHANGED",
      entity: "USER",
      entityId: user.id,
      changes: {
        from: user.mfaMethod,
        to: "EMAIL",
        subjectEmail: user.email,
        reason: "Requested by the account holder; set up and mail delivery verified from production.",
      },
    },
  });

  console.log("Done. This account now signs in with a code sent by email.");
  console.log(`  ${backupCodes} backup codes still work if the mailbox is unreachable.`);
  console.log("  To undo:  node --env-file=.env scripts/prod-enable-email-otp.mjs " + user.email + " --revert --commit\n");
} finally {
  await db.$disconnect();
  await pool.end();
}
