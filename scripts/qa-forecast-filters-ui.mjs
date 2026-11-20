/**
 * Browser test for the forecasting Summary FILTERS (intake year / region /
 * status). Seeds 3 forecasts across 2 regions, 2 intake years and mixed
 * statuses, then drives the ?fy / ?region / ?status params and checks the
 * "Showing N of 3 forecasts" counter + the grand Expected-enrolments headline.
 * Super Admin login so the in-scope total is exactly the 3 seeded rows.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-forecast-filters-ui.mjs
 */
import { chromium } from "playwright";
import bcrypt from "bcryptjs";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const tag = Date.now().toString().slice(-6);
const admin = await createAndLogin({ role: "SUPER_ADMIN" });

let browser, regionA, regionB, icrA, icrB, inst;
const fIds = [];
let fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

async function seed({ icr, intakeY, intakeM, status, enrol }) {
  const f = await db.forecast.create({
    data: {
      periodYear: 2026, periodMonth: 11, institutionId: inst.id, icrId: icr,
      intakeYear: intakeY, intakeMonth: intakeM, status, createdById: admin.user.id,
      segments: { create: { segment: "DIRECT_UG", icrApplications: enrol * 4, icrDeposits: enrol * 2, icrEnrolments: enrol } },
    },
  });
  fIds.push(f.id);
}

async function showingCounter(page) {
  const t = await page.getByText(/Showing \d+ of \d+ forecasts/).first().innerText().catch(() => "");
  return t.replace(/\s+/g, " ").trim();
}
async function headlineEnrolments(page) {
  // The "Expected enrolments" card (rounded-xl box holding the label + number).
  const card = page.locator("div.rounded-xl", { hasText: "Expected enrolments" }).first();
  return (await card.innerText().catch(() => "")).replace(/\s+/g, " ");
}

try {
  regionA = await db.region.create({ data: { name: `ZZ ${tag} Region A`, code: `${tag}A` } });
  regionB = await db.region.create({ data: { name: `ZZ ${tag} Region B`, code: `${tag}B` } });
  const mkIcr = async (t, regionId) => (await db.user.create({ data: { email: `icr-${t}@qa.local`, firstName: "ICR", lastName: t, name: `ICR ${t}`, password: await bcrypt.hash("x", 4), role: "ICR", isActive: true, regionId } })).id;
  icrA = await mkIcr(`${tag}a`, regionA.id);
  icrB = await mkIcr(`${tag}b`, regionB.id);
  inst = await db.institution.create({ data: { name: `ZZ ${tag} College`, country: "Canada", type: "College", createdById: admin.user.id, regionId: regionA.id } });

  await seed({ icr: icrA, intakeY: 2027, intakeM: 9, status: "ACCEPTED", enrol: 10 });      // RA / 2027 / accepted
  await seed({ icr: icrB, intakeY: 2027, intakeM: 9, status: "ACCEPTED", enrol: 5 });       // RB / 2027 / accepted
  await seed({ icr: icrA, intakeY: 2028, intakeM: 1, status: "SUBMITTED_TO_RM", enrol: 7 }); // RA / 2028 / open

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();
  page.setDefaultTimeout(9000); // fail fast on a genuinely missing element

  const go = async (qs) => { await page.goto(`${BROWSER_BASE}/forecasting?view=summary${qs}`, { waitUntil: "domcontentloaded", timeout: 90000 }); await page.waitForTimeout(900); };
  const RA = encodeURIComponent(`ZZ ${tag} Region A`);
  const RB = encodeURIComponent(`ZZ ${tag} Region B`);

  await go("");
  ok("filter bar present (Apply)", (await page.getByRole("button", { name: /^Apply$/ }).count()) >= 1);
  ok("no filter → Showing 3 of 3", (await showingCounter(page)) === "Showing 3 of 3 forecasts", await showingCounter(page));
  ok("no filter → grand enrolments 22", /\b22\b/.test(await headlineEnrolments(page)), await headlineEnrolments(page));

  await go("&fy=2027");
  ok("year 2027 → Showing 2 of 3", (await showingCounter(page)) === "Showing 2 of 3 forecasts", await showingCounter(page));
  ok("year 2027 → enrolments 15", /\b15\b/.test(await headlineEnrolments(page)), await headlineEnrolments(page));

  await go("&fy=2028");
  ok("year 2028 → Showing 1 of 3", (await showingCounter(page)) === "Showing 1 of 3 forecasts", await showingCounter(page));
  ok("year 2028 → enrolments 7", /\b7\b/.test(await headlineEnrolments(page)), await headlineEnrolments(page));

  await go(`&region=${RA}`);
  ok("region A → Showing 2 of 3", (await showingCounter(page)) === "Showing 2 of 3 forecasts", await showingCounter(page));
  await go(`&region=${RB}`);
  ok("region B → Showing 1 of 3", (await showingCounter(page)) === "Showing 1 of 3 forecasts", await showingCounter(page));

  await go("&status=ACCEPTED");
  ok("status accepted → Showing 2 of 3", (await showingCounter(page)) === "Showing 2 of 3 forecasts", await showingCounter(page));
  await go("&status=OPEN");
  ok("status open → Showing 1 of 3", (await showingCounter(page)) === "Showing 1 of 3 forecasts", await showingCounter(page));

  // Combined: 2027 AND region A → only the accepted RA/2027 forecast.
  await go(`&fy=2027&region=${RA}`);
  ok("2027 + region A → Showing 1 of 3", (await showingCounter(page)) === "Showing 1 of 3 forecasts", await showingCounter(page));
  ok("combined filter shows a Clear link", (await page.getByRole("link", { name: /^Clear$/ }).count()) >= 1);
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const id of fIds) await db.forecast.delete({ where: { id } }).catch(() => {});
  if (inst) await db.institution.delete({ where: { id: inst.id } }).catch(() => {});
  for (const u of [icrA, icrB]) if (u) await db.user.delete({ where: { id: u } }).catch(() => {});
  for (const r of [regionA, regionB]) if (r) await db.region.delete({ where: { id: r.id } }).catch(() => {});
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}
