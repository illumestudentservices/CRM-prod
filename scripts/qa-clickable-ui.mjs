/**
 * Things that look clickable, and whether they are.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-clickable-ui.mjs
 *
 * ★ REPORTED: "Can't click on the Graphs on HR and ERP, and I'm not able to
 * click on regions in regions page."
 *
 * Neither had a broken handler. Neither had a handler at all. The region
 * cards even carried hover:shadow-md and a `group` class, so they lifted
 * under the cursor and did nothing — the clearest possible promise of an
 * interaction that was never wired.
 *
 * This clicks them for real and follows what happens, because "the element
 * exists" and "the element does something" are different claims, and only the
 * first was ever being checked anywhere in this codebase.
 */
import { chromium } from "playwright";
import { db, createAndLogin, destroyUser, BASE } from "./qa-lib.mjs";
const { totpGenerate } = await import("../lib/totp.ts");

const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
const sec = await db.user.findUnique({
  where: { id: admin.user.id }, select: { twoFactorSecret: true },
});

let pass = 0, fail = 0;
const check = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  → " + detail : ""}`); }
};
const section = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 52 - t.length))}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.split(String.fromCharCode(10))[0].slice(0, 90)));

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(admin.email);
  await page.locator('input[type="password"]').fill(admin.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(sec.twoFactorSecret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((x) => !/verify-2fa|login/.test(x.pathname), { timeout: 30000 });

  // ── The HR charts ────────────────────────────────────────────────────────
  section("Headcount by Department: clicking a bar");

  await page.goto(`${BASE}/hr`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(6000);
  check(errors.length === 0, "the HR page loads without crashing", errors[0] ?? "");

  const bars = page.locator(".recharts-bar-rectangle");
  const barCount = await bars.count();
  check(barCount > 0, "the charts render bars", `${barCount} bar(s)`);

  if (barCount > 0) {
    const cursor = await page.locator(".recharts-wrapper").first()
      .evaluate((el) => getComputedStyle(el).cursor);
    check(cursor === "pointer",
      "*** the chart shows a pointer cursor, so it looks clickable ***",
      `cursor: ${cursor} — Recharts writes cursor:default inline, so a plain class loses`);

    /**
     * A real mouse move, then press and release.
     *
     * click({ force: true }) does NOT work here and cost an hour: Recharts
     * computes which bar is active from pointer COORDINATES, so a synthetic
     * click dispatched straight at the element leaves activeLabel undefined
     * and the handler no-ops. The handler was fine; the test was wrong, and
     * it reported the feature broken twice over.
     */
    const box = await bars.first().boundingBox();
    check(!!box, "the bar has a position to click", "no bounding box");
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);
      await page.mouse.down();
      await page.mouse.up();
    }
    await page.waitForTimeout(2500);
    const url = new URL(page.url());
    check(url.searchParams.get("tab") === "employees",
      "*** clicking a headcount bar opens the Employees tab ***",
      `went to ${url.pathname}${url.search}`);
    check(!!url.searchParams.get("department"),
      "*** and carries the department through ***",
      `no department in ${url.search}`);

    const dept = url.searchParams.get("department");
    if (dept) {
      await page.waitForTimeout(3000);
      const combo = page.locator('button[role="combobox"]').nth(1);
      const shown = await combo.innerText().catch(() => "");
      check(shown.includes(dept),
        "*** and the department filter is already set to it ***",
        `filter shows "${shown}", expected "${dept}"`);

      const counter = await page.getByText(/^\d+ of \d+$/).first().textContent().catch(() => "");
      const [visible] = (counter ?? "0 of 0").split(" of ").map(Number);
      const expected = await db.employee.count({
        where: { isActive: true, user: { deletedAt: null }, department: { name: dept } },
      });
      check(visible === expected,
        "and shows exactly that department's headcount",
        `${visible} on screen, ${expected} in the database`);
    }
  }

  // ── The regions page ─────────────────────────────────────────────────────
  section("Settings → Regions: clicking a region");

  errors.length = 0;
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  const regionsTab = page.getByRole("tab", { name: /regions/i });
  check(await regionsTab.count() > 0, "the Regions tab exists");
  if (await regionsTab.count()) {
    await regionsTab.first().click();
    await page.waitForTimeout(3000);
  }

  const cards = page.locator('[role="button"][tabindex="0"]').filter({ hasText: /users/ });
  const n = await cards.count();
  check(n > 0, "region cards are rendered", `${n} card(s)`);

  if (n > 0) {
    const cursor = await cards.first().evaluate((el) => getComputedStyle(el).cursor);
    check(cursor === "pointer",
      "*** a region card shows a pointer cursor ***", `cursor: ${cursor}`);

    const name = (await cards.first().innerText()).split("\n")[0].trim();
    await cards.first().click();
    await page.waitForTimeout(1500);

    const dialog = page.getByRole("dialog");
    check(await dialog.count() > 0,
      "*** clicking a region opens something ***", "nothing opened");
    if (await dialog.count()) {
      const text = await dialog.first().innerText();
      check(/edit region/i.test(text),
        "*** and it is the edit dialog ***", text.slice(0, 60));
      const nameInput = dialog.first().locator("input").first();
      const value = await nameInput.inputValue();
      check(value === name,
        "with the region's current name already filled in",
        `input "${value}", card said "${name}"`);
    }
  }
  check(errors.length === 0, "and the regions page does not crash", errors[0] ?? "");
} catch (e) {
  fail++;
  console.error("\nFATAL:", e.message);
  await page.screenshot({ path: "scratch/qa-clickable-failure.png" }).catch(() => {});
} finally {
  await ctx.close();
  await browser.close();
  await destroyUser(admin);
  await db.$disconnect();
  console.log(`\n${"=".repeat(56)}\n  TOTAL: ${pass} pass / ${fail} fail\n${"=".repeat(56)}`);
  process.exit(fail ? 1 : 0);
}
