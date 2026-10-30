/**
 * weekly-activities null-region RM scope (pentest MEDIUM).
 *
 * GET /api/reports/weekly-activities scoped a Regional Manager with
 * `if (regionId) where.regionId = regionId` — so a manager whose regionId was
 * null had the filter dropped entirely and saw every ICR's weekly figures
 * org-wide. Fix: a regionless manager matches NO_REGION (nothing), not
 * everything. A manager with a region still sees only their region.
 *
 *   npx tsx --env-file=.env.local scripts/qa-weekly-activities-region.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const YEAR = 2027, MONTH = 9;
let admin, rmNull, rm1, icrA, r1, waR1;

const ids = (payload) => (payload?.activities ?? []).map((a) => a.id);

try {
  r1 = await db.region.create({ data: { name: `${TAG} R1`, code: `${TAG}1` } });

  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  rm1 = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: r1.id } });
  // The bug: a Regional Manager with NO region.
  rmNull = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  icrA = await createAndLogin({ role: "ICR", extra: { regionId: r1.id } });

  waR1 = await db.weeklyActivity.create({
    data: {
      icrId: icrA.user.id, regionId: r1.id,
      year: YEAR, month: MONTH, weekOfMonth: 1,
      type: "ENQUIRIES", target: 10, completed: 5,
    },
  });

  const q = `/api/reports/weekly-activities?year=${YEAR}&month=${MONTH}`;

  for (let run = 1; run <= 3; run++) {
    startSection(`weekly-activities region scope (run ${run})`);

    // THE ATTACK: a regionless RM must NOT see region R1's row.
    let r = await api(rmNull.jar, "GET", q);
    expect(r.ok, "regionless RM can call the endpoint", `got ${r.status}`);
    expect(!ids(r.payload).includes(waR1.id), "regionless RM does NOT see R1's weekly row", `rows=${ids(r.payload).length}`);

    // A region-bound RM sees their own region's row.
    r = await api(rm1.jar, "GET", q);
    expect(r.ok && ids(r.payload).includes(waR1.id), "R1 manager sees R1's weekly row", `got ${r.status}`);

    // SUPER_ADMIN sees it (global).
    r = await api(admin.jar, "GET", q);
    expect(r.ok && ids(r.payload).includes(waR1.id), "SUPER_ADMIN sees the row (global)", `got ${r.status}`);

    // The ICR sees their own row.
    r = await api(icrA.jar, "GET", q);
    expect(r.ok && ids(r.payload).includes(waR1.id), "the owning ICR sees their own row", `got ${r.status}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (waR1) await db.weeklyActivity.delete({ where: { id: waR1.id } }).catch(() => {});
  for (const u of [admin, rmNull, rm1, icrA]) if (u) await destroyUser(u);
  if (r1) await db.region.delete({ where: { id: r1.id } }).catch(() => {});
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
