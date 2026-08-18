/**
 * Sets up and tears down the fixture needed to verify the email gating on
 * production: two disposable accounts (an ICR and a Regional Manager in the
 * same region), one institution, and one monthly report owned by the ICR.
 *
 *   node --env-file=.env scripts/prod-verify-email-fixture.mjs up
 *   node --env-file=.env scripts/prod-verify-email-fixture.mjs down
 *
 * Runs on the server. Every row it creates is named with the PVERIFY prefix and
 * `down` deletes strictly by the ids it finds under that prefix — it will not
 * touch a row it did not make. `down` then reports the counts back so the caller
 * can assert the database returned to where it started rather than assume it.
 *
 * It reuses an EXISTING region rather than creating one: regions are reference
 * data that other rows point at, and inventing one on a live system to delete
 * five minutes later is a worse trade than borrowing one read-only.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { generateSecret } from "otplib";
import crypto from "node:crypto";

const PREFIX = "pverify-";
const MARK = "PVERIFY";
const cmd = process.argv[2];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

function assertDisposable(email) {
  if (!email?.startsWith(PREFIX) || !email.endsWith("@illume.local")) {
    throw new Error(`refusing to touch ${email} — not a disposable verification account`);
  }
}

async function makeUser(role, regionId) {
  const email = `${PREFIX}${role.toLowerCase()}-${Date.now()}-${crypto.randomBytes(2).toString("hex")}@illume.local`;
  assertDisposable(email);
  const password = crypto.randomBytes(24).toString("base64url");
  const secret = generateSecret();
  const user = await db.user.create({
    data: {
      email, firstName: "Deploy", lastName: "Verification", name: "Deploy Verification",
      password: await bcrypt.hash(password, 12), role, isActive: true,
      twoFactorEnabled: true, twoFactorSecret: secret, passwordChangedAt: new Date(),
      regionId,
    },
    select: { id: true, email: true, role: true },
  });
  return { ...user, password, secret };
}

if (cmd === "up") {
  const region = await db.region.findFirst({ select: { id: true, name: true } });
  if (!region) throw new Error("no region on this database to borrow");

  const icr = await makeUser("ICR", region.id);
  const rm = await makeUser("REGIONAL_MANAGER", region.id);

  const institution = await db.institution.create({
    data: {
      name: `${MARK} Verification College`, country: "Canada", type: "COLLEGE",
      createdById: icr.id, regionId: region.id,
    },
    select: { id: true },
  });

  const report = await db.monthlyReport.create({
    data: {
      icrId: icr.id, institutionId: institution.id, regionId: region.id,
      reportingMonth: 6, reportingYear: 2026, status: "FINAL_APPROVED",
      kpiSummary: { totalLeads: 1, enrolled: 0, conversionRate: 0, contactRate: 100, eventsCount: 0, totalEventCost: 0 },
      engagementNotes: `${MARK} deploy verification — safe to delete.`,
    },
    select: { id: true },
  });

  console.log(JSON.stringify({ icr, rm, institutionId: institution.id, reportId: report.id, region: region.name }));
} else if (cmd === "down") {
  const users = await db.user.findMany({
    where: { email: { startsWith: PREFIX } },
    select: { id: true, email: true },
  });
  for (const u of users) assertDisposable(u.email);
  const ids = users.map((u) => u.id);

  // Children first, then the rows that reference the users, then the users.
  await db.monthlyReport.deleteMany({ where: { icrId: { in: ids } } }).catch(() => {});
  await db.institution.deleteMany({ where: { name: { startsWith: MARK } } }).catch(() => {});

  for (const model of [
    "session", "account", "passwordHistory", "auditLog",
    "notification", "userSession", "securityEvent", "reportApproval",
    "icrReportApproval",
  ]) {
    if (!db[model]?.deleteMany) continue;
    await db[model].deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  }
  for (const [model, field] of [["icrMonthlyReport", "icrId"]]) {
    if (!db[model]?.deleteMany) continue;
    await db[model].deleteMany({ where: { [field]: { in: ids } } }).catch(() => {});
  }
  await db.user.deleteMany({ where: { id: { in: ids } } });

  // Assert, do not assume.
  const left = {
    users: await db.user.count({ where: { email: { startsWith: PREFIX } } }),
    institutions: await db.institution.count({ where: { name: { startsWith: MARK } } }),
    totalUsers: await db.user.count(),
    totalInstitutions: await db.institution.count(),
    totalReports: await db.monthlyReport.count(),
  };
  console.log(JSON.stringify({ removed: ids.length, ...left }));
} else {
  console.log(JSON.stringify({ error: "usage: up | down" }));
}

await db.$disconnect();
await pool.end();
