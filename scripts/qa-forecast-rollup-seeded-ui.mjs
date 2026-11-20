/**
 * Seeded browser check for the forecasting Summary tab: plant a region, an ICR,
 * an institution and three forecasts (incl. a monthly RE-forecast that must be
 * deduped) on the TEST DB, then confirm the rendered roll-up shows the right
 * totals. Everything seeded is deleted in finally.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-forecast-rollup-seeded-ui.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";
import bcrypt from "bcryptjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const tag = `fcq${Date.now().toString().slice(-6)}`;
const admin = await createAndLogin({ role: "SUPER_ADMIN" });

let browser, region, icr, inst;
const fIds = [];
let fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

async function seedForecast({ periodY, periodM, intakeY, intakeM, status, enrol, confidence = null, actual = null, maturity = null }) {
  const f = await db.forecast.create({
    data: {
      periodYear: periodY, periodMonth: periodM,
      institutionId: inst.id, icrId: icr.id,
      intakeYear: intakeY, intakeMonth: intakeM,
      status, createdById: admin.user.id,
      confidenceScore: confidence, actualEnrolments: actual, pipelineMaturity: maturity,
      segments: { create: { segment: "DIRECT_UG", icrApplications: enrol * 4, icrDeposits: enrol * 2, icrEnrolments: enrol } },
    },
  });
  fIds.push(f.id);
  return f;
}

try {
  region = await db.region.create({ data: { name: `ZZ ${tag} Region`, code: tag.toUpperCase() } });
  icr = await db.user.create({
    data: {
      email: `icr-${tag}@qa.local`, firstName: "ICR", lastName: tag, name: `ICR ${tag}`,
      password: await bcrypt.hash("x", 4), role: "ICR", isActive: true, regionId: region.id,
    },
  });
  inst = await db.institution.create({
    data: { name: `ZZ ${tag} College`, country: "Canada", type: "College", createdById: admin.user.id, regionId: region.id },
  });

  // Sep 2027 intake: current forecast (Nov) = 12, confidence 4/5, ACTUAL 10 recorded;
  //                  older re-forecast (Oct) = 99 → must be dropped.
  await seedForecast({ periodY: 2026, periodM: 11, intakeY: 2027, intakeM: 9, status: "ACCEPTED", enrol: 12, confidence: 4, actual: 10, maturity: "HIGH_MATURITY" });
  await seedForecast({ periodY: 2026, periodM: 10, intakeY: 2027, intakeM: 9, status: "ACCEPTED", enrol: 99 });
  // Jan 2028 intake: 7, no actual yet.
  await seedForecast({ periodY: 2026, periodM: 11, intakeY: 2028, intakeM: 1, status: "SUBMITTED_TO_RM", enrol: 7 });
  // Expected: region total 19, grand 19, 2 forecasts; Forecast-vs-Actual Sep 2027 = 12 vs 10 (-2, -17%).

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();

  const errs = [];
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()}`); });

  await page.goto(`${BROWSER_BASE}/forecasting?view=summary`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  ok("Summary renders with no error / 500", errs.length === 0, [...new Set(errs)].join(" | "));

  ok("By intake table present", (await page.getByRole("heading", { name: /By intake/i }).count()) >= 1);
  ok("By region table present", (await page.getByRole("heading", { name: /By region/i }).count()) >= 1);
  ok("By institution table present", (await page.getByRole("heading", { name: /By institution/i }).count()) >= 1);
  ok("By segment table present", (await page.getByRole("heading", { name: /By segment/i }).count()) >= 1);
  ok("By pipeline maturity table present", (await page.getByRole("heading", { name: /By pipeline maturity/i }).count()) >= 1);
  ok("maturity level 'High maturity' shown", (await page.getByText(/High maturity/i).count()) >= 1);
  ok("Forecast vs Actual section present", (await page.getByRole("heading", { name: /Forecast vs Actual/i }).count()) >= 1);
  ok("Export button present on Summary", (await page.getByRole("button", { name: /Export/i }).count()) >= 1);

  const body = await page.locator("body").innerText();
  ok("seeded region name shows", body.includes(`ZZ ${tag} Region`));
  ok("seeded institution name shows", body.includes(`ZZ ${tag} College`));
  // Headline "Expected enrolments" grand total = 19 (99 deduped away).
  ok("grand expected enrolments = 19 (re-forecast deduped, not 111)", /\b19\b/.test(body) && !/\b111\b/.test(body), `body had 111=${/\b111\b/.test(body)}`);
  ok("no NaN / undefined on Summary", !/\bNaN\b|\bundefined\b|Invalid Date/.test(body));

  // Region row totals 19 (first match = the breakdown table; the name also now
  // appears in the Forecast-vs-Actual table, so scope to the first).
  const regionRow = await page.getByRole("row", { name: new RegExp(`ZZ ${tag} Region`) }).first().innerText().catch(() => "");
  ok("region row totals 19", /\b19\b/.test(regionRow), `row="${regionRow.replace(/\s+/g, " ")}"`);
  // Institution row totals 19 too (single institution).
  const instRow = await page.getByRole("row", { name: new RegExp(`ZZ ${tag} College`) }).first().innerText().catch(() => "");
  ok("institution row totals 19", /\b19\b/.test(instRow), `row="${instRow.replace(/\s+/g, " ")}"`);
  // By segment: all seeded forecasts use Direct — Undergraduate, so it carries 19.
  const segRow = await page.getByRole("row", { name: /Direct — Undergraduate/ }).innerText().catch(() => "");
  ok("Direct-UG segment row totals 19", /\b19\b/.test(segRow), `row="${segRow.replace(/\s+/g, " ")}"`);
  // Forecast vs Actual now shown by intake, region AND institution → the -17%
  // variance appears in several tables (rows + totals), not just once.
  const variances = (body.match(/-17%/g) || []).length;
  ok("Forecast-vs-Actual shown across groupings (≥3 × -17%)", variances >= 3, `found ${variances}`);
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const id of fIds) await db.forecast.delete({ where: { id } }).catch(() => {}); // cascades segments
  if (inst) await db.institution.delete({ where: { id: inst.id } }).catch(() => {});
  if (icr) await db.user.delete({ where: { id: icr.id } }).catch(() => {});
  if (region) await db.region.delete({ where: { id: region.id } }).catch(() => {});
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}
