/**
 * QA — Risk & Compliance stat tiles are clickable.
 *
 * Seeds risks + compliance items, then drives /risk-compliance and asserts each
 * of the 4 stat cards switches to the right tab and filters the list:
 *   Open Risks → risks tab, status OPEN
 *   Critical Risks → risks tab, score ≥ 20
 *   Pending Compliance → compliance tab, status PENDING
 *   Overdue Compliance → compliance tab, status OVERDUE
 * 3× for stability.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-riskcomp-tiles.mjs
 */
import { chromium } from "playwright";
import { db, BASE, createAndLogin, destroyUser } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function run() {
  const ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  const uid = ctx.user.id;
  const tag = ctx.user.name.split(" ")[0];

  const T = {
    riskOpen: `${tag} risk-open`,
    riskCrit: `${tag} risk-crit`,
    riskMit: `${tag} risk-mit`,
    compPending: `${tag} comp-pending`,
    compOverdue: `${tag} comp-overdue`,
    compDone: `${tag} comp-done`,
  };
  const riskIds = [], compIds = [];
  async function risk(title, status, score) {
    const r = await db.riskRegister.create({
      data: { title, type: "MARKET", likelihood: 3, impact: 3, riskScore: score, status, ownerId: uid },
    });
    riskIds.push(r.id);
  }
  async function comp(title, status) {
    const c = await db.complianceItem.create({
      data: { title, complianceType: "OTHER", status, assignedToId: uid },
    });
    compIds.push(c.id);
  }
  await risk(T.riskOpen, "OPEN", 10);
  await risk(T.riskCrit, "OPEN", 25);
  await risk(T.riskMit, "MITIGATED", 5);
  await comp(T.compPending, "PENDING");
  await comp(T.compOverdue, "OVERDUE");
  await comp(T.compDone, "COMPLETED");

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies([...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, url: BASE })));
    const page = await context.newPage();

    async function seen(title) {
      return (await page.getByText(title, { exact: true }).count()) > 0;
    }

    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      await page.goto(`${BASE}/risk-compliance`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /Open Risks/ }).first().waitFor({ timeout: 20000 });

      // Open Risks → risks tab, OPEN only (open + crit are OPEN; mit is not)
      await page.getByRole("button", { name: /Open Risks/ }).first().click();
      await page.waitForTimeout(400);
      expect("Open Risks → shows OPEN risks", (await seen(T.riskOpen)) && (await seen(T.riskCrit)));
      expect("Open Risks → hides MITIGATED risk", !(await seen(T.riskMit)));
      expect("Open Risks → compliance not shown (risks tab)", !(await seen(T.compPending)));

      // Critical Risks → risks tab, score ≥ 20 (only crit)
      await page.getByRole("button", { name: /Critical Risks/ }).first().click();
      await page.waitForTimeout(400);
      expect("Critical Risks → only critical risk", (await seen(T.riskCrit)) && !(await seen(T.riskOpen)) && !(await seen(T.riskMit)));

      // Pending Compliance → compliance tab, PENDING only
      await page.getByRole("button", { name: /Pending Compliance/ }).first().click();
      await page.waitForTimeout(400);
      expect("Pending Compliance → only pending item", (await seen(T.compPending)) && !(await seen(T.compOverdue)) && !(await seen(T.compDone)));
      expect("Pending Compliance → risks not shown (compliance tab)", !(await seen(T.riskOpen)));

      // Overdue Compliance → compliance tab, OVERDUE only
      await page.getByRole("button", { name: /Overdue Compliance/ }).first().click();
      await page.waitForTimeout(400);
      expect("Overdue Compliance → only overdue item", (await seen(T.compOverdue)) && !(await seen(T.compPending)) && !(await seen(T.compDone)));
    }
  } finally {
    await browser.close();
    for (const id of compIds) await db.complianceItem.delete({ where: { id } }).catch(() => {});
    for (const id of riskIds) await db.riskRegister.delete({ where: { id } }).catch(() => {});
    await destroyUser(ctx).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
