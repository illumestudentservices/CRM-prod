import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { purgeExpiredUsers, RECOVERY_WINDOW_DAYS } from "@/lib/user-lifecycle";
import { recordPasswordInHistory } from "@/lib/password-history";

/**
 * The purge is irreversible, so what matters is not "does it anonymise the
 * user" but "does it leave the company's records alone". This builds a user who
 * owns real business data, ages the deletion past the window, and checks every
 * dependent row survived.
 *
 * Every call is SCOPED to this probe's id. An unscoped run would sweep every
 * expired account in the database, which is not something a test should do on a
 * shared system.
 */

let pass = 0, fail = 0;
const ck = (l: string, c: boolean, d = "") => {
  c ? pass++ : fail++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`);
};
const DAY = 86_400_000;

(async () => {
  const email = `purge-probe-${Date.now()}@illumestudentservices.cloud`;
  const hashed = await bcrypt.hash("Purge!Probe123", 4);
  const region = await db.region.findFirst({ select: { id: true } });
  const source = await db.source.findFirst({ select: { id: true } });

  const user = await db.user.create({
    data: {
      email, name: "Purge Probe", password: hashed, role: "ICR",
      regionId: region?.id ?? null, isActive: true,
      twoFactorEnabled: true, twoFactorSecret: "SECRETSECRETSECR",
      twoFactorBackupCodes: ["AAAAA-BBBBB"],
      passwordChangedAt: new Date(),
    },
  });
  const only = { userIds: [user.id] };

  await recordPasswordInHistory(user.id, hashed);
  await db.notification.create({
    data: { userId: user.id, title: "probe", message: "probe", type: "TEST" },
  });

  // createdById is NOT NULL with ON DELETE RESTRICT — the row that would make a
  // hard delete of this user fail outright.
  const lead = await db.lead.create({
    data: {
      fullName: "PURGE PROBE LEAD - keep me",
      email: `purgelead-${Date.now()}@example.invalid`,
      phone: "+10000005555",
      nationality: "Kenyan", countryOfResidence: "Kenya",
      interestedProgram: "MSc Testing", studyLevel: "POSTGRADUATE",
      intakeYear: 2027, intakeMonth: 9, stage: "NEW_LEAD",
      sourceId: source?.id ?? null,
      createdById: user.id,
      assignedICRId: user.id,
      regionId: region?.id ?? null,
    },
  });
  await db.auditLog.create({
    data: { userId: user.id, action: "LOGIN", entity: "USER", entityId: user.id, changes: {} },
  });

  console.log("SETUP");
  ck("probe user owns a lead they created", !!lead.id);

  // Inside the window — must be left completely alone.
  await db.user.update({
    where: { id: user.id },
    data: { deletedAt: new Date(Date.now() - 5 * DAY), isActive: false },
  });
  let s = await purgeExpiredUsers({ dryRun: false, ...only });
  ck("a 5-day-old deletion is NOT purged", s.purged.length === 0);
  let after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  ck("email untouched inside the window", after.email === email);

  await db.user.update({
    where: { id: user.id },
    data: { deletedAt: new Date(Date.now() - (RECOVERY_WINDOW_DAYS + 1) * DAY) },
  });

  console.log("\nDRY RUN");
  s = await purgeExpiredUsers({ dryRun: true, ...only });
  ck("dry run reports the expired account", s.purged.length === 1);
  after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  ck("dry run changes nothing", after.email === email && after.purgedAt === null);

  console.log("\nREAL PURGE (scoped to this probe)");
  s = await purgeExpiredUsers({ dryRun: false, ...only });
  ck("expired account is purged", s.purged.length === 1);

  after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  ck("email anonymised", after.email === `deleted-${user.id}@invalid`, after.email);
  ck("name anonymised", after.name === "Deleted user");
  ck("password destroyed", after.password === null);
  ck("MFA secret destroyed", after.twoFactorSecret === null);
  ck("backup codes destroyed", after.twoFactorBackupCodes.length === 0);
  ck("MFA disabled", after.twoFactorEnabled === false);
  ck("account inactive", after.isActive === false);
  ck("sessions revoked", after.sessionsRevokedAt !== null);
  ck("marked purged", after.purgedAt !== null);
  ck("region cleared", after.regionId === null);
  ck("password history destroyed",
     (await db.passwordHistory.count({ where: { userId: user.id } })) === 0);
  ck("notifications destroyed",
     (await db.notification.count({ where: { userId: user.id } })) === 0);

  console.log("\nBUSINESS DATA MUST SURVIVE");
  const keptLead = await db.lead.findUnique({ where: { id: lead.id } });
  ck("the lead still exists", !!keptLead);
  ck("lead still attributes its creator", keptLead?.createdById === user.id);
  ck("lead was not cascade-deleted", keptLead?.fullName === "PURGE PROBE LEAD - keep me");
  const audits = await db.auditLog.count({ where: { entityId: user.id } });
  ck("audit trail preserved", audits > 0, `${audits} rows`);
  ck("purge itself is audited",
     !!(await db.auditLog.findFirst({ where: { entityId: user.id, action: "USER_PURGED" } })));

  console.log("\nIDEMPOTENCY");
  s = await purgeExpiredUsers({ dryRun: false, ...only });
  ck("an already-purged account is not processed again", s.purged.length === 0);

  console.log("\nCLEANUP");
  await db.leadActivity.deleteMany({ where: { leadId: lead.id } });
  await db.lead.delete({ where: { id: lead.id } });
  await db.auditLog.deleteMany({ where: { entityId: user.id } });
  await db.user.delete({ where: { id: user.id } });
  ck("probe removed",
     (await db.user.count({ where: { id: user.id } })) === 0 &&
     (await db.lead.count({ where: { id: lead.id } })) === 0);
  ck("no purge-probe users left",
     (await db.user.count({ where: { email: { contains: "purge-probe-" } } })) === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
