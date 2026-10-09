/**
 * A line manager can see and decide their own team's leave.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-manager-leave-approvals.mjs
 *
 * The bug this guards against was not a missing permission. `PATCH
 * /api/hr/leave/[id]` has always accepted a direct manager and says so in its
 * refusal text, but `GET /api/hr/leave` forced every non-HR caller down to
 * their own rows and the only Approve button in the app is gated on `isHR` —
 * where HR means SUPER_ADMIN or HR_MANAGER and nothing else. So on production
 * every line manager in the company was emailed "Action Required" with nowhere
 * to act, while the API would have approved the request if asked directly.
 *
 * Both manager shapes are covered, because they land on different screens:
 *   - REGIONAL_MANAGER reaches /hr and gets the Leave Management tab;
 *   - EMPLOYEE is redirected off /hr to their own profile and would see
 *     nothing at all if the block only lived on the HR tab.
 *
 * Driven through the API for the data and through the browser for the controls,
 * since "the manager has permission" and "the manager has a button" were the
 * two halves that had come apart.
 */
import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, api, BASE,
  startSection, expect, summary, TAG,
} from "./qa-lib.mjs";

const { generate: totpGenerate } = await import("otplib");
const ctxs = [];
let browser;

/** A weekday range in the future, so the request is valid and chargeable. */
function nextWeekdays(offsetDays, span) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() + span);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { start: iso(d), end: iso(end) };
}

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

/** A manager with an employee record, and one report under them. */
async function makePair(managerRole, offsetDays) {
  const manager = await createAndLogin({ role: managerRole, withEmployee: true });
  ctxs.push(manager);
  const report = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(report);

  // Three years' tenure, so the vacation entitlement has accrued and nothing
  // fails on a waiting period rather than on the thing under test.
  const threeYearsAgo = new Date(Date.UTC(new Date().getUTCFullYear() - 3, 0, 15));
  await db.employee.update({
    where: { id: manager.employee.id },
    data: { startDate: threeYearsAgo, gender: "FEMALE" },
  });
  await db.employee.update({
    where: { id: report.employee.id },
    data: { startDate: threeYearsAgo, gender: "MALE", managerId: manager.employee.id },
  });

  const { start, end } = nextWeekdays(offsetDays, 2);
  const applied = await api(report.jar, "POST", "/api/hr/leave", {
    employeeId: report.employee.id,
    leaveType: "VACATION_PAID",
    startDate: start,
    endDate: end,
    reason: `${TAG} manager approval test`,
  });
  expect(applied.status === 201,
    `[${managerRole}] the report's leave request was created`,
    `status ${applied.status} ${JSON.stringify(applied.payload).slice(0, 140)}`);

  return { manager, report, requestId: applied.payload?.request?.id ?? null, start, end };
}

async function main() {
  browser = await chromium.launch();

  // ── The role that reaches /hr ──────────────────────────────────────────
  startSection("A REGIONAL_MANAGER sees their team's queue on the HR tab");
  const rm = await makePair("REGIONAL_MANAGER", 21);

  const teamList = await api(rm.manager.jar, "GET", "/api/hr/leave?scope=team&status=PENDING");
  const teamIds = (teamList.payload?.requests ?? []).map((r) => r.id);
  expect(teamIds.includes(rm.requestId),
    "*** scope=team returns the report's request to their manager ***",
    `got ${teamIds.length} row(s)`);

  const teamRow = (teamList.payload?.requests ?? []).find((r) => r.id === rm.requestId);
  expect(teamRow?.canDecide === true,
    "and marks it as one this manager may decide",
    `canDecide=${teamRow?.canDecide}`);

  // The response used to `include: { employee: true }`, handing over every
  // scalar on the row. Managers reach this endpoint now; a leave queue is not
  // where someone's home address belongs.
  const leaked = ["address", "emergencyContact", "emergencyPhone", "phone", "gender", "costCentre"]
    .filter((f) => teamRow?.employee && f in teamRow.employee);
  expect(leaked.length === 0,
    "the row carries no personal detail beyond name and employee id",
    `leaked: ${leaked.join(", ")}`);

  // Own list must stay own. Mixing the team's rows into "Your leave requests"
  // would make a manager's own history and their approval queue the same list.
  const ownList = await api(rm.manager.jar, "GET", "/api/hr/leave");
  expect(!(ownList.payload?.requests ?? []).some((r) => r.id === rm.requestId),
    "the default list still holds only the manager's own requests",
    `${(ownList.payload?.requests ?? []).length} row(s)`);

  {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    await signIn(page, rm.manager);
    await page.goto(`${BASE}/hr?tab=leave`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);
    const text = await page.locator("main").innerText();
    expect(/awaiting your approval/i.test(text),
      "*** the HR tab shows an 'Awaiting your approval' block ***",
      text.replace(/\n/g, " ").slice(0, 200));
    expect(text.includes(rm.report.employee.employeeId),
      "naming the report whose request it is", rm.report.employee.employeeId);

    const approve = page.getByRole("button", { name: /^approve$/i }).first();
    expect(await approve.count() > 0, "with a working Approve control");
    await approve.click();

    // Polled, not slept: a fixed wait races the write and reads the old status,
    // which is a test bug that looks exactly like a product bug.
    let status = "PENDING";
    for (let i = 0; i < 25 && status === "PENDING"; i++) {
      await page.waitForTimeout(400);
      status = (await db.leaveRequest.findUnique({ where: { id: rm.requestId }, select: { status: true } }))?.status;
    }
    expect(status === "APPROVED",
      "*** clicking Approve approves it in the database ***", String(status));

    const bal = await db.leaveBalance.findFirst({
      where: { employeeId: rm.report.employee.id, leaveType: "VACATION_PAID" },
    });
    expect(bal?.usedDays === 3 && bal?.pendingDays === 0,
      "and moves the days from pending to used",
      `used=${bal?.usedDays} pending=${bal?.pendingDays}`);
    await page.context().close();
  }

  // ── The role that is redirected away from /hr ──────────────────────────
  startSection("An EMPLOYEE who manages people sees it on their own profile");
  const emp = await makePair("EMPLOYEE", 60);

  {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    await signIn(page, emp.manager);
    await page.goto(`${BASE}/hr?tab=leave`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);

    const path = new URL(page.url()).pathname + new URL(page.url()).search;
    expect(path === `/hr/employees/${emp.manager.employee.id}?tab=leave`,
      "*** ?tab=leave survives the redirect to their own profile ***", path);

    const activeTab = await page.locator('[role="tab"][data-state="active"]').first().innerText().catch(() => "");
    expect(/leave/i.test(activeTab), "and the Leave tab is the one open", activeTab);

    const text = await page.locator("main").innerText();
    expect(/awaiting your approval/i.test(text),
      "*** their team's queue reaches them here ***",
      text.replace(/\n/g, " ").slice(0, 200));

    await page.getByRole("button", { name: /^reject$/i }).first().click();
    let status = "PENDING";
    for (let i = 0; i < 25 && status === "PENDING"; i++) {
      await page.waitForTimeout(400);
      status = (await db.leaveRequest.findUnique({ where: { id: emp.requestId }, select: { status: true } }))?.status;
    }
    expect(status === "REJECTED",
      "*** and Reject works for an EMPLOYEE-role manager ***", String(status));

    const bal = await db.leaveBalance.findFirst({
      where: { employeeId: emp.report.employee.id, leaveType: "VACATION_PAID" },
    });
    expect(bal?.pendingDays === 0 && bal?.usedDays === 0,
      "a rejection releases the reserved days", `used=${bal?.usedDays} pending=${bal?.pendingDays}`);
    await page.context().close();
  }

  // ── Nobody else gets in ────────────────────────────────────────────────
  startSection("Scope holds for someone who is not the manager");
  const stranger = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(stranger);

  const strangerTeam = await api(stranger.jar, "GET", "/api/hr/leave?scope=team&status=PENDING");
  expect((strangerTeam.payload?.requests ?? []).length === 0,
    "scope=team is empty for someone with no direct reports",
    `${(strangerTeam.payload?.requests ?? []).length} row(s)`);

  // Kept inside this calendar year on purpose. Vacation resets on 31 December
  // and accrues 1.75 days a month, so a request starting in February next year
  // is checked against February's accrual — 1.75 days — and a 3-day request is
  // correctly refused. A 120-day offset put the range in next year and the
  // fixture failed on the policy rather than on the thing under test.
  const rm2 = await makePair("REGIONAL_MANAGER", 40);
  const steal = await api(stranger.jar, "GET", `/api/hr/leave?employeeId=${rm2.report.employee.id}`);
  expect(steal.status === 403,
    "asking for somebody else's leave by id is still refused", `status ${steal.status}`);
  const stealPatch = await api(stranger.jar, "PATCH", `/api/hr/leave/${rm2.requestId}`, { action: "APPROVED" });
  expect(stealPatch.status === 403,
    "and a non-manager cannot decide it", `status ${stealPatch.status}`);

  // ── Applying tells the manager in the app, not only by email ───────────
  startSection("The manager is notified in the app when leave is applied for");
  const notif = await db.notification.findFirst({
    where: { userId: rm2.manager.user.id, type: "LEAVE" },
    orderBy: { createdAt: "desc" },
  });
  expect(!!notif,
    "*** applying creates a notification for the direct manager ***",
    "none found — the email was the only notice, and the decision route already notifies the employee");
  expect(/awaiting your approval/i.test(notif?.title ?? ""),
    "and it says what is being asked of them", notif?.title ?? "");
  expect((notif?.link ?? "").includes("/hr"),
    "and links to where the decision is made", notif?.link ?? "");

  // ── The holiday calendar an employee can finally open ──────────────────
  startSection("An employee can read the holiday calendar");
  const holiday = await db.holiday.create({
    data: {
      name: `${TAG} Test Holiday`,
      date: new Date(Date.UTC(new Date().getUTCFullYear(), 11, 26)),
      isGlobal: true,
      createdById: stranger.user.id,
    },
  });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    await signIn(page, stranger);
    await page.goto(`${BASE}/hr?tab=holidays`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);

    const path = new URL(page.url()).pathname + new URL(page.url()).search;
    expect(path === `/hr/employees/${stranger.employee.id}?tab=holidays`,
      "?tab=holidays survives the redirect too", path);

    const tabs = await page.locator('[role="tab"]').allInnerTexts();
    expect(tabs.some((t) => /holiday/i.test(t)),
      "*** there is a Holidays tab on their own profile ***", tabs.join(", "));

    const text = await page.locator("main").innerText();
    expect(text.includes(`${TAG} Test Holiday`),
      "*** and it lists the holidays that apply to them ***",
      text.replace(/\n/g, " ").slice(0, 200));
    await page.context().close();
  } finally {
    await db.holiday.delete({ where: { id: holiday.id } }).catch(() => {});
  }

  // ── The dashboard no longer points at a module nobody can open ─────────
  startSection("The personal dashboard");
  {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    await signIn(page, stranger);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);
    const text = await page.locator("main").innerText();

    expect(!/travel requests/i.test(text),
      "*** the dead Travel Requests card is gone ***",
      "/travel is redirected to /recruitment-planning, which this role cannot open");
    expect(!/annual leave left/i.test(text),
      "the retired 'Annual Leave' wording is gone",
      text.replace(/\n/g, " ").slice(0, 200));
    expect(/vacation \(paid\) left/i.test(text),
      "and the card is named from the policy instead",
      text.replace(/\n/g, " ").slice(0, 200));
    expect(!/awaiting your approval/i.test(text),
      "someone with no reports is not offered an approvals card");

    const hrefs = await page.locator('a[href="/travel"]').count();
    expect(hrefs === 0, "nothing on the page links to /travel", `${hrefs} link(s)`);
    await page.context().close();
  }
  {
    // The EMPLOYEE-role manager, not the REGIONAL_MANAGER one. A disposable
    // REGIONAL_MANAGER has no region, and /dashboard renders a "No region
    // assigned to your account" notice for them instead of the ERP workspace —
    // so the card under test is not on the page for a reason that has nothing
    // to do with it.
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    await signIn(page, emp.manager);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);
    const text = await page.locator("main").innerText();
    expect(/awaiting your approval/i.test(text),
      "a manager IS offered one, with their pending count",
      text.replace(/\n/g, " ").slice(0, 200));
    await page.context().close();
  }
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally {
  startSection("Teardown");
  if (browser) await browser.close().catch(() => {});
  // Managers before reports is wrong: the report row points at the manager row
  // through managerId, so clear the pointers first or the deletes fail on their
  // own self-referencing foreign key.
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
    await db.holiday.deleteMany({ where: { createdById: c.user.id } }).catch(() => {});
    await destroyUser(c);
  }
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
