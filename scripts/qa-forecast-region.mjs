/**
 * Forecast POST cross-region fabrication (pentest MEDIUM).
 *
 * GET /api/forecasts is region-scoped (an RM sees only their region's ICRs),
 * but POST was not: a Regional Manager could OPEN a forecast for an ICR in
 * another region and pin it to another region's manager — and it then enters
 * that region's numbers and review chain. Fix: an RM is confined to ICRs in
 * their own region and may pin only themselves as regionalManager; ICR already
 * pinned to self; SUPER_ADMIN unscoped.
 *
 *   npx tsx --env-file=.env.local scripts/qa-forecast-region.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const PY = 2027, IY = 2027, IM = 9;
let admin, rm1, icrA, icrB, inst, r1, r2;
const forecastIds = [];

const body = (icrId, month, extra = {}) => ({
  periodYear: PY, periodMonth: month, institutionId: inst.id,
  icrId, intakeYear: IY, intakeMonth: IM, ...extra,
});
const track = (r) => { const id = r.payload?.data?.id; if (id) forecastIds.push(id); return r; };

try {
  r1 = await db.region.create({ data: { name: `${TAG} R1`, code: `${TAG}1` } });
  r2 = await db.region.create({ data: { name: `${TAG} R2`, code: `${TAG}2` } });

  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  rm1 = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: r1.id } });
  icrA = await createAndLogin({ role: "ICR", extra: { regionId: r1.id } });
  icrB = await createAndLogin({ role: "ICR", extra: { regionId: r2.id } });

  inst = await db.institution.create({
    data: { name: `${TAG} Inst`, country: "QA", type: "UNIVERSITY", createdById: admin.user.id },
  });

  for (let run = 1; run <= 3; run++) {
    const month = run; // keeps the unique forecast key distinct across runs
    startSection(`forecast POST region scope (run ${run})`);

    // RM opens a forecast for an ICR in their own region.
    let r = track(await api(rm1.jar, "POST", "/api/forecasts", body(icrA.user.id, month)));
    expect(r.status === 201, "RM opens a forecast for an ICR in their region (201)", `got ${r.status}`);

    // THE ATTACK: RM opens a forecast for an ICR in another region.
    const beforeB = await db.forecast.count({ where: { icrId: icrB.user.id } });
    r = await api(rm1.jar, "POST", "/api/forecasts", body(icrB.user.id, month));
    expect(r.status === 403, "RM CANNOT open a forecast for an ICR in another region (403)", `got ${r.status}`);
    const afterB = await db.forecast.count({ where: { icrId: icrB.user.id } });
    expect(afterB === beforeB, "no cross-region forecast was created", `${beforeB} -> ${afterB}`);

    // RM cannot pin the forecast to a different manager.
    r = await api(rm1.jar, "POST", "/api/forecasts", body(icrA.user.id, month, { regionalManagerId: admin.user.id }));
    expect(r.status === 403, "RM cannot pin a forecast to another manager (403)", `got ${r.status}`);

    // SUPER_ADMIN is unscoped — may open for any region's ICR.
    r = track(await api(admin.jar, "POST", "/api/forecasts", body(icrB.user.id, month)));
    expect(r.status === 201, "SUPER_ADMIN opens a forecast for any ICR (201)", `got ${r.status}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const id of forecastIds) {
    await db.forecastSegment.deleteMany({ where: { forecastId: id } }).catch(() => {});
    await db.forecastEvent.deleteMany({ where: { forecastId: id } }).catch(() => {});
    await db.forecast.delete({ where: { id } }).catch(() => {});
  }
  if (inst) await db.institution.delete({ where: { id: inst.id } }).catch(() => {});
  for (const u of [admin, rm1, icrA, icrB]) if (u) await destroyUser(u);
  for (const reg of [r1, r2]) if (reg) await db.region.delete({ where: { id: reg.id } }).catch(() => {});
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
