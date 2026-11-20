/**
 * Field Operations UI: a PLANNED activity dated today shows under the Planned
 * tab, and the Log Activity form now has a Status field. Regression guard for
 * "planned activity not showing".
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-fieldops-planned-ui.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const admin = await createAndLogin({ role: "SUPER_ADMIN" });
const tag = `fop${Date.now().toString().slice(-6)}`;
const title = `Planned visit ${tag}`;
let browser, inst, activity;
let fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

try {
  inst = await db.institution.create({ data: { name: `ZZ ${tag}`, country: "Canada", type: "College", createdById: admin.user.id } });
  activity = await db.activity.create({
    data: { type: "CLIENT_MEETING", title, date: new Date(), status: "PLANNED", userId: admin.user.id, institutionId: inst.id },
  });

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();

  const errs = [];
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()}`); });

  await page.goto(`${BROWSER_BASE}/field-operations`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  ok("Field Ops page renders with no error / 500", errs.length === 0, [...new Set(errs)].join(" | "));

  // The Planned status tab exists and has a non-zero count.
  const plannedTab = page.getByRole("button", { name: /^Planned \d+$/ }).first();
  ok("Planned tab present", (await plannedTab.count()) >= 1);
  await plannedTab.click();
  await page.waitForTimeout(600);

  // Our planned-today activity is listed under Planned.
  ok("today-dated PLANNED activity shows under Planned tab", (await page.getByText(title).count()) >= 1);

  // The Log Activity form now has a Status field.
  await page.getByRole("button", { name: /Log Activity/i }).first().click();
  await page.waitForTimeout(600);
  const dialog = page.getByRole("dialog");
  ok("Log Activity form has a Status field", (await dialog.getByText(/^Status/).count()) >= 1);
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (activity) await db.activity.delete({ where: { id: activity.id } }).catch(() => {});
  if (inst) await db.institution.delete({ where: { id: inst.id } }).catch(() => {});
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}
