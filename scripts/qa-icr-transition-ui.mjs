/**
 * ICR Transition UI — real browser, real form login, three passes.
 *
 *   node --import tsx --env-file=.env scripts/qa-icr-transition-ui.mjs
 *
 * The API suite proves the rules. This proves a person can actually reach them:
 * the module was API-complete and entirely unusable until these screens existed,
 * which is exactly the gap that shipped Timesheets with no way to switch it on.
 *
 * Each pass creates its own accounts, drives the screens, and destroys the
 * accounts, confirming the user count returns to baseline.
 */

import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

const PASSES = 3;
const allCreated = [];
const made = { institutions: [] };

async function signIn(page, acct) {
  const row = await db.user.findUnique({
    where: { id: acct.user.id }, select: { twoFactorSecret: true },
  });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 }
  );
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(row.twoFactorSecret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
}

async function runPass(pass, browser) {
  startSection(`PASS ${pass} — ICR Transition screens`);

  const rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  const icr = await createAndLogin({ role: "ICR", withEmployee: true });
  allCreated.push(rm, icr);

  const inst = await db.institution.create({
    data: {
      name: `${TAG}-p${pass}-Handover Uni`, country: "Malaysia",
      type: "UNIVERSITY", createdById: rm.user.id,
    },
  });
  made.institutions.push(inst.id);

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|DevTools|Fast Refresh/i.test(m.text())) errs.push(m.text());
  });

  // ── Regional Manager assigns through the dialog ───────────────────────
  await signIn(page, rm);
  await page.goto(`${BASE}/icr-transition`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});

  const body = await page.locator("body").innerText().catch(() => "");
  expect(/ICR Transition/i.test(body), "*** the ICR Transition screen exists and renders ***",
    body.slice(0, 70).replace(/\n/g, " "));
  expect(!/Application error|Unhandled Runtime/i.test(body), "no error boundary on the list");

  const assign = page.getByRole("button", { name: /assign handover/i });
  expect(await assign.count() > 0, "*** a manager sees the assign control ***");
  await assign.first().click();
  await page.waitForTimeout(800);

  const dialogText = await page.locator('[role="dialog"]').innerText().catch(() => "");
  expect(/Assign a Transition Report/i.test(dialogText), "the assign dialog opens",
    dialogText.slice(0, 60).replace(/\n/g, " "));

  // Fill it as a person would.
  const selects = page.locator('[role="dialog"] select');
  await selects.nth(0).selectOption({ label: `${TAG} ICR` }).catch(async () => {
    await selects.nth(0).selectOption({ index: 1 });
  });
  await selects.nth(1).selectOption({ label: `${TAG}-p${pass}-Handover Uni (Malaysia)` });
  await selects.nth(2).selectOption({ index: 1 });

  const dates = page.locator('[role="dialog"] input[type="date"]');
  const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  await dates.nth(0).fill(d(30));   // effective
  await dates.nth(1).fill(d(20));   // due

  // The inline guard must appear when the due date is after the transition.
  await dates.nth(1).fill(d(40));
  await page.waitForTimeout(400);
  const warned = await page.locator('[role="dialog"]').innerText();
  expect(/due after the ICR has already gone/i.test(warned),
    "*** the form warns when the report would be due too late ***");
  await dates.nth(1).fill(d(20));
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: /^assign handover$/i }).last().click();
  await page.waitForURL(/\/icr-transition\/[0-9a-f-]{36}/, { timeout: 30000 });
  ok("assigning navigates to the new report");

  const reportUrl = page.url();
  const reportId = reportUrl.split("/").pop();

  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  // The editor renders its textareas once the body has loaded; that is the
  // same signal the ICR path waits on and it is reliable.
  await page.waitForSelector("textarea", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  const detail = await page.locator("body").innerText();
  expect(/0\/15 sections/i.test(detail), "*** the report opens showing 15 sections ***",
    detail.slice(0, 80).replace(/\n/g, " "));
  expect(/Live CRM data/i.test(detail), "*** an open report is labelled as live CRM data ***");

  // An RM must not be offered the ICR's editing controls.
  const rmTextareas = await page.locator("textarea:not([disabled])").count();
  expect(rmTextareas === 0, "*** the Regional Manager cannot type into the ICR's sections ***",
    `${rmTextareas} editable boxes`);

  await ctx.close();

  // ── The ICR completes it ──────────────────────────────────────────────
  const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page2 = await ctx2.newPage();
  page2.on("pageerror", (e) => errs.push(e.message));

  await signIn(page2, icr);
  await page2.goto(reportUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page2.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});

  const editable = await page2.locator("textarea:not([disabled])").count();
  expect(editable === 15, "*** the outgoing ICR gets all 15 narrative boxes ***", `${editable}`);

  // Fill and complete the first section through the UI.
  await page2.locator("textarea").first().fill(`${TAG} executive handover summary`);
  await page2.getByRole("button", { name: /save & mark complete/i }).first().click();
  // Save then refetch; wait for the counter itself rather than a fixed delay.
  await page2.waitForFunction(
    () => /[1-9]\d*\/15 sections/.test(document.body.innerText),
    { timeout: 20000 }
  ).catch(() => {});
  await page2.waitForTimeout(500);

  const after = await page2.locator("body").innerText();
  expect(/1\/15 sections/i.test(after), "*** saving a section updates progress ***",
    (after.match(/\d+\/15 sections/) ?? ["?"])[0]);

  // Submitting an incomplete report must be impossible from the UI too.
  const submitBtn = page2.getByRole("button", { name: /submit to regional manager/i });
  if (await submitBtn.count()) {
    expect(await submitBtn.first().isDisabled(),
      "*** submit stays disabled while sections are outstanding ***");
  }
  expect(/Still outstanding/i.test(after), "*** the screen lists what is still outstanding ***");

  const real = errs.filter((e) => !/hydrat/i.test(e));
  expect(real.length === 0, "no uncaught errors on the transition screens",
    real.slice(0, 2).join(" | "));

  await ctx2.close();

  // ── Teardown ──────────────────────────────────────────────────────────
  await db.transitionReport.deleteMany({ where: { id: reportId } }).catch(() => {});
  await db.institution.deleteMany({ where: { id: inst.id } }).catch(() => {});
  made.institutions = made.institutions.filter((x) => x !== inst.id);

  for (const u of [rm, icr]) {
    await destroyUser(u);
    const left = await db.user.count({ where: { id: u.user.id } });
    expect(left === 0, `pass ${pass}: ${u.user.role} account deleted`, `${left} remaining`);
    if (left === 0) {
      const i = allCreated.indexOf(u);
      if (i >= 0) allCreated.splice(i, 1);
    }
  }
}

async function main() {
  startSection("Baseline");
  const before = await db.user.count();
  ok(`users=${before}`);

  const browser = await chromium.launch();
  try {
    for (let p = 1; p <= PASSES; p++) await runPass(p, browser);
  } finally {
    await browser.close();
  }

  startSection("Footprint");
  expect(await db.user.count() === before, "*** user count back to baseline ***");
  expect(await db.transitionReport.count() === 0, "*** no report survived ***");
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", String(e?.message).slice(0, 140));
} finally {
  await db.transitionReport.deleteMany({}).catch(() => {});
  await db.institution.deleteMany({ where: { id: { in: made.institutions } } }).catch(() => {});
  for (const c of allCreated) await destroyUser(c);
  const leaked = await db.user.count({ where: { email: { contains: TAG.toLowerCase() } } }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leaked}\n`);
  await db.$disconnect();
}
summary();
