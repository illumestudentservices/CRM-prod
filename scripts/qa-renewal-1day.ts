import { db, createAndLogin, destroyUser, TAG } from "./qa-lib.mjs";
import { sendRenewalReminders } from "@/lib/network-automation";

const DAY = 86_400_000;
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, extra = "") => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m + (extra ? " → " + extra : "")); } };

async function main() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const uid = admin.user.id;
  try {
    for (let run = 1; run <= 3; run++) {
      console.log(`-- run ${run} --`);
      const base = await sendRenewalReminders({ dryRun: true });

      const startOfToday = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
      const tag = `${TAG}R${run}`;
      // Institution renewal exactly 1 day out, already announced at the 30-day stage.
      const instRenew = await db.institution.create({ data: {
        name: `${tag} Renew`, country: "QA", type: "UNIVERSITY", createdById: uid, accountManagerId: uid,
        accountStatus: "ACTIVE", renewalDate: new Date(startOfToday + DAY + 3_600_000), renewalNoticeStage: 30,
      } });
      // Contract exactly 1 day out (a milestone now) and one 2 days out (NOT a milestone).
      const instC = await db.institution.create({ data: { name: `${tag} Ctr`, country: "QA", type: "UNIVERSITY", createdById: uid, accountManagerId: uid, accountStatus: "ACTIVE" } });
      const c1 = await db.contract.create({ data: { institutionId: instC.id, title: `${tag} c1`, startDate: new Date(), endDate: new Date(Date.now() + DAY + 3_600_000), status: "ACTIVE", createdById: uid } });
      const c2 = await db.contract.create({ data: { institutionId: instC.id, title: `${tag} c2`, startDate: new Date(), endDate: new Date(Date.now() + 2 * DAY + 3_600_000), status: "ACTIVE", createdById: uid } });

      const after = await sendRenewalReminders({ dryRun: true });

      ok(after.renewalsNoticed - base.renewalsNoticed === 1, "1-day institution renewal now fires (renewalsNoticed +1)", `delta ${after.renewalsNoticed - base.renewalsNoticed}`);
      ok(after.remindersSent - base.remindersSent === 1, "1-day contract now fires, 2-day does NOT (remindersSent +1)", `delta ${after.remindersSent - base.remindersSent}`);
      ok(after.contractsExpiringSoon - base.contractsExpiringSoon === 2, "both contracts are in-window candidates (contractsExpiringSoon +2)", `delta ${after.contractsExpiringSoon - base.contractsExpiringSoon}`);

      await db.contract.delete({ where: { id: c1.id } }).catch(() => {});
      await db.contract.delete({ where: { id: c2.id } }).catch(() => {});
      await db.institution.delete({ where: { id: instC.id } }).catch(() => {});
      await db.institution.delete({ where: { id: instRenew.id } }).catch(() => {});
    }
  } finally {
    await destroyUser(admin);
    console.log(`\nTOTAL ${pass} pass / ${fail} fail`);
    await db.$disconnect();
    process.exit(fail ? 1 : 0);
  }
}
main().catch(async (e) => { console.error("[fatal]", e?.stack || e); await db.$disconnect(); process.exit(1); });
