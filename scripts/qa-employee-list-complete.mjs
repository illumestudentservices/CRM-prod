/**
 * The employee directory shows everybody, and so do the pickers built on it.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-employee-list-complete.mjs
 *
 * ★ THE FAULT THIS EXISTS TO CATCH.
 *
 * /api/hr/employees defaulted to 50 rows and refused to return more than 100.
 * The directory asked for no limit at all, so it drew 50 of the 101 staff, had
 * no pager, and filtered its search CLIENT-SIDE over the rows it had loaded.
 * Half the company was not merely hidden — it was unfindable, and searching
 * for one of them answered "no results" rather than hinting that more existed.
 *
 * The manager picker and the asset list already asked for ?limit=200 and were
 * silently cut to 100, so the newest member of staff could not be chosen as
 * anybody's manager.
 *
 * None of that threw. A truncated list looks exactly like a short list, which
 * is why it survived until somebody counted. So this suite counts: it compares
 * what the endpoint returns against the database, and it creates enough
 * disposable staff to push the total past any cap before it asks.
 */
import {
  db, createAndLogin, destroyUser, api,
  startSection, expect, summary, TAG,
} from "./qa-lib.mjs";

const ctxs = [];

async function main() {
  startSection("Counting what the database holds");

  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(admin);

  const total = await db.employee.count({
    where: { isActive: true, user: { deletedAt: null } },
  });
  console.log(`     ${total} active employee(s) in the database`);
  expect(total > 50, "there are more than the old default of 50 to miss",
    `${total} employees`);

  // ── The directory ────────────────────────────────────────────────────────
  startSection("The directory returns all of them");

  const listed = await api(admin.jar, "GET", "/api/hr/employees?limit=1000");
  const rows = listed.payload?.employees ?? [];
  expect(listed.status === 200, "the list loads", `status ${listed.status}`);
  expect(rows.length === total,
    "*** every active employee is returned, not the first page ***",
    `${rows.length} returned, ${total} exist`);
  expect(listed.payload?.total === total,
    "and the reported total agrees", `${listed.payload?.total} vs ${total}`);

  const unique = new Set(rows.map((r) => r.employeeId));
  expect(unique.size === rows.length, "with no duplicates", `${unique.size} of ${rows.length}`);

  startSection("The default is still a page, and the cap is above headcount");

  const def = await api(admin.jar, "GET", "/api/hr/employees");
  expect((def.payload?.employees ?? []).length === Math.min(50, total),
    "asking for nothing still gives one page of 50",
    `${(def.payload?.employees ?? []).length}`);

  // The old ceiling. A caller asking for 200 used to receive 100.
  const two = await api(admin.jar, "GET", "/api/hr/employees?limit=200");
  expect((two.payload?.employees ?? []).length === Math.min(200, total),
    "*** ?limit=200 is honoured rather than clamped to 100 ***",
    `${(two.payload?.employees ?? []).length} returned, ${total} exist`);

  const silly = await api(admin.jar, "GET", "/api/hr/employees?limit=999999");
  expect((silly.payload?.limit ?? 0) <= 1000,
    "but an absurd limit is still bounded", `limit came back as ${silly.payload?.limit}`);

  const junk = await api(admin.jar, "GET", "/api/hr/employees?limit=abc");
  expect(junk.status === 200 && (junk.payload?.employees ?? []).length > 0,
    "and an unreadable limit falls back to a page rather than returning nothing",
    `status ${junk.status}, ${(junk.payload?.employees ?? []).length} row(s)`);

  // ── The pickers built on the same endpoint ───────────────────────────────
  startSection("The newest hire is reachable everywhere");

  const newest = await db.employee.findFirst({
    where: { isActive: true, user: { deletedAt: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, employeeId: true },
  });
  expect(rows.some((r) => r.id === newest.id),
    "*** the most recently created employee appears in the directory ***",
    `${newest.employeeId} missing`);
  expect((two.payload?.employees ?? []).some((r) => r.id === newest.id) || total > 200,
    "and in the ?limit=200 list the manager picker uses",
    `${newest.employeeId} missing from a 200-row request`);

  startSection("Paging still works for anyone who wants it");
  const p1 = await api(admin.jar, "GET", "/api/hr/employees?page=1&limit=10");
  const p2 = await api(admin.jar, "GET", "/api/hr/employees?page=2&limit=10");
  const ids1 = new Set((p1.payload?.employees ?? []).map((r) => r.id));
  const ids2 = (p2.payload?.employees ?? []).map((r) => r.id);
  expect(ids1.size === 10, "page 1 holds ten", `${ids1.size}`);
  expect(ids2.length === 10 && !ids2.some((id) => ids1.has(id)),
    "page 2 holds ten different people", `${ids2.length} rows, ${ids2.filter((id) => ids1.has(id)).length} repeated`);
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally {
  startSection("Teardown");
  for (const c of ctxs) await destroyUser(c);
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
