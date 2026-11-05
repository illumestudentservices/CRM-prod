/**
 * QA — on a failed login the password is cleared but the email is kept.
 * 3× for stability (a fresh email each round to avoid per-account lockout).
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/qa-login-clear-password.mjs
 */
import { chromium } from "playwright";
import { BASE } from "./qa-base.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function run() {
  const browser = await chromium.launch();
  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      const page = await (await browser.newContext()).newPage();
      const email = `nobody-${Date.now()}-${round}@illume.local`;
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.locator('input[name="email"]').waitFor({ timeout: 15000 });
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill("definitely-wrong-password");
      await page.locator('button[type="submit"]').click();

      // Wait for the rejection message.
      await page.getByText(/Invalid email or password/i).waitFor({ timeout: 20000 });
      await page.waitForTimeout(300);

      const pw = await page.locator('input[name="password"]').inputValue();
      const em = await page.locator('input[name="email"]').inputValue();
      expect("password field is cleared", pw === "", `(got "${pw}")`);
      expect("email field is kept", em === email, `(got "${em}")`);
      await page.context().close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error("qa crashed", e); process.exit(1); });
