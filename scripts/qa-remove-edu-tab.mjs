/**
 * QA — "Education Partners" tab removed from Recruitment Network → Partners.
 *
 * Logs in as SUPER_ADMIN, opens /recruitment-network/partners and asserts:
 *   - the tab bar NO LONGER shows "Education Partners"
 *   - the kept tabs (All Partners / Agents / Schools / Referral Partners) are present
 *   - the Add-Partner "Type" dropdown no longer offers "Education Partner"
 *     but still offers Agent / School / Referral Partner / Partner
 * Repeated 3× for stability.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-remove-edu-tab.mjs
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
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies(
      [...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, url: BASE }))
    );
    const page = await context.newPage();

    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      await page.goto(`${BASE}/recruitment-network/partners`, { waitUntil: "domcontentloaded" });
      // Wait for the tab bar to render (the "Agents" tab is a stable anchor).
      await page.getByRole("link", { name: /^Agents\s/ }).first().waitFor({ timeout: 15000 });

      // Tab links are identified by their `type=` query param in the href, so a
      // partner ROW that happens to be named "...Education Partners..." can't be
      // mistaken for the tab.
      const eduTab = await page.locator('a[href*="type=education"]').count();
      expect("NO 'Education Partners' tab", eduTab === 0, `(found ${eduTab})`);
      expect("'Agents' tab present", (await page.locator('a[href*="type=agents"]').count()) >= 1);
      expect("'Schools' tab present", (await page.locator('a[href*="type=schools"]').count()) >= 1);
      expect("'Referral Partners' tab present", (await page.locator('a[href*="type=referral"]').count()) >= 1);
      expect("'All Partners' tab present", (await page.getByRole("link", { name: /^All Partners\s/ }).count()) >= 1);

      // Open the Add Partner dialog and inspect the Type dropdown options.
      await page.getByRole("button", { name: /Add Partner/i }).click();
      await page.getByRole("dialog").waitFor({ timeout: 10000 });
      // The Type trigger is the first combobox in the dialog.
      await page.getByRole("dialog").getByRole("combobox").first().click();
      await page.getByRole("option").first().waitFor({ timeout: 10000 });
      const optionText = (await page.getByRole("option").allInnerTexts()).join(" | ");
      expect("Type dropdown has NO 'Education Partner'", !/Education Partner/i.test(optionText), `(got: ${optionText})`);
      expect("Type dropdown still has 'Agent'", /\bAgent\b/i.test(optionText));
      expect("Type dropdown still has 'School'", /\bSchool\b/i.test(optionText));
      expect("Type dropdown still has 'Referral Partner'", /Referral Partner/i.test(optionText));
      // Close the dropdown + dialog for the next round.
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    }
  } finally {
    await browser.close();
    await destroyUser(ctx).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
