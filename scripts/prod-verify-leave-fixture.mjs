/**
 * Fixture for verifying the leave balance display on production.
 *
 *   node --env-file=.env scripts/prod-verify-leave-fixture.mjs up
 *   node --env-file=.env scripts/prod-verify-leave-fixture.mjs down
 *
 * Creates ONE disposable employee, backdated three years so a full accrual has
 * built up, with five approved vacation days and the balance row exactly as the
 * apply and approve routes leave it: totalDays 0, usedDays 5. That is the state
 * that used to render "-5d left".
 *
 * `down` deletes strictly by ids found under the PVERIFY prefix and reports the
 * counts back so the caller can assert the database returned to baseline rather
 * than assume it.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { generateSecret } from "otplib";
import crypto from "node:crypto";

const PREFIX = "pverify-";
const cmd = process.argv[2];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

function assertDisposable(email) {
  if (!email?.startsWith(PREFIX) || !email.endsWith("@illume.local")) {
    throw new Error(`refusing to touch ${email} — not a disposable verification account`);
  }
}

if (cmd === "up") {
  const email = `${PREFIX}employee-${Date.now()}@illume.local`;
  assertDisposable(email);
  const password = crypto.randomBytes(24).toString("base64url");
  const secret = generateSecret();

  const user = await db.user.create({
    data: {
      email, firstName: "Deploy", lastName: "Verification", name: "Deploy Verification",
      password: await bcrypt.hash(password, 12), role: "EMPLOYEE", isActive: true,
      twoFactorEnabled: true, twoFactorSecret: secret, passwordChangedAt: new Date(),
    },
    select: { id: true },
  });

  const joined = new Date(Date.UTC(new Date().getUTCFullYear() - 3, 0, 15));
  const employee = await db.employee.create({
    data: {
      userId: user.id,
      employeeId: `PVERIFY-${Date.now().toString().slice(-6)}`,
      jobTitle: "Deploy Verification",
      employmentType: "FULL_TIME",
      startDate: joined,
    },
    select: { id: true },
  });

  // A leave window that has already been decided, and the balance row in the
  // shape the two routes actually leave behind.
  const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 6));
  const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 10));
  await db.leaveRequest.create({
    data: {
      employeeId: employee.id, leaveType: "VACATION_PAID",
      startDate: start, endDate: end, days: 5,
      reason: "PVERIFY deploy verification — safe to delete",
      status: "APPROVED", approvedAt: new Date(),
    },
  });
  await db.leaveBalance.create({
    data: {
      employeeId: employee.id, leaveType: "VACATION_PAID",
      year: start.getUTCFullYear(), totalDays: 0, adjustmentDays: 0,
      usedDays: 5, pendingDays: 0,
    },
  });

  console.log(JSON.stringify({
    email, password, secret, employeeId: employee.id, joined: joined.toISOString().slice(0, 10),
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
    "reportApproval", "icrReportApproval",
  ]) {
    if (!db[model]?.deleteMany) continue;
    await db[model].deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  }
  for (const [model, field] of [["icrMonthlyReport", "icrId"]]) {
    if (!db[model]?.deleteMany) continue;
    await db[model].deleteMany({ where: { [field]: { in: ids } } }).catch(() => {});
  }
  await db.user.deleteMany({ where: { id: { in: ids } } });

  console.log(JSON.stringify({
    removed: ids.length,
    leftoverUsers: await db.user.count({ where: { email: { startsWith: PREFIX } } }),
    totalUsers: await db.user.count(),
    totalEmployees: await db.employee.count(),
    totalLeaveRequests: await db.leaveRequest.count(),
  }));
} else {
  console.log(JSON.stringify({ error: "usage: up | down" }));
}

await db.$disconnect();
await pool.end();
