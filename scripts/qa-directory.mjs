/**
 * The staff directory: everyone can open it, and it carries only what it should.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-directory.mjs
 *
 * ★ THE POINT OF THIS SUITE IS THE PAYLOAD.
 *
 * A directory is the one screen in the system deliberately shown to all 101
 * staff, so what it ships is the whole security question. The fields it must
 * NOT carry are asserted by name against a fixture with every one of them
 * filled in — because a later `include`, or somebody widening the select to
 * fix an unrelated bug, is exactly how a home address ends up on a page the
 * whole company can read, and nothing would throw.
 *
 * The other half is INSTITUTION_CLIENT. Those are partner-university logins:
 * people outside Illume with an account. The directory is its internal
 * structure, titles and reporting lines included, and they must not have it.
 */
import {
  db, createAndLogin, destroyUser, api,
  startSection, expect, summary, TAG, BASE,
} from "./qa-lib.mjs";

const ctxs = [];

/** Personal details that exist on Employee and must never reach this endpoint. */
const MUST_NOT_LEAK = {
  address: "44 Confidential Crescent, Toronto",
  phone: "+1 555 0911",
  emergencyContact: "Named Next Of Kin",
  emergencyPhone: "+1 555 0912",
  costCentre: "CC-SECRET-99",
};

async function main() {
  console.log(`BASE = ${BASE}\n`);

  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(admin);

  const manager = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  ctxs.push(manager);

  const employee = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(employee);

  const client = await createAndLogin({ role: "INSTITUTION_CLIENT" });
  ctxs.push(client);

  // A fixture carrying every sensitive field, plus a reporting line.
  await db.employee.update({
    where: { id: employee.employee.id },
    data: { ...MUST_NOT_LEAK, managerId: manager.employee.id, gender: "FEMALE" },
  });

  // ── Who can open it ───────────────────────────────────────────────────────
  startSection("Who can open the directory");

  for (const [label, ctx] of [
    ["a super admin", admin],
    ["a regional manager", manager],
    ["*** a plain employee ***", employee],
  ]) {
    const res = await api(ctx.jar, "GET", "/api/directory");
    expect(res.status === 200, `${label} can read it`, `status ${res.status}`);
    expect((res.payload?.people ?? []).length > 0, `   and gets people back`,
      `${(res.payload?.people ?? []).length} row(s)`);
  }

  const asClient = await api(client.jar, "GET", "/api/directory");
  expect(asClient.status === 403,
    "*** an institution client is refused ***",
    `status ${asClient.status} — the staff list would go to a partner university`);
  expect(!(asClient.payload?.people ?? []).length,
    "and gets no people at all", `${(asClient.payload?.people ?? []).length} leaked`);

  const anon = await fetch(`${BASE}/api/directory`, { redirect: "manual" });
  expect(anon.status === 307 || anon.status === 401,
    "signed out is turned away", `status ${anon.status}`);
  const anonBody = await anon.text();
  expect(!anonBody.includes('"people"'),
    "and no directory data comes back", "the directory leaked to an anonymous caller");

  // ── The payload ───────────────────────────────────────────────────────────
  startSection("What the payload carries");

  const feed = await api(employee.jar, "GET", "/api/directory");
  const people = feed.payload?.people ?? [];
  const me = people.find((p) => p.id === employee.employee.id);

  expect(!!me, "the fixture appears in the directory", me ? "found" : "missing");
  expect(!!me?.name && !!me?.jobTitle && !!me?.email,
    "with a name, job title and work email", JSON.stringify({ n: me?.name, j: me?.jobTitle }));
  expect(me?.managerId === manager.employee.id,
    "and a reporting line, so the chart can be drawn", `managerId=${me?.managerId}`);

  startSection("What the payload must NOT carry");
  const blob = JSON.stringify(people);
  for (const [field, value] of Object.entries(MUST_NOT_LEAK)) {
    expect(!blob.includes(value),
      `*** ${field} is NOT in the directory ***`,
      `"${value}" was published to all staff`);
  }
  expect(!blob.includes("FEMALE"),
    "*** gender is NOT in the directory ***",
    "gender is recorded for parental leave, not for publication");
  expect(!/"startDate"/.test(blob),
    "and neither is anybody's start date", "tenure was published");
  expect(!/"isActive"|"employmentType"/.test(blob),
    "nor employment type", "employment details were published");

  // ── The tree ──────────────────────────────────────────────────────────────
  startSection("The reporting structure holds together");

  const byId = new Map(people.map((p) => [p.id, p]));
  const roots = people.filter((p) => !p.managerId || !byId.has(p.managerId));
  console.log(`     ${roots.length} root(s): ${roots.map((r) => r.name).join(", ")}`);
  expect(roots.length >= 1, "there is at least one root to draw from", `${roots.length}`);

  // Nobody may be their own manager, and no cycle may exist, or the tree
  // renders for ever.
  expect(!people.some((p) => p.managerId === p.id),
    "*** nobody is their own manager ***", "a self-reference would recurse for ever");

  let cycle = null;
  for (const p of people) {
    const seen = new Set([p.id]);
    let cur = p.managerId ? byId.get(p.managerId) : null;
    while (cur) {
      if (seen.has(cur.id)) { cycle = `${p.name} -> ${cur.name}`; break; }
      seen.add(cur.id);
      cur = cur.managerId ? byId.get(cur.managerId) : null;
    }
    if (cycle) break;
  }
  expect(!cycle, "*** there is no reporting cycle ***", `found: ${cycle}`);

  const reachable = new Set();
  const walk = (id) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const p of people) if (p.managerId === id) walk(p.id);
  };
  for (const r of roots) walk(r.id);
  expect(reachable.size === people.length,
    "*** everybody is reachable from a root, so nobody is missing from the chart ***",
    `${reachable.size} of ${people.length} reachable`);

  startSection("Report counts are right");
  const expected = new Map();
  for (const p of people) {
    if (p.managerId) expected.set(p.managerId, (expected.get(p.managerId) ?? 0) + 1);
  }
  const wrong = people.filter((p) => p.reports !== (expected.get(p.id) ?? 0));
  expect(wrong.length === 0,
    "the direct-report count on each person matches the list",
    wrong.slice(0, 3).map((p) => `${p.name}: says ${p.reports}`).join("; "));

  const mgrRow = byId.get(manager.employee.id);
  expect((mgrRow?.reports ?? 0) >= 1,
    "and the fixture's manager shows at least one report", `${mgrRow?.reports}`);

  // ── Scope ─────────────────────────────────────────────────────────────────
  startSection("Only active staff, and everybody sees the same list");

  const gone = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(gone);
  await db.employee.update({ where: { id: gone.employee.id }, data: { isActive: false } });

  const after = await api(employee.jar, "GET", "/api/directory");
  expect(!(after.payload?.people ?? []).some((p) => p.id === gone.employee.id),
    "*** somebody deactivated drops out of the directory ***", "a leaver is still listed");

  const adminFeed = await api(admin.jar, "GET", "/api/directory");
  expect((adminFeed.payload?.people ?? []).length === (after.payload?.people ?? []).length,
    "an admin and an employee see the same number of people",
    `${(adminFeed.payload?.people ?? []).length} vs ${(after.payload?.people ?? []).length}`);

  startSection("It knows who you are");
  expect(after.payload?.myEmployeeId === employee.employee.id,
    "so the screen can mark \"you\" without guessing from a name",
    `myEmployeeId=${after.payload?.myEmployeeId}`);
  expect(adminFeed.payload?.myEmployeeId === admin.employee.id,
    "and it is the caller's own id, not a shared value",
    `${adminFeed.payload?.myEmployeeId}`);
}

let code = 1;
try { await main(); code = summary(); }
catch (e) {
  console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n"));
}
finally {
  startSection("Teardown");
  for (const c of ctxs) await destroyUser(c);
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
