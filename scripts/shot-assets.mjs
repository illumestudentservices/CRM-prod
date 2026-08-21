/**
 * Screenshots the reworked HR → Assets tab, light and dark.
 *
 *   node --import tsx --env-file=.env.local scripts/shot-assets.mjs
 *
 * The register grew ten columns and a new edit dialog, and none of that is
 * something a typecheck can judge. The disposable account is an HR Manager
 * because the Assets tab is HR-only — every other role is refused by
 * `erp_hr:read` — with MFA enrolled properly rather than bypassed, and it is
 * destroyed in the finally block.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { db, createAndLogin, destroyUser, BASE, TAG } from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");
const OUT = "tmp/asset-shots";
mkdirSync(OUT, { recursive: true });

async function signIn(page, acct, secret) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
}

const acct = await createAndLogin({ role: "HR_MANAGER", withEmployee: true });
const secret = (await db.user.findUnique({
  where: { id: acct.user.id }, select: { twoFactorSecret: true },
})).twoFactorSecret;

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await signIn(page, acct, secret);

  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    await page.goto(`${BASE}/hr?tab=assets`, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate((d) => {
      localStorage.setItem("theme", d ? "dark" : "light");
      document.documentElement.classList.toggle("dark", d);
    }, dark);
    // Radix does not mount inactive tab content, so the panel has to be the
    // active one before anything in it exists to photograph.
    await page.getByRole("tab", { name: /^assets$/i }).click().catch(() => {});
    await page.waitForTimeout(2500);
    // The Assets panel sits below four charts and the stat cards, so a
    // viewport-sized shot of the top of the page photographs the charts and
    // none of the register.
    await page.locator('[role="tab"][data-state="active"]').scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/assets-${mode}.png`, fullPage: false });
    console.log(`wrote ${OUT}/assets-${mode}.png`);
  }

  // The edit dialog is the part that did not exist before; open it once.
  const edit = page.locator('button[title="Edit"]').first();
  if (await edit.count()) {
    await edit.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/edit-dark.png` });
    console.log(`wrote ${OUT}/edit-dark.png`);
  } else {
    console.log("no Edit button found — check the HR gate");
  }

  const rows = await page.locator("text=/not linked to a staff record/").count();
  console.log(`rows showing an unlinked custodian: ${rows}`);

  const real = errors.filter((e) => !/favicon|React DevTools|hydrat/i.test(e));
  console.log(real.length ? `CONSOLE ERRORS:\n  ${real.slice(0, 6).join("\n  ")}` : "no console errors");
} finally {
  await browser.close();
  await destroyUser(acct);
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  console.log(`disposable users left behind: ${left}`);
  await db.$disconnect();
}
process.exit(0);
