/**
 * Disposable fixture for verifying the gender fix on production.
 *
 *   node scripts/prod-verify-gender-fixture.mjs up
 *   node scripts/prod-verify-gender-fixture.mjs down
 *
 * Runs ON the VPS, where DATABASE_URL already points at the live database.
 *
 * Creates ONE disposable HR_MANAGER (the least privilege that can open the
 * employee edit dialog and write gender) plus ONE disposable employee carrying
 * a known gender. Nothing real is touched: every write is guarded by the
 * PVERIFY prefix and `down` reports the counts back so the caller can assert
 * the database returned to baseline rather than assume it.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { generateSecret } from "otplib";
import crypto from "node:crypto";

const PREFIX = "pverify-gender-";
const cmd = process.argv[2];
// Prisma 7 requires an explicit driver adapter.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

function assertDisposable(email) {
  if (!email?.startsWith(PREFIX) || !email.endsWith("@illume.local")) {
    throw new Error(`refusing to touch ${email} — not a disposable verification account`);
  }
}

if (cmd === "up") {
  const stamp = Date.now();
  const hrEmail = `${PREFIX}hr-${stamp}@illume.local`;
  const subjEmail = `${PREFIX}subject-${stamp}@illume.local`;
  assertDisposable(hrEmail);
  assertDisposable(subjEmail);

  const password = crypto.randomBytes(24).toString("base64url");
  const secret = generateSecret();

  const hr = await db.user.create({
    data: {
      email: hrEmail, firstName: "Deploy", lastName: "Verify", name: "Deploy Verify",
      password: await bcrypt.hash(password, 12), role: "HR_MANAGER", isActive: true,
      twoFactorEnabled: true, twoFactorSecret: secret, passwordChangedAt: new Date(),
    },
    select: { id: true },
  });

  const subjUser = await db.user.create({
    data: {
      email: subjEmail, firstName: "Gender", lastName: "Subject", name: "Gender Subject",
      password: await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 12),
      role: "EMPLOYEE", isActive: true, passwordChangedAt: new Date(),
    },
    select: { id: true },
  });

  const subject = await db.employee.create({
    data: {
      userId: subjUser.id,
      employeeId: `PVG-${String(stamp).slice(-6)}`,
      jobTitle: "Deploy Verification",
      employmentType: "FULL_TIME",
      startDate: new Date(Date.UTC(new Date().getUTCFullYear() - 3, 0, 15)),
      // The whole point: a gender that is already stored before the screen is
      // opened, so the test measures whether the screen reads it back.
      gender: "FEMALE",
    },
    select: { id: true },
  });

  console.log(JSON.stringify({
    email: hrEmail, password, secret, employeeId: subject.id, expectedGender: "FEMALE",
  }));
} else if (cmd === "down") {
  const users = await db.user.findMany({
    where: { email: { startsWith: PREFIX } },
    select: { id: true, email: true },
  });
  for (const u of users) assertDisposable(u.email);
  const ids = users.map((u) => u.id);

  const employees = await db.employee.findMany({
    where: { userId: { in: ids } }, select: { id: true },
  });
  const empIds = employees.map((e) => e.id);
  if (empIds.length) {
    await db.leaveRequest.deleteMany({ where: { employeeId: { in: empIds } } }).catch(() => {});
    await db.leaveBalance.deleteMany({ where: { employeeId: { in: empIds } } }).catch(() => {});
    await db.employee.deleteMany({ where: { id: { in: empIds } } }).catch(() => {});
  }
  for (const model of [
    "session", "account", "passwordHistory", "auditLog",
    "notification", "userSession", "securityEvent",
  ]) {
    if (!db[model]?.deleteMany) continue;
    await db[model].deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  }
  await db.user.deleteMany({ where: { id: { in: ids } } });

  console.log(JSON.stringify({
    removed: ids.length,
    leftover: await db.user.count({ where: { email: { startsWith: PREFIX } } }),
    totalUsers: await db.user.count(),
    totalEmployees: await db.employee.count(),
  }));
} else {
  console.log(JSON.stringify({ error: "usage: up | down" }));
}

await db.$disconnect();
await pool.end();
