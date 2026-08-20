/**
 * Applying for leave from the place the dashboard sends you.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-apply-leave.mjs
 *
 * The dashboard link reads "Apply for leave →" and points at /hr?tab=leave.
 * That tab listed requests and offered no way to make one — the only apply form
 * lived inside a person's own employee profile, which an EMPLOYEE reaches by
 * redirect but nobody else does without navigating to themselves deliberately.
 *
 * Driven through the browser rather than the API, because the complaint was
 * about the screen, not the endpoint: the endpoint always worked.
 */
import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");
const ctxs = [];

async function signIn(page, acct, secret) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"), { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
}

/** A weekday range in the future, so the request is valid and chargeable. */
function nextWeekdays() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 14);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); // next Monday
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() + 2);                         // to Wednesday
  const iso = (x) => x.toISOString().slice(0, 10);
  return { start: iso(d), end: iso(end) };
}

async function main() {
  startSection("Fixture");
  // An HR Manager: has an employee record, is NOT redirected away from /hr, and
  // previously had no way to book their own leave from this screen.
  const hr = await createAndLogin({ role: "HR_MANAGER", withEmployee: true });
  ctxs.push(hr);
  await db.employee.update({
    where: { id: hr.employee.id },
    data: { startDate: new Date(Date.UTC(new Date().getUTCFullYear() - 3, 0, 15)), gender: "FEMALE" },
  });
  const secret = (await db.user.findUnique({
    where: { id: hr.user.id }, select: { twoFactorSecret: true },
  })).twoFactorSecret;
  ok(`HR Manager with an employee record`, hr.employee.employeeId);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();

  try {
    await signIn(page, hr, secret);

    startSection("The dashboard link lands somewhere you can act");
    await page.goto(`${BASE}/hr?tab=leave`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2200);

    const btn = page.getByRole("button", { name: /apply for leave/i }).first();
    expect(await btn.count() > 0,
      "*** an Apply for Leave button exists on /hr?tab=leave ***",
      "the tab used to list requests with no way to make one");

    startSection("Submitting a request");
    await btn.click();
    await page.waitForTimeout(1200);

    const { start, end } = nextWeekdays();
    const dates = page.locator('[role="dialog"] input[type="date"]');
    expect(await dates.count() === 2, "the dialog asks for start and end", `${await dates.count()} date inputs`);
    await dates.nth(0).fill(start);
    await dates.nth(1).fill(end);
    await page.waitForTimeout(600);

    const dialogText = await page.locator('[role="dialog"]').innerText();
    expect(/3 working days/i.test(dialogText),
      "*** it previews 3 working days for Mon-Wed ***",
      dialogText.replace(/\n/g, " ").slice(0, 120));

    // Maternity must be offered (FEMALE) and Paternity must not.
    expect(!/paternity/i.test(dialogText), "Paternity is not offered to this employee",
      /paternity/i.test(dialogText) ? "gender filter not applied" : "");

    const before = await db.leaveRequest.count({ where: { employeeId: hr.employee.id } });
    await page.getByRole("button", { name: /submit request/i }).first().click();

    // Polled, not slept. A fixed 2.5s wait raced the write: the count read 0
    // while the very next query found the row, which is a test bug that looks
    // exactly like a product bug.
    let after = before;
    for (let i = 0; i < 20 && after === before; i++) {
      await page.waitForTimeout(400);
      after = await db.leaveRequest.count({ where: { employeeId: hr.employee.id } });
    }
    expect(after === before + 1,
      "*** the request reaches the database ***", `${before} → ${after}`);

    const created = await db.leaveRequest.findFirst({
      where: { employeeId: hr.employee.id }, orderBy: { createdAt: "desc" },
    });
    expect(created?.status === "PENDING", "and is pending approval", String(created?.status));
    expect(created?.days === 3, "charged as 3 working days, not 3 calendar days", String(created?.days));
  } finally {
    await browser.close();
  }
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 3).join("\n")); }
finally {
  startSection("Teardown");
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
