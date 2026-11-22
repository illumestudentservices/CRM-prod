/**
 * Smoke test the restyled Recruitment Network cluster: the layout's PageHeader
 * renders, and the partners + performance pages load with the shared Table (no
 * error / 500 / NaN).
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-recruitment-network-ui.mjs
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

  const p = await visit(page, "/recruitment-network/partners");
  ok("partners: loads, no error/500", p.status < 400 && p.errs.length === 0, p.errs.join(" | "));
  ok("partners: layout PageHeader 'Recruitment Network'", p.body.includes("Recruitment Network"));
  ok("partners: tab + table render", /Recruitment Partners/.test(p.body) && /Partner/.test(p.body));
  ok("partners: no NaN/undefined", !/\bNaN\b|\bundefined\b/.test(p.body));

  const perf = await visit(page, "/recruitment-network/performance");
  ok("performance: loads, no error/500", perf.status < 400 && perf.errs.length === 0, perf.errs.join(" | "));
  ok("performance: rankings tables render", /Agent Rankings/i.test(perf.body) && /School Rankings/i.test(perf.body));
  ok("performance: no NaN/undefined", !/\bNaN\b|\bundefined\b/.test(perf.body));
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}
