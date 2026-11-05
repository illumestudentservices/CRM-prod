/**
 * QA — an ICR sees the "Log extra hours" (in-lieu) option on their own profile.
 *
 * ICRs are redirected off /hr to their own employee profile, so the in-lieu
 * section must appear there. Logs in as an ICR with an employee record, fetches
 * /hr/employees/<ownEmployeeId>, and asserts the in-lieu control is rendered.
 * Also confirms it can actually submit. 3×.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-in-lieu-icr.mjs
 */
import { db, BASE, createAndLogin, destroyUser, api } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function run() {
  try {
    for (let r = 1; r <= 3; r++) {
      console.log(`\n── round ${r} ──`);
      const ctx = await createAndLogin({ role: "ICR", withEmployee: true });
      if (!ctx.employee) throw new Error("ICR has no employee record");
      const empId = ctx.employee.id;
      try {
        // Own profile, Leave tab (deep-linked so SSR renders it) shows the
        // in-lieu section with the "Log extra hours" button.
        const res = await fetch(`${BASE}/hr/employees/${empId}?tab=leave`, { headers: { Cookie: ctx.jar.header() } });
        const html = await res.text();
        expect("ICR can open own profile (Leave tab)", res.ok, `(status ${res.status})`);
        expect("ICR sees the 'Log extra hours' option", html.includes("Log extra hours"));
        expect("ICR sees their in-lieu list", html.includes("Your in-lieu requests"));

        // And can actually submit an in-lieu request.
        const create = await api(ctx.jar, "POST", "/api/hr/leave/in-lieu", {
          employeeId: empId, workDate: new Date().toISOString().slice(0, 10), hours: 8,
        });
        expect("ICR can submit in-lieu (201)", create.status === 201, `(status ${create.status})`);
        expect("submitted request = 1 day (8h)", create.payload?.request?.days === 1, `(got ${create.payload?.request?.days})`);
      } finally {
        await db.inLieuRequest.deleteMany({ where: { employeeId: empId } }).catch(() => {});
        await destroyUser(ctx).catch(() => {});
      }
    }
  } finally {
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
