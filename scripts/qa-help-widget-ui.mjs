/**
 * The help widget, driven in a real browser, three passes.
 *
 *   node --import tsx --env-file=.env scripts/qa-help-widget-ui.mjs
 *
 * The search logic is already covered by qa-assistant.mjs. This checks the part
 * that suite cannot: that a person can open the thing, type, and be taken to
 * the right screen — and that what it shows respects the signed-in role.
 *
 * Each pass signs in through the real form with its own account and destroys it
 * afterwards, confirming the user count returns to baseline.
 */

import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

const PASSES = 3;
const allCreated = [];

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

const openWidget = (page) =>
  page.getByRole("button", { name: /help.*find a feature/i }).click();

async function runPass(pass, browser) {
  startSection(`PASS ${pass} — help widget as SUPER_ADMIN`);

  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  allCreated.push(admin);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|DevTools|Fast Refresh/i.test(m.text())) {
      errs.push(m.text());
    }
  });

  await signIn(page, admin);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 45000 });

  // ── It exists and opens ───────────────────────────────────────────────
  const trigger = page.getByRole("button", { name: /help.*find a feature/i });
  expect(await trigger.count() > 0, "*** the help button is present on every screen ***");

  await openWidget(page);
  await page.waitForTimeout(500);
  const panel = page.getByRole("dialog", { name: /find a feature/i });
  expect(await panel.count() > 0, "*** clicking it opens the panel ***");

  const panelText = await panel.innerText();
  expect(/Try asking/i.test(panelText),
    "an empty box offers starting points rather than nothing", panelText.slice(0, 60));

  // ── Typing produces an answer ─────────────────────────────────────────
  const input = page.getByLabel(/what are you looking for/i);
  await input.fill("where are my students");
  await page.waitForFunction(
    () => /\/students/.test(document.querySelector('[role="dialog"]')?.textContent ?? ""),
    { timeout: 15000 }
  ).catch(() => {});

  const answered = await panel.innerText();
  expect(/Students/i.test(answered) && /\/students/.test(answered),
    "*** typing a question answers it with the screen and its path ***",
    answered.replace(/\n/g, " ").slice(0, 90));

  // ── The result navigates ──────────────────────────────────────────────
  await page.getByRole("button", { name: /Students & Pipeline/i }).first().click();
  await page.waitForURL(/\/students/, { timeout: 20000 });
  ok("*** clicking a result takes you to the screen ***");

  // Panel closes on navigation, so the next screen is not covered by it.
  await page.waitForTimeout(600);
  expect(await page.getByRole("dialog", { name: /find a feature/i }).count() === 0,
    "the panel closes once you have gone somewhere");

  // ── Escape closes ─────────────────────────────────────────────────────
  await openWidget(page);
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  expect(await page.getByRole("dialog", { name: /find a feature/i }).count() === 0,
    "*** Escape closes the panel ***");

  // ── A miss still helps, and offers IT ─────────────────────────────────
  await openWidget(page);
  await page.waitForTimeout(400);
  await page.getByLabel(/what are you looking for/i).fill("qwertyuiop nonsense");
  // Wait for the answer to arrive rather than guessing a duration: the debounce
  // plus round trip is short but not fixed, and a fixed wait reads the panel
  // header and concludes the widget said nothing.
  await page.waitForFunction(
    () => /could not find/i.test(document.querySelector('[role="dialog"]')?.textContent ?? ""),
    { timeout: 15000 }
  ).catch(() => {});
  const missText = await page.getByRole("dialog").innerText();
  expect(/could not find/i.test(missText),
    "*** an unmatched question says so ***", missText.slice(0, 70));
  // The copy changed when escalation became automatic: the user is told it has
  // been reported rather than asked to report it themselves.
  expect(/reported automatically/i.test(missText),
    "*** a miss tells the user it has been reported ***", missText.slice(0, 90));
  expect(/Add more detail/i.test(missText),
    "*** and still offers to add context ***");

  const real = errs.filter((e) => !/hydrat/i.test(e));
  expect(real.length === 0, "no uncaught errors from the widget", real.slice(0, 2).join(" | "));

  await ctx.close();

  // ── The same widget, a weaker role ────────────────────────────────────
  const emp = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  allCreated.push(emp);
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page2 = await ctx2.newPage();
  await signIn(page2, emp);
  await page2.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 45000 });
  await openWidget(page2);
  await page2.waitForTimeout(400);
  await page2.getByLabel(/what are you looking for/i).fill("users and roles");
  await page2.waitForFunction(
    () => /does not have access|could not find/i.test(
      document.querySelector('[role="dialog"]')?.textContent ?? ""
    ),
    { timeout: 15000 }
  ).catch(() => {});

  const empText = await page2.getByRole("dialog").innerText();
  expect(/does not have access/i.test(empText),
    "*** an employee is told Settings is out of reach, not shown a link ***",
    empText.replace(/\n/g, " ").slice(0, 90));
  expect(!/\/settings/.test(empText),
    "*** no link to a screen they cannot open ***");

  await ctx2.close();

  // ── Mobile ────────────────────────────────────────────────────────────
  // Previously untested. The panel is a bottom sheet below sm, so the checks
  // are that it fits the viewport, does not cover the trigger, and still
  // answers.
  const ctx3 = await browser.newContext({
    viewport: { width: 390, height: 844 },   // iPhone-class
    isMobile: true, hasTouch: true,
  });
  const page3 = await ctx3.newPage();
  await signIn(page3, emp);
  await page3.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 45000 });

  const btn = page3.getByRole("button", { name: /help.*find a feature/i });
  expect(await btn.count() > 0, "*** the help button is reachable on a phone ***");

  const btnBox = await btn.boundingBox();
  expect(!!btnBox && btnBox.x + btnBox.width <= 390 && btnBox.y + btnBox.height <= 844,
    "*** the button sits inside the viewport ***", JSON.stringify(btnBox));

  await btn.click();
  await page3.waitForTimeout(600);
  const sheet = page3.getByRole("dialog", { name: /find a feature/i });
  expect(await sheet.count() > 0, "*** the panel opens on a phone ***");

  const box = await sheet.boundingBox();
  expect(!!box && box.width <= 390 && box.x >= 0,
    "*** the panel fits the screen width ***", JSON.stringify(box));
  expect(!!box && box.height <= 844 * 0.75,
    "*** it does not swallow the whole screen ***", `h=${box?.height}`);

  await page3.getByLabel(/what are you looking for/i).fill("book time off");
  await page3.waitForFunction(
    () => /Leave|HR/i.test(document.querySelector('[role="dialog"]')?.textContent ?? ""),
    { timeout: 15000 }
  ).catch(() => {});
  const mobileText = await sheet.innerText();
  expect(/Leave|HR/i.test(mobileText),
    "*** it answers on a phone ***", mobileText.slice(0, 70));
  await ctx3.close();

  for (const u of [admin, emp]) {
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
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.message ?? "", "\n", e);
  fail("harness crashed", String(e?.message).slice(0, 140));
} finally {
  for (const c of allCreated) await destroyUser(c);
  const leaked = await db.user.count({
    where: { email: { contains: TAG.toLowerCase() } },
  }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leaked}\n`);
  await db.$disconnect();
}
summary();
