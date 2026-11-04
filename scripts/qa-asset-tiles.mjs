/**
 * QA — HR → Assets stat tiles are clickable.
 *
 * Seeds ITAssets, opens /hr?tab=assets and asserts each stat card filters the
 * device list: Total (clear) / In Use / Spare / Needs Attention. 3×.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-asset-tiles.mjs
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
  const tag = ctx.user.name.split(" ")[0];
  const T = {
    inuse: `${tag}-asset-inuse`,
    spare: `${tag}-asset-spare`,
    repair: `${tag}-asset-repair`,
    damaged: `${tag}-asset-damaged`,
  };
  const ids = [];
  async function asset(name, status, condition) {
    const a = await db.iTAsset.create({ data: { name, type: "LAPTOP", status, condition } });
    ids.push(a.id);
  }
  await asset(T.inuse, "IN_USE", "GOOD");
  await asset(T.spare, "SPARE", null);
  await asset(T.repair, "REPAIR", null);           // attention via status
  await asset(T.damaged, "IN_USE", "DAMAGED");      // attention via condition (also In Use)

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies([...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, url: BASE })));
    const page = await context.newPage();
    const seen = async (t) => (await page.getByText(t, { exact: true }).count()) > 0;

    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      await page.goto(`${BASE}/hr?tab=assets`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /Total Devices/ }).first().waitFor({ timeout: 20000 });
      // Wait for the device list to have rendered our rows.
      await page.getByText(T.inuse, { exact: true }).first().waitFor({ timeout: 20000 });

      // In Use → IN_USE only (inuse + damaged)
      await page.getByRole("button", { name: /In Use/ }).first().click();
      await page.waitForTimeout(400);
      expect("In Use → IN_USE devices", (await seen(T.inuse)) && (await seen(T.damaged)) && !(await seen(T.spare)) && !(await seen(T.repair)));

      // Spare → SPARE only
      await page.getByRole("button", { name: /Spare/ }).first().click();
      await page.waitForTimeout(400);
      expect("Spare → SPARE only", (await seen(T.spare)) && !(await seen(T.inuse)) && !(await seen(T.repair)) && !(await seen(T.damaged)));

      // Needs Attention → repair (status) + damaged (condition)
      await page.getByRole("button", { name: /Needs Attention/ }).first().click();
      await page.waitForTimeout(400);
      expect("Needs Attention → repair + damaged", (await seen(T.repair)) && (await seen(T.damaged)) && !(await seen(T.inuse)) && !(await seen(T.spare)));

      // Total Devices → clears filters, all 4 shown
      await page.getByRole("button", { name: /Total Devices/ }).first().click();
      await page.waitForTimeout(400);
      expect("Total Devices → all shown", (await seen(T.inuse)) && (await seen(T.spare)) && (await seen(T.repair)) && (await seen(T.damaged)));
    }
  } finally {
    await browser.close();
    for (const id of ids) await db.iTAsset.delete({ where: { id } }).catch(() => {});
    await destroyUser(ctx).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
