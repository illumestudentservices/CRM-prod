/**
 * Adversarial access-control audit — "assume the user is hostile".
 *
 *   node --import tsx --env-file=.env scripts/qa-breakin-privesc.mjs
 *
 * Every other QA script here checks that the app does what it should for a user
 * who behaves. This one checks what it refuses to do for one who doesn't. Three
 * passes, each with its own freshly created, really-logged-in account, and each
 * account destroyed and confirmed gone before the next begins.
 *
 * Two questions:
 *   1. READ  — can a low-privilege or EXTERNAL role pull data it must never see?
 *              INSTITUTION_CLIENT is the sharp case: it is a client of the
 *              business, not staff, and student PII leaking to it is a breach.
 *   2. WRITE — can an account promote itself, mint an admin, seize someone
 *              else's login, or widen the permission matrix? Any single yes
 *              here collapses the whole role model.
 *
 * A route that 404s is reported separately from one that 403s: both deny the
 * caller, but only 403 proves a deliberate check rather than a typo in this
 * script.
 */

import {
  db, createAndLogin, destroyUser, BASE, Jar,
  startSection, expect, ok, fail, summary, TAG, sleep,
} from "./qa-lib.mjs";

const PASSES = 3;
const allCreated = [];

/** Raw fetch so we see the true status; qa-lib's api() is fine but we want headers too. */
async function hit(jar, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Cookie: jar.header(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* html or empty */ }
  await sleep(40); // stay under the rate limiter
  return { status: res.status, payload };
}

/** Data a non-privileged or external caller must not be able to list. */
const FORBIDDEN_READS = [
  ["/api/leads", "student records"],
  ["/api/settings/users", "the staff user list"],
  ["/api/settings/permissions", "the permission matrix"],
  ["/api/hr/employees", "employee records"],
  ["/api/analytics/executive", "executive analytics"],
  ["/api/recycle-bin", "deleted records"],
  ["/api/activity-log", "the audit trail"],
  ["/api/hr/timesheets/reporting", "organisation-wide timesheets"],
  ["/api/hr/leave", "leave records"],
  ["/api/travel", "travel requests"],
];

/** Roles that must NOT be able to do any of the above. */
const HOSTILE_ROLES = ["EMPLOYEE", "INSTITUTION_CLIENT"];

async function readProbes(pass) {
  for (const role of HOSTILE_ROLES) {
    startSection(`PASS ${pass} — READ as ${role}`);
    const ctx = await createAndLogin({ role });
    allCreated.push(ctx);

    // Prove the session is real before trusting any 403 it returns: a broken
    // login would make every route "deny" and the whole probe would pass
    // vacuously.
    const me = await hit(ctx.jar, "GET", "/api/auth/session");
    const authed = me.status === 200 && !!me.payload?.user;
    expect(authed, `${role}: session is genuinely authenticated`,
      `status=${me.status} user=${JSON.stringify(me.payload?.user?.role ?? null)}`);
    if (!authed) { await teardown(ctx); continue; }
    expect(me.payload.user.role === role,
      `${role}: session carries the expected role`, String(me.payload?.user?.role));

    for (const [path, human] of FORBIDDEN_READS) {
      const r = await hit(ctx.jar, "GET", path);

      // Two shapes of "no" are both correct, and demanding only the first was
      // wrong. A hard 403 refuses the endpoint outright. A row-scoped endpoint
      // instead answers 200 with an empty collection — that is what
      // /api/leads and /api/travel now do for a caller entitled to nothing,
      // and it leaks no more than the 403 does. What matters is that no data
      // comes back.
      const denied = r.status === 401 || r.status === 403;
      const rows = Array.isArray(r.payload?.data) ? r.payload.data.length
                 : Array.isArray(r.payload) ? r.payload.length
                 : Array.isArray(r.payload?.requests) ? r.payload.requests.length
                 : Array.isArray(r.payload?.travelRequests) ? r.payload.travelRequests.length
                 : null;
      const empty = r.status === 200 && rows === 0;

      expect(denied || empty,
        `${role} receives no ${human}`,
        `GET ${path} -> ${r.status}${rows !== null ? ` with ${rows} rows` : " (shape unknown)"}`);
    }
    await teardown(ctx);
  }
}

async function writeProbes(pass) {
  startSection(`PASS ${pass} — PRIVILEGE ESCALATION as EMPLOYEE`);
  const ctx = await createAndLogin({ role: "EMPLOYEE" });
  allCreated.push(ctx);

  const me = await hit(ctx.jar, "GET", "/api/auth/session");
  if (!expect(me.status === 200, "attacker session is live", `status=${me.status}`)) {
    await teardown(ctx); return;
  }

  // A second, unrelated account: the victim of the takeover attempts. Without a
  // real other user, "reset someone else's 2FA" cannot actually be tested.
  const victim = await createAndLogin({ role: "HQ_EXECUTIVE" });
  allCreated.push(victim);

  // Verbs matter. An earlier version of this file used PATCH /settings/users/[id]
  // and POST /settings/permissions; both 405'd, which looks like a refusal but
  // means the request never reached an authorisation check. Every entry below is
  // the verb the route actually exports, so a denial here is a real denial.
  const employee = await db.employee.findFirst({ select: { id: true } });

  const attacks = [
    ["promote self to SUPER_ADMIN",
      "PATCH", "/api/settings/users", { id: ctx.user.id, role: "SUPER_ADMIN" }],
    ["promote the victim to SUPER_ADMIN",
      "PATCH", "/api/settings/users", { id: victim.user.id, role: "SUPER_ADMIN" }],
    ["deactivate a colleague",
      "PATCH", "/api/settings/users", { id: victim.user.id, isActive: false }],
    ...(employee ? [["edit an employee record",
      "PATCH", `/api/hr/employees/${employee.id}`, { jobTitle: "PWNED-" + TAG }]] : []),
    ["widen the permission matrix",
      "PUT", "/api/settings/permissions",
      { role: "EMPLOYEE", resource: "leads", actions: ["read", "write", "delete"] }],
    ["widen granular capabilities",
      "PUT", "/api/settings/permissions/granular",
      { role: "EMPLOYEE", capabilities: ["users.change_role"] }],
    ["clear a colleague's 2FA (account takeover)",
      "POST", `/api/settings/users/${victim.user.id}/reset-2fa`, {}],
    ["reset a colleague's password (account takeover)",
      "POST", `/api/settings/users/${victim.user.id}/reset-password`, { password: "Pwn3d!" + TAG }],
    ["delete a colleague's account",
      "DELETE", `/api/settings/users/${victim.user.id}`, undefined],
  ];

  for (const [label, method, path, body] of attacks) {
    const r = await hit(ctx.jar, method, path, body);
    const denied = r.status === 401 || r.status === 403;
    expect(denied, `*** BLOCKED: ${label} ***`,
      `${method} ${path} -> ${r.status} ${JSON.stringify(r.payload?.error ?? r.payload)?.slice(0, 120)}`);
  }

  // Statuses can lie. Go behind the API and confirm nothing actually moved —
  // a 200 that changed nothing is fine, a 403 that still wrote is not.
  const meNow = await db.user.findUnique({
    where: { id: ctx.user.id }, select: { role: true },
  });
  expect(meNow?.role === "EMPLOYEE",
    "*** attacker's role in the database is still EMPLOYEE ***", `now ${meNow?.role}`);

  const victimNow = await db.user.findUnique({
    where: { id: victim.user.id },
    select: { isActive: true, twoFactorEnabled: true, password: true, role: true, deletedAt: true },
  });
  expect(victimNow?.isActive === true, "victim account was not deactivated");
  expect(victimNow?.role === "HQ_EXECUTIVE", "victim's role was not changed", String(victimNow?.role));
  expect(victimNow?.deletedAt === null, "*** victim account was not deleted ***");
  expect(victimNow?.twoFactorEnabled === true, "*** victim's 2FA is still enrolled ***");
  expect(victimNow?.password !== null, "victim still has a password set");

  if (employee) {
    const empNow = await db.employee.findUnique({
      where: { id: employee.id }, select: { jobTitle: true },
    });
    expect(!String(empNow?.jobTitle ?? "").includes("PWNED"),
      "*** employee record was not modified ***", String(empNow?.jobTitle));
  }

  await teardown(victim);
  await teardown(ctx);
}

/** Destroy an account and prove it is gone before moving on. */
async function teardown(ctx) {
  await destroyUser(ctx);
  const left = await db.user.count({ where: { id: ctx.user.id } });
  expect(left === 0, `disposable ${ctx.user.role} account deleted`, `${left} remaining`);
  if (left === 0) {
    const i = allCreated.indexOf(ctx);
    if (i >= 0) allCreated.splice(i, 1);
  }
}

async function main() {
  startSection("Baseline");
  const before = await db.user.count();
  ok(`users before: ${before}`);

  for (let p = 1; p <= PASSES; p++) {
    await readProbes(p);
    await writeProbes(p);
  }

  startSection("Footprint");
  const after = await db.user.count();
  expect(after === before,
    "*** user count back to baseline — no test account survived ***",
    `${before} -> ${after}`);
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", String(e?.message));
} finally {
  for (const c of allCreated) await destroyUser(c);
  const leaked = await db.user.count({
    where: { email: { contains: TAG.toLowerCase() } },
  }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leaked}\n`);
  await db.$disconnect();
}
summary();
