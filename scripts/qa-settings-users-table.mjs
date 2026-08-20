/**
 * Settings → Users & Roles: one Export button, and a search that filters.
 *
 * Both symptoms had one cause — no column declared an accessor, so
 * row.getValue() returned nothing and the global filter (and the built-in CSV)
 * had nothing to work with.
 */
import { chromium } from "playwright";
import { db, createAndLogin, destroyUser, BASE, TAG } from "./qa-lib.mjs";
const { totpGenerate } = await import("../lib/totp.ts");

const admin = await createAndLogin({ role: "SUPER_ADMIN" });
const row = await db.user.findUnique({
  where: { id: admin.user.id }, select: { twoFactorSecret: true },
});

let pass = 0, fail = 0;
const check = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  → " + detail : ""}`); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(admin.email);
  await page.locator('input[type="password"]').fill(admin.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"), { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(row.twoFactorSecret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((x) => !/verify-2fa|login/.test(x.pathname), { timeout: 30000 });

  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);

  const exports = await page.getByRole("button", { name: /^export$/i }).count();
  check(exports === 1, `exactly one Export button`, `found ${exports}`);

  const search = page.getByPlaceholder(/search users/i).first();
  check(await search.count() > 0, "the search box is present");

  const before = await page.locator("table tbody tr").count();
  check(before > 1, `table starts with rows`, `${before}`);

  // Search for the disposable admin, which is the only row that can match.
  await search.fill(TAG);
  await page.waitForTimeout(1200);
  const after = await page.locator("table tbody tr").count();
  check(after > 0 && after < before,
    `*** searching narrows the table (${before} → ${after}) ***`,
    after === before ? "filter did nothing" : "no rows matched");

  // And a term that cannot match anything.
  await search.fill("zzzz-no-such-user-zzzz");
  await page.waitForTimeout(1200);
  const none = await page.locator("table tbody tr").count();
  const body = await page.locator("body").innerText();
  check(none === 0 || /no results|no users/i.test(body),
    "*** a non-matching term empties the table ***", `${none} rows still shown`);

  await search.fill("");
  await page.waitForTimeout(1000);
  const restored = await page.locator("table tbody tr").count();
  check(restored === before, "clearing the search restores every row", `${restored} vs ${before}`);
} catch (e) {
  check(false, "run completed", String(e.message).split("\n")[0].slice(0, 140));
} finally {
  await browser.close();
  await destroyUser(admin);
  await db.$disconnect();
}
console.log(`\nSETTINGS: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
