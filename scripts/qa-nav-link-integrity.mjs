/**
 * Every link the sidebar draws must open.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-nav-link-integrity.mjs
 *
 * Two files decide one question and they had drifted apart. The sidebar is
 * built by getEffectiveNavKeys() from PERMISSION_MATRIX, through
 * NAV_RESOURCE_MAP (hr -> erp.read, tasks -> tasks.read). The route is admitted
 * by proxy.ts from NAV_PERMISSIONS, a plain list of role names. A role in the
 * first and not the second gets a link drawn in its sidebar that bounces to
 * /dashboard when clicked.
 *
 * On production that had cut HQ_EXECUTIVE out of the ERP altogether — eight of
 * fifteen staff, two of them line managers with reports — while still showing
 * them the HR & ERP link. Nothing failed loudly; the click just went back to
 * the dashboard.
 *
 * The static half is scoped to roles that actually have a user, because an
 * unused role's mismatch harms nobody and there are dozens of them left over
 * from the redesign. It widens by itself the first time one of those roles is
 * given to a person, which is exactly when it starts to matter.
 */
import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, api, BASE,
  startSection, expect, summary, TAG,
} from "./qa-lib.mjs";

const { generate: totpGenerate } = await import("otplib");
const { PERMISSION_MATRIX, NAV_PERMISSIONS } = await import("../lib/permissions.ts");

const ctxs = [];
let browser;

/**
 * Nav key -> the resource whose `read` draws it, mirroring NAV_RESOURCE_MAP in
 * lib/effective-permissions.ts. Only keys that proxy.ts can actually gate are
 * listed: gating happens by path prefix from PATH_TO_MODULE, and a key with no
 * prefix there is never checked.
 */
const GATED_NAV = {
  students: "leads",
  institutions: "institutions",
  analytics: "analytics",
  events: "events",
  reports: "reports",
  hr: "erp",
  markets: "markets",
  stakeholders: "stakeholders",
  recruitment_network: "recruitment_network",
  recruitment_planning: "recruitment_planning",
  icr_transition: "icr_transition",
  forecasting: "forecasting",
  market_intelligence: "market_intelligence",
  field_operations: "field_operations",
  tasks: "tasks",
  risk_compliance: "risk_compliance",
  knowledge: "knowledge",
  whatsapp: "whatsapp",
  settings: "settings",
};

/**
 * Mismatches that exist today and are NOT this change's to settle.
 *
 * Each is a role the matrix grants read and NAV_PERMISSIONS refuses, so the
 * link is drawn and the click bounces — the same defect as the two fixed on
 * 2026-10-09. They are parked rather than fixed because widening the nav list
 * and narrowing the matrix grant are both plausible and nobody has decided
 * which is intended:
 *
 *   HR_MANAGER   -> recruitment_planning   Why would HR read recruitment plans?
 *   HQ_ANALYTICS -> recruitment_planning   Plausible for an analytics role, but
 *                                          the Aug 2026 note in NAV_PERMISSIONS
 *                                          lists who was added on purpose and
 *                                          this role is not among them.
 *   HQ_ANALYTICS -> tasks                  Probably the same oversight as
 *                                          HQ_EXECUTIVE, but no HQ_ANALYTICS
 *                                          account exists in production, so it
 *                                          strands nobody today.
 *
 * Recorded as a BASELINE, not an exemption: anything outside this set fails the
 * assertion. Guessing the intent would mean quietly granting or revoking access
 * under cover of a leave fix. Delete an entry here when the real decision is
 * made.
 */
const KNOWN_UNRESOLVED = new Set([
  "HR_MANAGER -> recruitment_planning",
  "HQ_ANALYTICS -> recruitment_planning",
  "HQ_ANALYTICS -> tasks",
]);

async function signIn(page, acct) {
  const secret = (await db.user.findUnique({
    where: { id: acct.user.id }, select: { twoFactorSecret: true },
  })).twoFactorSecret;
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 40000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate({ secret }));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 40000 });
}

async function main() {
  startSection("No role in use has a link that bounces");

  // Roles held by a live account. A role nobody has cannot strand anybody.
  const inUse = (await db.user.groupBy({
    by: ["role"],
    where: { deletedAt: null, isActive: true },
  })).map((r) => r.role);
  console.log(`     roles with a live user: ${inUse.join(", ")}`);

  const bouncing = [];
  const parked = [];
  for (const [key, resource] of Object.entries(GATED_NAV)) {
    const allowed = NAV_PERMISSIONS[key];
    if (!allowed) continue; // proxy.ts skips a key with no role list
    for (const role of inUse) {
      const granted = (PERMISSION_MATRIX[role]?.[resource] ?? []).includes("read");
      if (!granted || allowed.includes(role)) continue;
      const pair = `${role} -> ${key}`;
      (KNOWN_UNRESOLVED.has(pair) ? parked : bouncing).push(`${pair} (${resource}.read)`);
    }
  }
  expect(bouncing.length === 0,
    "*** no NEW module is drawn in a live role's sidebar and then refused ***",
    bouncing.join(" | "));
  if (parked.length) console.log(`     parked, awaiting a decision: ${parked.join(" | ")}`);

  // A baseline that quietly stops matching is a baseline nobody will notice has
  // gone stale, and it would start hiding real mismatches behind old names.
  const stale = [...KNOWN_UNRESOLVED].filter(
    (p) => !parked.some((q) => q.startsWith(p)));
  expect(stale.length === 0,
    "the parked list still describes something real",
    `no longer mismatched, remove from KNOWN_UNRESOLVED: ${stale.join(", ")}`);

  browser = await chromium.launch();

  // ── The role the drift actually stranded ───────────────────────────────
  startSection("An HQ_EXECUTIVE can use the ERP");
  const exec = await createAndLogin({ role: "HQ_EXECUTIVE", withEmployee: true });
  ctxs.push(exec);
  const report = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(report);

  const threeYearsAgo = new Date(Date.UTC(new Date().getUTCFullYear() - 3, 0, 15));
  await db.employee.update({
    where: { id: exec.employee.id },
    data: { startDate: threeYearsAgo, gender: "FEMALE" },
  });
  await db.employee.update({
    where: { id: report.employee.id },
    data: { startDate: threeYearsAgo, gender: "MALE", managerId: exec.employee.id },
  });

  const { start, end } = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 30);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    const e = new Date(d);
    e.setUTCDate(e.getUTCDate() + 1);
    const iso = (x) => x.toISOString().slice(0, 10);
    return { start: iso(d), end: iso(e) };
  })();
  const applied = await api(report.jar, "POST", "/api/hr/leave", {
    employeeId: report.employee.id,
    leaveType: "VACATION_PAID",
    startDate: start, endDate: end,
    reason: `${TAG} exec approval test`,
  });
  expect(applied.status === 201, "their report files a leave request",
    `status ${applied.status} ${JSON.stringify(applied.payload).slice(0, 120)}`);
  const requestId = applied.payload?.request?.id ?? null;

  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  await signIn(page, exec);

  const navText = await page.locator("nav, aside").first().innerText().catch(() => "");
  expect(/hr & erp/i.test(navText), "the sidebar offers them HR & ERP",
    navText.replace(/\n/g, " | ").slice(0, 200));
  expect(/tasks/i.test(navText), "and Tasks");

  // The click, not just the link. This is the half that was broken: the link
  // was always drawn.
  for (const path of ["/hr", "/tasks"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2500);
    const landed = new URL(page.url()).pathname;
    expect(landed === path, `*** ${path} opens instead of bouncing to /dashboard ***`, `landed on ${landed}`);
  }

  startSection("And the ERP is actually usable for them");
  await page.goto(`${BASE}/hr?tab=leave`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  const hrText = await page.locator("main").innerText();

  expect(/apply for leave/i.test(hrText), "they can apply for their own leave",
    hrText.replace(/\n/g, " ").slice(0, 200));
  expect(/awaiting your approval/i.test(hrText),
    "*** and their report's request reaches them ***",
    hrText.replace(/\n/g, " ").slice(0, 220));

  const approve = page.getByRole("button", { name: /^approve$/i }).first();
  expect(await approve.count() > 0, "with an Approve control");
  await approve.click();
  let status = "PENDING";
  for (let i = 0; i < 25 && status === "PENDING"; i++) {
    await page.waitForTimeout(400);
    status = (await db.leaveRequest.findUnique({ where: { id: requestId }, select: { status: true } }))?.status;
  }
  expect(status === "APPROVED", "*** that approves it ***", String(status));

  startSection("Letting them in does not widen what they can see");
  await page.goto(`${BASE}/hr/employees/${report.employee.id}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  const landed = new URL(page.url()).pathname;
  expect(landed !== `/hr/employees/${report.employee.id}`,
    "they still cannot open somebody else's employee record", `landed on ${landed}`);

  const tabsOnHr = await (async () => {
    await page.goto(`${BASE}/hr`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2500);
    return page.locator('[role="tab"]').allInnerTexts();
  })();
  expect(!tabsOnHr.some((t) => /^employees$/i.test(t)),
    "and the HR-only Employees tab stays hidden from them", tabsOnHr.join(", "));

  const othersAttendance = await page.evaluate(async (eid) => {
    const r = await fetch(`/api/hr/attendance?employeeId=${eid}`);
    const j = await r.json().catch(() => ({}));
    return { status: r.status, count: (j.records ?? []).length };
  }, report.employee.id);
  expect(othersAttendance.count === 0,
    "asking for someone else's attendance returns nothing",
    `${othersAttendance.count} record(s), status ${othersAttendance.status}`);

  await page.context().close();
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally {
  startSection("Teardown");
  if (browser) await browser.close().catch(() => {});
  for (const c of ctxs) {
    if (c.employee) {
      await db.employee.updateMany({ where: { managerId: c.employee.id }, data: { managerId: null } }).catch(() => {});
    }
  }
  for (const c of ctxs) {
    if (c.employee) {
      await db.leaveRequest.deleteMany({ where: { employeeId: c.employee.id } }).catch(() => {});
      await db.leaveBalance.deleteMany({ where: { employeeId: c.employee.id } }).catch(() => {});
    }
    await destroyUser(c);
  }
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
