/**
 * Smoke test the restyled Field Operations page per role: it renders cleanly
 * (no error / 500, no NaN/undefined) and the role-scoped dashboard shows.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-fieldops-ui.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
let browser, fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

async function visit(user) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addCookies([...user.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("response", (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()}`); });
  const resp = await page.goto(`${BROWSER_BASE}/field-operations`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1800);
  const body = await page.locator("body").innerText();
  return { page, ctx, errs, status: resp?.status() ?? 0, body };
}

const admin = await createAndLogin({ role: "SUPER_ADMIN" });
let icr;
try {
  browser = await chromium.launch();

  // Senior (Super Admin) dashboard.
  const a = await visit(admin);
  ok("Super Admin: page loads, no error/500", a.status < 400 && a.errs.length === 0, [...new Set(a.errs)].join(" | "));
  ok("Super Admin: Field Operations header present", a.body.includes("Field Operations"));
  ok("Super Admin: senior cards render", /Last 30 days/i.test(a.body) && /By market/i.test(a.body) && /By type/i.test(a.body));
  ok("Super Admin: no NaN/undefined", !/\bNaN\b|\bundefined\b/.test(a.body));
  await a.ctx.close();

  // ICR dashboard (the 5 tiles).
  icr = await createAndLogin({ role: "ICR" });
  const b = await visit(icr);
  ok("ICR: page loads, no error/500", b.status < 400 && b.errs.length === 0, [...new Set(b.errs)].join(" | "));
  ok("ICR: tiles render (Planned this week / Completion rate)", /Planned this week/i.test(b.body) && /Completion rate/i.test(b.body));
  ok("ICR: no NaN/undefined", !/\bNaN\b|\bundefined\b/.test(b.body));
  await b.ctx.close();
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (icr) await destroyUser(icr).catch(() => {});
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}
