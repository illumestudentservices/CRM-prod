/**
 * The five screens that had no search: type in each box and check it finds.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-new-searches-ui.mjs
 *
 * ★ A BOX EXISTING IS NOT A BOX WORKING.
 *
 * That distinction is the whole history of this week. The Employees directory
 * had a search box for months; it was bound to the ID column, so typing a
 * colleague's name answered "No results found". Every suite was green, because
 * every suite asked what the server returned and none asked what the screen
 * did with it.
 *
 * So this types a term taken from the screen itself and requires the match to
 * survive, then types nonsense and requires the screen to say so. Each screen
 * is named explicitly — a generic crawler guessing at page structure was tried
 * first and was wrong five different ways, every time producing output that
 * looked like a result.
 */
import { chromium } from "playwright";
import { db, createAndLogin, destroyUser, BASE } from "./qa-lib.mjs";
const { totpGenerate } = await import("../lib/totp.ts");

/** route, label, this screen's OWN search placeholder, a term that must match. */
const CASES = [
  ["/hr?tab=holidays",   "HR · Holidays",        /holidays, region or date/i, "SEED-"],
  ["/hr?tab=timesheets", "HR · Timesheets",      /person, period or status/i, "2029"],
  ["/reports",           "Reports",              /ICR, institution, period/i, null],
  ["/stakeholders",      "Stakeholders",         /schools, country, city/i,   null],
  ["/market-intelligence", "Market intelligence", /market, country, manager/i, null],
];

const NONSENSE = "zzzz-no-such-thing-zzzz";

const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
const sec = await db.user.findUnique({
  where: { id: admin.user.id }, select: { twoFactorSecret: true },
});

let pass = 0, fail = 0;
const check = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  → " + detail : ""}`); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
let pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message.split(String.fromCharCode(10))[0].slice(0, 100)));

/** Items on screen: rows if the screen uses a table, cards otherwise. */
async function countItems() {
  await page.waitForTimeout(700);
  const rows = await page.locator("table tbody tr").count();
  if (rows > 0) return rows;
  return page.locator('[class*="rounded-lg"][class*="border"]').count();
}

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

  for (const [route, label, placeholder, seedTerm] of CASES) {
    console.log(`\n── ${label} ──`);
    pageErrors = [];
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(6000);

    check(pageErrors.length === 0, "the screen loads without crashing", pageErrors[0] ?? "");
    if (pageErrors.length) continue;

    const box = page.getByPlaceholder(placeholder).first();
    check(await box.count() > 0, "it has a search box of its own",
      "no box matching " + placeholder);
    if (await box.count() === 0) continue;

    const before = await countItems();
    check(before > 0, "and something to search", `${before} item(s)`);
    if (before === 0) continue;

    // A term taken from the screen, so the search is judged on what a reader
    // can actually see.
    const firstText = await (
      (await page.locator("table tbody tr").count())
        ? page.locator("table tbody tr").first()
        : page.locator('[class*="rounded-lg"][class*="border"]').nth(1)
    ).innerText().catch(() => "");
    const token = seedTerm ?? firstText
      .split(/\s+/)
      .map((w) => w.replace(/[^\w@.\-]/g, ""))
      .filter((w) => w.length >= 4 && !/^\d+$/.test(w))[0];

    check(!!token, "with a readable term to search for", firstText.slice(0, 50));
    if (!token) continue;

    await box.fill(token);
    const after = await countItems();
    const visible = await page.getByText(token, { exact: false }).count();
    check(after > 0 && visible > 0,
      `*** typing "${token}" keeps the match ***`,
      `${before} → ${after} item(s), ${visible} on screen`);
    check(after <= before, "and does not somehow show more", `${before} → ${after}`);

    await box.fill(NONSENSE);
    const none = await countItems();
    const saidSo = await page.getByText(/no .*(match|found|yet)/i).count();
    check(none === 0 || saidSo > 0,
      "*** nonsense gives an empty state, not a blank panel ***",
      `${none} item(s) left, empty state ${saidSo}`);

    await box.fill("");
    const restored = await countItems();
    check(restored === before, "clearing the box restores everything",
      `${restored} vs ${before}`);
  }
} catch (e) {
  fail++;
  console.error("\nFATAL:", e.message);
} finally {
  await ctx.close();
  await browser.close();
  await destroyUser(admin);
  await db.$disconnect();
  console.log(`\n${"=".repeat(58)}\n  TOTAL: ${pass} pass / ${fail} fail\n${"=".repeat(58)}`);
  process.exit(fail ? 1 : 0);
}
