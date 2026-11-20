/**
 * Field Operations — activities are editable via PATCH /api/activities/[id],
 * including status (mark a planned activity Completed/Cancelled after the fact).
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-activity-edit.ts
 */
import { createAndLogin, destroyUser, api, db } from "./qa-lib.mjs";

let pass = 0, fail = 0;
const expect = (n: string, c: boolean, extra = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${extra}`); }
};

async function main() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  const tag = `ae${Date.now().toString().slice(-6)}`;
  const inst = await db.institution.create({
    data: { name: `ZZ ${tag}`, country: "Canada", type: "College", createdById: admin.user.id },
  });
  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      const created = await api(admin.jar, "POST", "/api/activities", {
        type: "CLIENT_MEETING", title: "original title", date: new Date().toISOString().slice(0, 10),
        status: "PLANNED", institutionId: inst.id,
      });
      const id = created.payload?.data?.id;
      expect("seed activity created PLANNED", created.payload?.data?.status === "PLANNED", `HTTP ${created.status}`);

      // Edit: change title, mark COMPLETED, add outcomes + a metric.
      const patched = await api(admin.jar, "PATCH", `/api/activities/${id}`, {
        title: "edited title", status: "COMPLETED", outcomes: "went well", studentsEngaged: 12, city: "Dubai",
      });
      expect("PATCH ok", patched.ok, `HTTP ${patched.status} ${JSON.stringify(patched.payload)?.slice(0, 140)}`);
      const d = patched.payload?.data;
      expect("title updated", d?.title === "edited title", `got ${d?.title}`);
      expect("status updated to COMPLETED", d?.status === "COMPLETED", `got ${d?.status}`);
      expect("outcomes saved", d?.outcomes === "went well");
      expect("studentsEngaged saved", d?.studentsEngaged === 12, `got ${d?.studentsEngaged}`);
      expect("city saved", d?.city === "Dubai");
      expect("actualDate stamped on completion", !!d?.actualDate);

      // Move it back to PLANNED → actualDate clears.
      const back = await api(admin.jar, "PATCH", `/api/activities/${id}`, { status: "PLANNED" });
      expect("status back to PLANNED", back.payload?.data?.status === "PLANNED");
      expect("actualDate cleared when un-completed", back.payload?.data?.actualDate == null, `got ${back.payload?.data?.actualDate}`);

      // Too-short title rejected.
      const bad = await api(admin.jar, "PATCH", `/api/activities/${id}`, { title: "x" });
      expect("1-char title rejected (422)", bad.status === 422, `HTTP ${bad.status}`);

      await db.activity.deleteMany({ where: { id } }).catch(() => {});
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
