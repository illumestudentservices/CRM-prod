/**
 * QA — multi-region clients + renewal-date editing, via the real API. 3×.
 *
 *   A. POST /api/institutions with regionIds=[r1,r2,r3] → primary=r1, join={r1,r2,r3}
 *   B. PATCH regionIds=[r2,r3] (drop r1, promote r2) → primary=r2, join={r2,r3}
 *   C. PATCH with same set keeps rows (createdAt of r2 unchanged — no churn)
 *   D. PATCH regionIds=[] → primary=null, join={}
 *   E. renewalDate: allowed role (SUPER_ADMIN) sets it; blank clears it
 *   F. role gate: a REGIONAL_MANAGER (institutions:write, but NOT renewalDate)
 *      is refused (403) when sending renewalDate, but CAN change regionIds
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-institution-regions.mjs
 */
import { db, BASE, createAndLogin, destroyUser, api } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const set = (arr) => [...arr].sort().join(",");

async function joinRegions(instId) {
  const rows = await db.institutionRegion.findMany({ where: { institutionId: instId }, select: { regionId: true } });
  return rows.map((r) => r.regionId);
}

async function run() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  const tag = admin.user.name;
  // Three throwaway regions.
  const mk = (n) => db.region.create({ data: { name: `QA Reg ${n} ${tag}`, code: `QR${n}${Date.now().toString().slice(-5)}` } });
  const [r1, r2, r3] = await Promise.all([mk("A"), mk("B"), mk("C")]);
  // An RM sitting in r1 so the client is visible to them.
  const rm = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: r1.id } });

  const created = [];
  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);

      // A. Create with three regions, primary first.
      const cr = await api(admin.jar, "POST", "/api/institutions", {
        name: `QA MultiRegion ${tag} ${round}`, country: "Testland", type: "University",
        regionIds: [r1.id, r2.id, r3.id],
      });
      expect("A: create 201", cr.status === 201, `(${cr.status} ${JSON.stringify(cr.payload)?.slice?.(0,120)})`);
      const instId = cr.payload?.id;
      created.push(instId);
      expect("A: primary regionId = r1", cr.payload?.regionId === r1.id, `(${cr.payload?.regionId})`);
      expect("A: join = {r1,r2,r3}", set(await joinRegions(instId)) === set([r1.id, r2.id, r3.id]));

      // B. Drop r1, promote r2 to primary.
      const pb = await api(admin.jar, "PATCH", `/api/institutions/${instId}`, { regionIds: [r2.id, r3.id] });
      expect("B: patch 200", pb.status === 200, `(${pb.status})`);
      expect("B: primary regionId = r2", pb.payload?.regionId === r2.id, `(${pb.payload?.regionId})`);
      expect("B: join = {r2,r3}", set(await joinRegions(instId)) === set([r2.id, r3.id]));

      // C. Same set again — r2's row must be kept (not deleted+recreated).
      const beforeRow = await db.institutionRegion.findFirst({ where: { institutionId: instId, regionId: r2.id }, select: { createdAt: true } });
      await api(admin.jar, "PATCH", `/api/institutions/${instId}`, { regionIds: [r2.id, r3.id] });
      const afterRow = await db.institutionRegion.findFirst({ where: { institutionId: instId, regionId: r2.id }, select: { createdAt: true } });
      expect("C: kept region row not churned (createdAt stable)", beforeRow && afterRow && beforeRow.createdAt.getTime() === afterRow.createdAt.getTime());

      // D. Clear all regions.
      const pd = await api(admin.jar, "PATCH", `/api/institutions/${instId}`, { regionIds: [] });
      expect("D: primary regionId = null", pd.payload?.regionId === null, `(${pd.payload?.regionId})`);
      expect("D: join = {}", (await joinRegions(instId)).length === 0);

      // E. Renewal date set + clear (as SUPER_ADMIN).
      const pe = await api(admin.jar, "PATCH", `/api/institutions/${instId}`, { renewalDate: "2027-06-30" });
      expect("E: renewalDate patch 200", pe.status === 200, `(${pe.status})`);
      const afterSet = await db.institution.findUnique({ where: { id: instId }, select: { renewalDate: true } });
      expect("E: renewalDate saved = 2027-06-30", afterSet?.renewalDate?.toISOString().slice(0, 10) === "2027-06-30", `(${afterSet?.renewalDate})`);
      await api(admin.jar, "PATCH", `/api/institutions/${instId}`, { renewalDate: null });
      const afterClear = await db.institution.findUnique({ where: { id: instId }, select: { renewalDate: true } });
      expect("E: renewalDate cleared", afterClear?.renewalDate === null);

      // F. Role gate — put the client in r1 so the RM can see it.
      await api(admin.jar, "PATCH", `/api/institutions/${instId}`, { regionIds: [r1.id] });
      const fRej = await api(rm.jar, "PATCH", `/api/institutions/${instId}`, { renewalDate: "2027-01-01" });
      expect("F: RM refused renewalDate (403)", fRej.status === 403, `(${fRej.status})`);
      expect("F: 403 names renewalDate", Array.isArray(fRej.payload?.fields) && fRej.payload.fields.includes("renewalDate"));
      const fOk = await api(rm.jar, "PATCH", `/api/institutions/${instId}`, { regionIds: [r1.id, r2.id] });
      expect("F: RM CAN change regionIds (200)", fOk.status === 200, `(${fOk.status})`);
      expect("F: RM region change applied", set(await joinRegions(instId)) === set([r1.id, r2.id]));
    }
  } finally {
    await db.institutionRegion.deleteMany({ where: { institutionId: { in: created } } }).catch(() => {});
    await db.institution.deleteMany({ where: { id: { in: created } } }).catch(() => {});
    await db.region.deleteMany({ where: { id: { in: [r1.id, r2.id, r3.id] } } }).catch(() => {});
    await destroyUser(rm).catch(() => {});
    await destroyUser(admin).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
