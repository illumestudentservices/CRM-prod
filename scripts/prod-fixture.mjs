/**
 * Fixture helper for hands-on testing against PRODUCTION. Runs ON THE VPS.
 *
 *   cd /var/www/illume-crm
 *   node --env-file=.env scripts/prod-fixture.mjs snapshot
 *   node --env-file=.env scripts/prod-fixture.mjs create <email> <password> <totpSecret>
 *   node --env-file=.env scripts/prod-fixture.mjs destroy <email>
 *
 * Production's database is not reachable from a local tunnel by design, and
 * Playwright is not installed on the VPS. So the work is split: the account is
 * made and unmade here, the clicking happens on a workstation against the
 * public URL, and `snapshot` is run either side so the footprint is measured
 * rather than assumed.
 *
 * Credentials are passed IN rather than generated and printed, so the values
 * never have to be echoed back out of the server.
 *
 * `destroy` removes everything the account touched, in foreign-key order, and
 * then re-reports the counts. A delete that silently failed on a constraint is
 * the normal way a "clean" test leaves rows behind on a live system, so the
 * counts are the real check — never assume the delete ran.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const [, , cmd, ...args] = process.argv;

const TABLES = [
  "user", "employee", "lead", "institutionInterest", "leadApplication",
  "leadActivity", "leadChecklistItem", "institution", "auditLog",
  "recruitmentPartner", "partnerContact",
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

async function snapshot() {
  const out = {};
  for (const t of TABLES) {
    try { out[t] = await db[t].count(); } catch { out[t] = "n/a"; }
  }
  return out;
}

try {
  const [{ d }] = await db.$queryRawUnsafe("SELECT current_database() AS d");

  if (cmd === "snapshot") {
    console.log(JSON.stringify({ database: d, counts: await snapshot() }, null, 2));
  } else if (cmd === "create") {
    const [email, password, secret] = args;
    if (!email || !password || !secret) {
      console.error("usage: create <email> <password> <totpSecret>");
      process.exit(2);
    }
    const user = await db.user.create({
      data: {
        email,
        firstName: "QA", lastName: "Walkthrough", name: "QA Walkthrough",
        password: await bcrypt.hash(password, 12),
        role: "SUPER_ADMIN",
        isActive: true,
        // Enrolled up front so the login is a normal one — the point is to test
        // the pipeline, not to re-test enrolment.
        twoFactorEnabled: true,
        twoFactorSecret: secret,
        mfaMethod: "TOTP",
        passwordChangedAt: new Date(),
      },
      select: { id: true, email: true },
    });
    console.log(JSON.stringify({ database: d, created: user }));
  } else if (cmd === "destroy") {
    const [email] = args;
    if (!email) { console.error("usage: destroy <email>"); process.exit(2); }

    const user = await db.user.findFirst({ where: { email }, select: { id: true } });
    if (!user) { console.log(JSON.stringify({ note: "no such user", counts: await snapshot() })); process.exit(0); }

    // Every lead this account created, and everything hanging off it. Children
    // first: a lead delete blocked by a child constraint is exactly how a
    // "cleaned up" test leaves rows on a live system.
    const leads = await db.lead.findMany({
      where: { OR: [{ createdById: user.id }, { assignedICRId: user.id }] },
      select: { id: true },
    });
    const leadIds = leads.map((l) => l.id);

    const removed = {};
    if (leadIds.length) {
      const steps = [
        ["leadChecklistItem", () => db.leadChecklistItem.deleteMany({ where: { leadId: { in: leadIds } } })],
        ["leadActivity", () => db.leadActivity.deleteMany({ where: { leadId: { in: leadIds } } })],
        ["leadApplication", () => db.leadApplication.deleteMany({ where: { leadId: { in: leadIds } } })],
        ["institutionInterest", () => db.institutionInterest.deleteMany({ where: { leadId: { in: leadIds } } })],
        ["leadNote", () => db.leadNote.deleteMany({ where: { leadId: { in: leadIds } } })],
        ["task", () => db.task.deleteMany({ where: { leadId: { in: leadIds } } })],
        ["activity", () => db.activity.deleteMany({ where: { leadId: { in: leadIds } } })],
        ["deletedRecord", () => db.deletedRecord.deleteMany({ where: { entityId: { in: leadIds } } })],
        ["lead", () => db.lead.deleteMany({ where: { id: { in: leadIds } } })],
      ];
      for (const [name, run] of steps) {
        try { removed[name] = (await run()).count; }
        catch (e) { removed[name] = `FAILED: ${e.code ?? e.message}`; }
      }
    }

    for (const [name, run] of [
      ["auditLog", () => db.auditLog.deleteMany({ where: { userId: user.id } })],
      ["account", () => db.account.deleteMany({ where: { userId: user.id } })],
      ["session", () => db.session.deleteMany({ where: { userId: user.id } })],
      ["passwordHistory", () => db.passwordHistory.deleteMany({ where: { userId: user.id } })],
      ["employee", () => db.employee.deleteMany({ where: { userId: user.id } })],
      ["user", () => db.user.deleteMany({ where: { id: user.id } })],
    ]) {
      try { removed[name] = (await run()).count; }
      catch (e) { removed[name] = `FAILED: ${e.code ?? e.message}`; }
    }

    console.log(JSON.stringify({ database: d, removed, counts: await snapshot() }, null, 2));
  } else {
    console.error("usage: prod-fixture.mjs snapshot | create <email> <password> <secret> | destroy <email>");
    process.exit(2);
  }
} finally {
  await db.$disconnect();
  await pool.end();
}
