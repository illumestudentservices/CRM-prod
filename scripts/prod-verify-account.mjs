/**
 * Creates or destroys ONE disposable verification account on production.
 *
 *   node --env-file=.env scripts/prod-verify-account.mjs create ICR
 *   node --env-file=.env scripts/prod-verify-account.mjs destroy <email>
 *
 * Runs on the server, because local credentials are denied on production
 * tables. Deliberately narrow: it will only ever touch an account whose email
 * carries the PVERIFY- prefix, so it cannot be pointed at a real user by
 * accident or by a mistyped argument. MFA is enrolled properly rather than
 * bypassed — the point is to prove the real login path works, and an account
 * that skipped 2FA would prove the wrong thing.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { generateSecret } from "otplib";
import crypto from "node:crypto";

const PREFIX = "pverify-";
const [cmd, arg] = process.argv.slice(2);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

function assertDisposable(email) {
  if (!email || !email.startsWith(PREFIX) || !email.endsWith("@illume.local")) {
    throw new Error(`refusing to touch ${email} — not a disposable verification account`);
  }
}

if (cmd === "create") {
  const role = arg ?? "ICR";
  const email = `${PREFIX}${role.toLowerCase()}-${Date.now()}@illume.local`;
  const password = crypto.randomBytes(24).toString("base64url");
  const secret = generateSecret();
  assertDisposable(email);
  const user = await db.user.create({
    data: {
      email,
      firstName: "Deploy",
      lastName: "Verification",
      name: "Deploy Verification",
      password: await bcrypt.hash(password, 12),
      role,
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      passwordChangedAt: new Date(),
    },
    select: { id: true, email: true, role: true },
  });
  console.log(JSON.stringify({ ...user, password, secret }));
} else if (cmd === "destroy") {
  assertDisposable(arg);
  const user = await db.user.findUnique({ where: { email: arg }, select: { id: true } });
  if (!user) {
    console.log(JSON.stringify({ destroyed: false, reason: "not found" }));
  } else {
    const id = user.id;
    // Rows created as a side effect of merely logging in, which would otherwise
    // hold the user row hostage behind a foreign key. Named models are checked
    // for existence first: a model that is not on this schema must not abort
    // the cleanup and strand a live account on production, which is exactly
    // what happened the first time this ran.
    for (const model of [
      "session", "account", "passwordHistory", "auditLog",
      "notification", "loginAttempt", "userSession", "securityEvent",
      "icrReportApproval",
    ]) {
      if (!db[model]?.deleteMany) continue;
      await db[model].deleteMany({ where: { userId: id } }).catch(() => {});
    }
    // Rows that reference the user by a name other than `userId`, and so are
    // invisible to the loop above. icr_monthly_reports.icrId is ON DELETE
    // RESTRICT, so a report left behind blocks the whole teardown.
    for (const [model, field] of [["icrMonthlyReport", "icrId"]]) {
      if (!db[model]?.deleteMany) continue;
      await db[model].deleteMany({ where: { [field]: id } }).catch(() => {});
    }
    await db.user.delete({ where: { id } });
    const left = await db.user.count({ where: { id } });
    console.log(JSON.stringify({ destroyed: left === 0, remaining: left }));
  }
} else {
  console.log(JSON.stringify({ error: "usage: create <ROLE> | destroy <email>" }));
}

await db.$disconnect();
await pool.end();
