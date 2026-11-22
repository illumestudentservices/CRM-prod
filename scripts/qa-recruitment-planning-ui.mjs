/**
 * Smoke test the restyled Recruitment Planning cluster: the layout PageHeader +
 * the plans / campaigns / events pages load with the shared Table (no error).
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-recruitment-planning-ui.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const admin = await createAndLogin({ role: "SUPER_ADMIN" });
let browser, fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

async function visit(page, path) {
  const errs = [];
  const onErr = (e) => errs.push(e.message);
  const onResp = (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()}`); };
  page.on("pageerror", onErr); page.on("response", onResp);
  const resp = await page.goto(`${BROWSER_BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  const body = await page.locator("body").innerText();
  page.off("pageerror", onErr); page.off("response", onResp);
  return { status: resp?.status() ?? 0, errs: [...new Set(errs)], body };
}

try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();

  for (const [path, marker] of [
    ["/recruitment-planning", "Plans"],
    ["/recruitment-planning/campaigns", "Campaign"],
    ["/recruitment-planning/events", "Event"],
  ]) {
    const r = await visit(page, path);
    ok(`${path}: loads, no error/500`, r.status < 400 && r.errs.length === 0, r.errs.join(" | "));
    ok(`${path}: PageHeader 'Recruitment Planning'`, r.body.includes("Recruitment Planning"));
    ok(`${path}: content renders (${marker})`, r.body.includes(marker) && !/\bNaN\b|\bundefined\b/.test(r.body));
  }
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}
