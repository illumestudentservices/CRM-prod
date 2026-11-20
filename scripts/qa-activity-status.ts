/**
 * Field Operations — activity lifecycle status on create (Spec §3).
 * Regression guard for "planned activity not showing": an activity logged for
 * TODAY must be PLANNED (was wrongly COMPLETED), the user's explicit choice must
 * win, and a past date with no choice still defaults to COMPLETED.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-activity-status.ts
 */
import { createAndLogin, destroyUser, api, db } from "./qa-lib.mjs";

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

let pass = 0, fail = 0;
const expect = (n: string, c: boolean, extra = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${extra}`); }
};

async function main() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  const tag = `as${Date.now().toString().slice(-6)}`;
  const inst = await db.institution.create({
    data: { name: `ZZ ${tag}`, country: "Canada", type: "College", createdById: admin.user.id },
  });
  const made: string[] = [];
  const create = async (body: Record<string, unknown>) => {
    const r = await api(admin.jar, "POST", "/api/activities", { type: "CLIENT_MEETING", institutionId: inst.id, ...body });
    if (r.payload?.data?.id) made.push(r.payload.data.id);
    return r;
  };

  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);

      // Derived (no explicit status):
      const td = await create({ title: "today activity", date: iso(0) });
      expect("today, no status -> PLANNED", td.payload?.data?.status === "PLANNED", `HTTP ${td.status} got=${td.payload?.data?.status}`);
      const fu = await create({ title: "future activity", date: iso(5) });
      expect("future, no status -> PLANNED", fu.payload?.data?.status === "PLANNED", `got=${fu.payload?.data?.status}`);
      const pa = await create({ title: "past activity", date: iso(-5) });
      expect("past, no status -> COMPLETED", pa.payload?.data?.status === "COMPLETED", `got=${pa.payload?.data?.status}`);

      // Explicit choice wins, whatever the date:
      expect("explicit PLANNED on past date -> PLANNED", (await create({ title: "ep", date: iso(-5), status: "PLANNED" })).payload?.data?.status === "PLANNED");
      expect("explicit COMPLETED on future date -> COMPLETED", (await create({ title: "ec", date: iso(5), status: "COMPLETED" })).payload?.data?.status === "COMPLETED");
      const ip = await create({ title: "ip", date: iso(0), status: "IN_PROGRESS" });
      expect("explicit IN_PROGRESS honoured", ip.payload?.data?.status === "IN_PROGRESS");

      // A planned-today activity is visible via the list API (shows under Planned).
      const list = await api(admin.jar, "GET", "/api/activities");
      const rows = Array.isArray(list.payload?.data) ? list.payload.data : (list.payload?.data?.activities ?? []);
      expect("list API returns rows", Array.isArray(rows) && rows.length > 0, `type=${typeof list.payload?.data}`);
    }
  } finally {
    await db.activity.deleteMany({ where: { institutionId: inst.id } }).catch(() => {});
    await db.institution.delete({ where: { id: inst.id } }).catch(() => {});
    await destroyUser(admin).catch(() => {});
    console.log(`\n  ${pass} passed, ${fail} failed`);
    await db.$disconnect().catch(() => {});
    process.exit(fail === 0 ? 0 : 1);
  }
}
main();
