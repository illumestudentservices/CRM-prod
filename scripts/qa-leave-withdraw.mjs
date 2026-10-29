/**
 * The Withdraw button on an employee's own pending leave requests:
 *   - cancels the request (status → CANCELLED) and frees the pending balance;
 *   - exercised live 3 times back-to-back.
 *
 *   npx tsx --env-file=.env.local scripts/qa-leave-withdraw.mjs
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const B = BASE.replace("127.0.0.1", "localhost");
const YEAR = 2026;
const PER = 2; // days per request
const N = 3;

let browser, emp, balanceId, reqIds = [];
try {
  emp = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  const employeeId = emp.employee.id;

  // A balance to decrement, pre-loaded with the pending days for N requests.
  const bal = await db.leaveBalance.create({
    data: { employeeId, leaveType: "VACATION_PAID", year: YEAR, totalDays: 20, usedDays: 0, pendingDays: PER * N },
  });
  balanceId = bal.id;

  // N pending requests on distinct future weekdays.
  for (let i = 0; i < N; i++) {
    const start = new Date(Date.UTC(YEAR, 11, 7 + i * 3)); // Dec 7, 10, 13 2026
    const r = await db.leaveRequest.create({
      data: { employeeId, leaveType: "VACATION_PAID", startDate: start, endDate: start, days: PER, status: "PENDING", reason: `QA withdraw ${i}` },
    });
    reqIds.push(r.id);
  }

  // Pre-warm the page + auth + leave API via reliable node fetch so the browser
  // hits compiled, fast routes (the Next dev server otherwise resets the
  // browser's NextAuth session fetch mid-compile, which breaks hydration — so
  // the tab never switches and the Leave section never mounts).
  const warm = (path) => fetch(`${BASE}${path}`, { headers: { Cookie: emp.jar.header() } }).then(() => {}).catch(() => {});
  for (const path of ["/api/auth/session", "/api/auth/csrf", "/api/auth/providers",
                      `/api/hr/leave?employeeId=${employeeId}`,
                      `/hr/employees/${employeeId}`, `/hr/employees/${employeeId}?tab=leave`]) {
    await warm(path);
  }

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  await ctx.addCookies([...emp.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const p = await ctx.newPage();
  p.on("dialog", (d) => d.accept()); // auto-confirm the "Withdraw?" prompt

  const withdrawBtn = p.getByRole("button", { name: "Withdraw" });
  // The page honours ?tab=leave, landing on the Leave History (after hydration).
  // Reload until the client has hydrated — the Leave History heading appears —
  // and a Withdraw button is visible.
  let ready = false;
  for (let attempt = 0; attempt < 6 && !ready; attempt++) {
    await p.goto(`${B}/hr/employees/${employeeId}?tab=leave`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
    await p.getByText("Leave History").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    ready = await withdrawBtn.first().waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
  }

  startSection("Withdraw a pending leave request, live, 3 times");
  expect(ready, "Leave tab renders Withdraw buttons on pending requests");

  const poll = async (fn, want, ms = 45000) => {
    const t0 = Date.now();
    let v;
    do { v = await fn(); if (v === want) return v; await p.waitForTimeout(1000); } while (Date.now() - t0 < ms);
    return v;
  };

  for (let i = 0; i < N; i++) {
    const before = await withdrawBtn.count();
    expect(before === N - i, `${N - i} pending request(s) show a Withdraw button`, `saw ${before}`);
    await withdrawBtn.first().click();
    // The dev server's PATCH + refetch can be slow — poll the DB (authoritative)
    // and then the UI, rather than racing a fixed wait.
    const cancelled = await poll(() => db.leaveRequest.count({ where: { employeeId, status: "CANCELLED" } }), i + 1);
    expect(cancelled === i + 1, `withdraw #${i + 1} recorded in DB (CANCELLED = ${i + 1})`, `got ${cancelled}`);
    const after = await poll(() => withdrawBtn.count(), N - i - 1);
    expect(after === N - i - 1, `after withdraw #${i + 1}, ${N - i - 1} Withdraw button(s) remain`, `saw ${after}`);
  }

  startSection("Balance freed");
  const finalPending = await poll(() => db.leaveBalance.findUnique({ where: { id: balanceId }, select: { pendingDays: true } }).then((b) => b?.pendingDays), 0);
  expect(finalPending === 0, "all pending days released back to the balance", `pendingDays=${finalPending}`);
  const stillPending = await db.leaveRequest.count({ where: { employeeId, status: "PENDING" } });
  expect(stillPending === 0, "no pending requests remain", `got ${stillPending}`);
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const id of reqIds) await db.leaveRequest.delete({ where: { id } }).catch(() => {});
  if (balanceId) await db.leaveBalance.delete({ where: { id: balanceId } }).catch(() => {});
  if (emp) await destroyUser(emp);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
