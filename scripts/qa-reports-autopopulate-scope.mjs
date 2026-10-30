/**
 * reports/auto-populate icrId scope (pentest MEDIUM).
 *
 * POST /api/reports/auto-populate composes an ICR's monthly performance
 * figures from an icrId taken off the body. INSTITUTION_CLIENT was already
 * blocked, but a Regional Manager could pass any ICR's id — including another
 * region's — and read their numbers. Now scoped like GET /api/reports: a
 * Regional Manager is confined to ICRs in their own region; HQ/admin are
 * global.
 *
 *   npx tsx --env-file=.env.local scripts/qa-reports-autopopulate-scope.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const MONTH = 9, YEAR = 2027;
let admin, rm1, icrA, icrB, client, r1, r2;
const pop = (icrId) => ({ icrId, reportingMonth: MONTH, reportingYear: YEAR });

try {
  r1 = await db.region.create({ data: { name: `${TAG} R1`, code: `${TAG}1` } });
  r2 = await db.region.create({ data: { name: `${TAG} R2`, code: `${TAG}2` } });

  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  rm1 = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: r1.id } });
  icrA = await createAndLogin({ role: "ICR", extra: { regionId: r1.id } });
  icrB = await createAndLogin({ role: "ICR", extra: { regionId: r2.id } });
  client = await createAndLogin({ role: "INSTITUTION_CLIENT" });

  for (let run = 1; run <= 3; run++) {
    startSection(`auto-populate icrId scope (run ${run})`);

    // RM may draft for an ICR in their own region.
    let r = await api(rm1.jar, "POST", "/api/reports/auto-populate", pop(icrA.user.id));
    expect(r.ok, "RM auto-populates an ICR in their region (200)", `got ${r.status}`);
    expect(r.payload?.icrId === icrA.user.id, "the response is scoped to that ICR", r.payload?.icrId);

    // THE ATTACK: RM reaches an ICR in another region → refused.
    r = await api(rm1.jar, "POST", "/api/reports/auto-populate", pop(icrB.user.id));
    expect(r.status === 403, "RM CANNOT auto-populate an ICR in another region (403)", `got ${r.status}`);

    // RM drafting for themselves is fine.
    r = await api(rm1.jar, "POST", "/api/reports/auto-populate", pop(rm1.user.id));
    expect(r.ok, "RM can auto-populate their own figures (200)", `got ${r.status}`);

    // No icrId defaults to the caller.
    r = await api(rm1.jar, "POST", "/api/reports/auto-populate", { reportingMonth: MONTH, reportingYear: YEAR });
    expect(r.ok && r.payload?.icrId === rm1.user.id, "omitted icrId defaults to the caller", `${r.status} ${r.payload?.icrId}`);

    // HQ/admin is global — any region.
    r = await api(admin.jar, "POST", "/api/reports/auto-populate", pop(icrB.user.id));
    expect(r.ok && r.payload?.icrId === icrB.user.id, "SUPER_ADMIN may auto-populate any ICR (global)", `got ${r.status}`);

    // Partner accounts are refused outright.
    r = await api(client.jar, "POST", "/api/reports/auto-populate", pop(icrA.user.id));
    expect(r.status === 403, "INSTITUTION_CLIENT is refused (403)", `got ${r.status}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const u of [admin, rm1, icrA, icrB, client]) if (u) await destroyUser(u);
  for (const reg of [r1, r2]) if (reg) await db.region.delete({ where: { id: reg.id } }).catch(() => {});
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
