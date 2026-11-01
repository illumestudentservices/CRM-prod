import { db, createAndLogin, destroyUser, api, TAG } from "./qa-lib.mjs";
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, extra = "") => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m + (extra ? " → " + extra : "")); } };

async function main() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const am = await createAndLogin({ role: "ACCOUNT_MANAGER", withEmployee: true });
  const rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  const made: string[] = [];
  const mkInst = async (health: string, run: number, label: string) => {
    const i = await db.institution.create({ data: { name: `${TAG} ${label} ${run}`, country: "QA", type: "UNIVERSITY", createdById: admin.user.id, accountManagerId: am.user.id, regionalManagerId: rm.user.id, accountHealth: health as never } });
    made.push(i.id); return i;
  };
  const healthNotifs = (instId: string) => db.notification.findMany({ where: { type: "ACCOUNT_HEALTH", link: { contains: instId } }, select: { userId: true } });
  try {
    for (let run = 1; run <= 3; run++) {
      console.log(`-- run ${run} --`);
      // Positive: GREEN -> RED worsening notifies AM + RM.
      const drop = await mkInst("GREEN", run, "drop");
      const r = await api(admin.jar, "PATCH", `/api/institutions/${drop.id}/health`, {
        health: "RED",
        intervention: { reason: "QA churn risk", correctiveAction: "QA plan", actionOwnerId: admin.user.id, reviewDate: new Date(Date.now() + 7 * 86400000).toISOString() },
      });
      ok(r.ok, "health PATCH to RED accepted", `got ${r.status} ${JSON.stringify(r.payload)?.slice(0,100)}`);
      const n = await healthNotifs(drop.id);
      const ids = new Set(n.map((x) => x.userId));
      ok(ids.has(am.user.id) && ids.has(rm.user.id), "account manager AND regional manager notified on drop", `recipients ${[...ids]}`);
      ok(!ids.has(admin.user.id), "the actor (action owner) is not double-notified", `recipients ${[...ids]}`);

      // Negative: starting RED, improving to GREEN notifies nobody.
      const up = await mkInst("RED", run, "up");
      const r2 = await api(admin.jar, "PATCH", `/api/institutions/${up.id}/health`, { health: "GREEN" });
      ok(r2.ok, "health PATCH to GREEN accepted", `got ${r2.status}`);
      const n2 = await healthNotifs(up.id);
      ok(n2.length === 0, "improvement (RED->GREEN) raises NO health-drop alert", `got ${n2.length}`);
    }
  } finally {
    for (const id of made) {
      await db.notification.deleteMany({ where: { link: { contains: id } } }).catch(() => {});
      await db.accountIntervention.deleteMany({ where: { institutionId: id } }).catch(() => {});
      await db.institution.delete({ where: { id } }).catch(() => {});
    }
    for (const u of [admin, am, rm]) await destroyUser(u);
    console.log(`\nTOTAL ${pass} pass / ${fail} fail`);
    await db.$disconnect();
    process.exit(fail ? 1 : 0);
  }
}
main().catch(async (e) => { console.error("[fatal]", e?.stack || e); await db.$disconnect(); process.exit(1); });
