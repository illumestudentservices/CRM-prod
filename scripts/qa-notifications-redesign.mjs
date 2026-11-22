/**
 * Notifications redesign — API behaviour, 3 rounds:
 *   • mark-all-read ACTUALLY PERSISTS (the bug: schema rejected {all:true}=400)
 *   • GET paginates (limit/offset) and reports total + hasMore
 *   • DELETE { id } / { scope:"read" } / { scope:"all" } clear correctly, scoped
 *     to the signed-in user
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-notifications-redesign.mjs
 */
import { createAndLogin, destroyUser, db, api } from "./qa-lib.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${x}`); } };

const u = await createAndLogin({ role: "EMPLOYEE" });
const other = await createAndLogin({ role: "EMPLOYEE" });

async function seed(n, opts = {}) {
  await db.notification.deleteMany({ where: { userId: u.user.id } });
  for (let i = 0; i < n; i++) {
    await db.notification.create({ data: { userId: u.user.id, title: `N${i}`, message: `m${i}`, type: "SYSTEM", isRead: !!opts.read } });
  }
}
const unread = () => db.notification.count({ where: { userId: u.user.id, isRead: false } });
const totalFor = () => db.notification.count({ where: { userId: u.user.id } });

async function run(r) {
  console.log(`\n── round ${r} ──`);

  // Mark-all-read persists.
  await seed(8);
  const mp = await api(u.jar, "PATCH", "/api/notifications", { all: true });
  ok("PATCH {all:true} -> 200 (was 400)", mp.status === 200, `status ${mp.status}`);
  ok("all 8 now read in DB (persists)", (await unread()) === 0, `unread ${await unread()}`);

  // Mark one read.
  await seed(3);
  const one = await db.notification.findFirst({ where: { userId: u.user.id }, select: { id: true } });
  const mo = await api(u.jar, "PATCH", "/api/notifications", { id: one.id });
  ok("PATCH {id} -> 200", mo.status === 200, `status ${mo.status}`);
  ok("exactly one read after {id}", (await unread()) === 2, `unread ${await unread()}`);

  // Pagination + totals.
  await seed(40);
  const p1 = await api(u.jar, "GET", "/api/notifications?limit=30&offset=0");
  ok("page 1 returns 30 rows", (p1.payload?.data?.length ?? 0) === 30, `len ${p1.payload?.data?.length}`);
  ok("meta.total = 40", p1.payload?.meta?.total === 40, `total ${p1.payload?.meta?.total}`);
  ok("meta.unreadCount = 40", p1.payload?.meta?.unreadCount === 40, `unread ${p1.payload?.meta?.unreadCount}`);
  ok("hasMore true on page 1", p1.payload?.meta?.hasMore === true);
  const p2 = await api(u.jar, "GET", "/api/notifications?limit=30&offset=30");
  ok("page 2 returns 10 rows", (p2.payload?.data?.length ?? 0) === 10, `len ${p2.payload?.data?.length}`);
  ok("hasMore false on page 2", p2.payload?.meta?.hasMore === false);

  // DELETE one.
  const del1 = await api(u.jar, "DELETE", "/api/notifications", { id: one?.id ?? p1.payload.data[0].id });
  const target = p1.payload.data[0].id;
  const delTarget = await api(u.jar, "DELETE", "/api/notifications", { id: target });
  ok("DELETE {id} -> 200", delTarget.status === 200, `status ${delTarget.status}`);
  ok("one fewer in DB", (await totalFor()) === 39, `total ${await totalFor()}`);
  void del1;

  // DELETE scope: read (mark a few read first).
  await api(u.jar, "PATCH", "/api/notifications", { id: p1.payload.data[1].id });
  const delRead = await api(u.jar, "DELETE", "/api/notifications", { scope: "read" });
  ok("DELETE {scope:read} -> 200, removed the read ones", delRead.status === 200 && (delRead.payload?.deleted ?? 0) >= 1, JSON.stringify(delRead.payload));
  ok("no read left", (await db.notification.count({ where: { userId: u.user.id, isRead: true } })) === 0);

  // Cross-user isolation: `other` deleting all only touches their own.
  await db.notification.create({ data: { userId: other.user.id, title: "other", message: "x", type: "SYSTEM", isRead: false } });
  await api(other.jar, "DELETE", "/api/notifications", { scope: "all" });
  ok("other's clear-all did NOT touch this user", (await totalFor()) > 0, `total ${await totalFor()}`);

  // DELETE scope: all.
  const delAll = await api(u.jar, "DELETE", "/api/notifications", { scope: "all" });
  ok("DELETE {scope:all} clears everything", delAll.status === 200 && (await totalFor()) === 0, `total ${await totalFor()}`);
}

try {
  for (let r = 1; r <= 3; r++) await run(r);
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  await db.notification.deleteMany({ where: { userId: { in: [u.user.id, other.user.id] } } }).catch(() => {});
  await destroyUser(other).catch(() => {});
  await destroyUser(u).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
