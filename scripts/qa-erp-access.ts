/**
 * QA — ERP-only staff (HR_MANAGER, EMPLOYEE) get Field Ops + Recruitment
 * Network (full use) and Clients (view only, no figures). 3×.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-erp-access.ts
 */
import { BASE, createAndLogin, destroyUser, api, db } from "./qa-lib.mjs";
import { canSeeClientFigures } from "@/lib/permissions";
import type { Role } from "@prisma/client";

let pass = 0, fail = 0;
function expect(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function page(jar: { header: () => string }, path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: jar.header() }, redirect: "manual" });
  return res.status; // 200 = allowed, 3xx = proxy redirect (blocked)
}

async function run() {
  for (const role of ["HR_MANAGER", "EMPLOYEE"] as Role[]) {
    const ctx = await createAndLogin({ role });
    try {
      for (let round = 1; round <= 3; round++) {
        console.log(`\n── ${role} · round ${round} ──`);

        // Clients are figure-blind for these roles.
        expect(`${role}: canSeeClientFigures = false`, canSeeClientFigures(role) === false);

        // Route access (proxy gate): all three modules open (200, not a redirect).
        expect(`${role}: /field-operations opens`, (await page(ctx.jar, "/field-operations")) === 200);
        // /recruitment-network is an index that redirects to /partners; test the
        // real landing page.
        expect(`${role}: /recruitment-network/partners opens`, (await page(ctx.jar, "/recruitment-network/partners")) === 200);
        expect(`${role}: /institutions opens`, (await page(ctx.jar, "/institutions")) === 200);

        // Clients: can read the list, CANNOT create (view-only).
        const list = await api(ctx.jar, "GET", "/api/institutions");
        expect(`${role}: GET /api/institutions 200`, list.status === 200, `(${list.status})`);
        const instPost = await api(ctx.jar, "POST", "/api/institutions", { name: `QA ${role} ${Date.now()}`, country: "T", type: "University" });
        expect(`${role}: POST /api/institutions FORBIDDEN (view-only)`, instPost.status === 403, `(${instPost.status})`);

        // Full use: the create gates for Field Ops (activities) + Recruitment
        // Network (sources, events) must NOT be 403. An empty body then fails
        // validation (400/422) — which proves the permission gate let it past.
        const act = await api(ctx.jar, "POST", "/api/activities", {});
        expect(`${role}: POST /api/activities not forbidden (full use)`, act.status !== 403 && act.status !== 401, `(${act.status})`);
        const src = await api(ctx.jar, "POST", "/api/sources", {});
        expect(`${role}: POST /api/sources not forbidden (full use)`, src.status !== 403 && src.status !== 401, `(${src.status})`);
        const evt = await api(ctx.jar, "POST", "/api/events", {});
        expect(`${role}: POST /api/events not forbidden (full use)`, evt.status !== 403 && evt.status !== 401, `(${evt.status})`);
      }
    } finally {
      await destroyUser(ctx).catch(() => {});
    }
  }
  await db.$disconnect().catch(() => {});
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
