/**
 * effective-permissions must FAIL CLOSED.
 *
 * Part A (HTTP, real stack): a permission_override that REVOKES a right the
 *   static matrix grants is honoured — an EMPLOYEE with travel:read revoked can
 *   no longer GET /api/travel (403), and gets it back when the override is
 *   removed. Proves overrides are actually read and applied.
 *
 * Part B (in-process): when the overrides read THROWS (simulated DB outage),
 *   effectiveHasPermission denies (false) instead of silently restoring the
 *   static grant, and getEffectiveNavKeys degrades to only the always-visible
 *   nav. This is the fail-open bug being fixed. We also confirm a normal read
 *   works before the outage (so we are testing fail-closed, not a dead
 *   function).
 *
 *   npx tsx --env-file=.env.local scripts/qa-effective-permissions-failclosed.ts
 */
// @ts-nocheck
import { db, createAndLogin, destroyUser, api, startSection, expect, summary } from "./qa-lib.mjs";
import { db as appDb } from "@/lib/db";
import { effectiveHasPermission, getEffectiveNavKeys } from "@/lib/effective-permissions";

let emp;
const OVERRIDE = { role: "EMPLOYEE", resource: "travel", action: "read" };
const clearOverride = () =>
  db.permissionOverride.deleteMany({ where: OVERRIDE }).catch(() => {});

async function main() {
 try {
  await clearOverride(); // start clean in case a prior crashed run left one

  // ── Part A: a REVOKING override is honoured (overrides are really applied) ─
  emp = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });

  startSection("A revoked permission is honoured (not silently restored) ×3");
  let r = await api(emp.jar, "GET", "/api/travel");
  expect(r.ok, "baseline: EMPLOYEE can GET /api/travel (static grants travel:read)", `got ${r.status}`);

  for (let i = 1; i <= 3; i++) {
    await db.permissionOverride.create({ data: { ...OVERRIDE, granted: false, updatedById: emp.user.id } });
    r = await api(emp.jar, "GET", "/api/travel");
    expect(r.status === 403, `run ${i}: with travel:read revoked, GET /api/travel is 403`, `got ${r.status}`);
    await clearOverride();
    r = await api(emp.jar, "GET", "/api/travel");
    expect(r.ok, `run ${i}: override removed, access restored (200)`, `got ${r.status}`);
  }

  // ── Part B: DB-error path fails CLOSED ────────────────────────────────────
  startSection("DB outage on the overrides read → deny (fail closed)");

  // Normal read works first (a different role, so its cache entry can't mask
  // the fail-closed assertions below).
  const normal = await effectiveHasPermission("REGIONAL_MANAGER", "leads", "read");
  expect(normal === true, "before the outage, a granted permission reads true", `got ${normal}`);

  // Simulate the overrides table being unreadable.
  const realFindMany = appDb.permissionOverride.findMany.bind(appDb.permissionOverride);
  appDb.permissionOverride.findMany = async () => { throw new Error("simulated DB outage"); };

  try {
    for (let i = 1; i <= 3; i++) {
      const allowed = await effectiveHasPermission("SUPER_ADMIN", "leads", "read");
      expect(allowed === false, `run ${i}: SUPER_ADMIN leads:read DENIED on DB error (static would say true)`, `got ${allowed}`);
    }
    const nav = await getEffectiveNavKeys("SUPER_ADMIN");
    const onlyAlwaysVisible = Array.isArray(nav) && nav.length === 1 && nav[0] === "dashboard";
    expect(onlyAlwaysVisible, "nav degrades to only always-visible keys (['dashboard'])", JSON.stringify(nav));
  } finally {
    appDb.permissionOverride.findMany = realFindMany;
  }

  // Recovery: a DIFFERENT role reads normally again once the DB is back.
  const recovered = await effectiveHasPermission("HR_MANAGER", "erp", "read");
  expect(recovered === true, "after recovery, a granted permission reads true again", `got ${recovered}`);
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  await clearOverride();
  if (emp) await destroyUser(emp);
  const f = summary();
  await db.$disconnect();
  await appDb.$disconnect().catch(() => {});
  process.exit(f ? 1 : (process.exitCode ?? 0));
  }
}

main();
