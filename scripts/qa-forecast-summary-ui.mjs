/**
 * Browser check: the /forecasting page and its new ?view=summary tab render
 * with no uncaught error / 500 for a SUPER_ADMIN, and the Summary tab shows
 * the roll-up (either the two tables, or the honest empty state).
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-forecast-summary-ui.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const IGNORE = [/Download the React DevTools/i, /\[Fast Refresh\]/i, /favicon/i, /hydration/i, /Failed to fetch/i];
const ignored = (s) => IGNORE.some((re) => re.test(s));

const admin = await createAndLogin({ role: "SUPER_ADMIN" });
let browser;
let fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();

  for (const [path, label] of [["/forecasting", "Forecasts tab"], ["/forecasting?view=summary", "Summary tab"]]) {
    const errs = [];
    const onErr = (e) => errs.push(`pageerror: ${e.message}`);
    const onConsole = (m) => { if (m.type() === "error" && !ignored(m.text())) errs.push(`console.error: ${m.text().slice(0, 160)}`); };
    const onResp = (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${r.url().replace(BROWSER_BASE, "")}`); };
    page.on("pageerror", onErr); page.on("console", onConsole); page.on("response", onResp);

    const resp = await page.goto(`${BROWSER_BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    if (resp && resp.status() >= 400) errs.push(`page HTTP ${resp.status()}`);
    await page.waitForTimeout(2000);

    page.off("pageerror", onErr); page.off("console", onConsole); page.off("response", onResp);
    ok(`${label}: no error / 500`, errs.length === 0, [...new Set(errs)].join(" | "));

    // Both tabs must exist.
    const hasTabs = await page.getByRole("link", { name: /^Summary$/ }).count();
    ok(`${label}: Summary tab link present`, hasTabs >= 1);
  }

  // On the summary tab, assert either the roll-up tables or the empty state.
  await page.goto(`${BROWSER_BASE}/forecasting?view=summary`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  const byIntake = await page.getByRole("heading", { name: /By intake/i }).count();
  const emptyState = (await page.getByText(/No forecasts to summarise yet/i).count()) > 0;
  ok("Summary shows roll-up tables OR honest empty state", byIntake >= 1 || emptyState,
    `byIntake=${byIntake} empty=${emptyState}`);

  // Grand-total cards should never render NaN / undefined.
  const bodyText = await page.locator("body").innerText();
  ok("no NaN / undefined / Invalid Date on Summary", !/\bNaN\b|\bundefined\b|Invalid Date/.test(bodyText));
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}
