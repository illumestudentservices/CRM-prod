/**
 * Verifies on PRODUCTION that the employee edit dialog reads gender back.
 *
 *   node --import tsx scripts/prod-verify-gender.mjs <email> <pw> <secret> <employeeId> <expected>
 *
 * Run LOCALLY against the live URL — Playwright is not on the VPS.
 *
 * The fixture stores gender FEMALE directly in the database before this runs,
 * so opening the dialog is the only thing under test: does the screen show what
 * is already stored?
 *
 * Then it saves WITHOUT touching the gender control, and re-reads. That second
 * half is the actual bug: the value survived being stored, and was destroyed by
 * the next unrelated save because the form had never been told about it.
 */
import { chromium } from "playwright";
const { totpGenerate } = await import("../lib/totp.ts");

const [email, password, secret, employeeId, expected] = process.argv.slice(2);
const BASE = "https://illumestudentservices.cloud";

let pass = 0, fail = 0;
const check = (cond, label, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  → " + detail : ""}`); }
};

const browser = await chromium.launch();
const errs = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(e.message));

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
  check(true, "HR manager signed in to production (MFA challenged, not bypassed)");

  // ── The dialog shows the stored gender ──────────────────────────────────
  await page.goto(`${BASE}/hr/employees/${employeeId}`, { waitUntil: "networkidle", timeout: 45000 });
  const editBtn = page.getByRole("button", { name: /edit/i }).first();
  check(await editBtn.count() > 0, "the Edit control is present");
  await editBtn.click();
  await page.waitForTimeout(1800);

  const dialog = await page.locator('[role="dialog"]').innerText().catch(() => "");
  check(/Gender/i.test(dialog), "the dialog has a Gender field",
    dialog.slice(0, 100).replace(/\n/g, " "));

  const shown = new RegExp(expected, "i").test(dialog);
  check(shown, `*** the dialog shows the stored gender (${expected}) ***`,
    shown ? "" : `dialog text did not contain "${expected}" — the screen is not reading it back`);

  // ── Saving something else must not wipe it ──────────────────────────────
  const phone = page.locator('[role="dialog"] input').filter({ hasNot: page.locator('[type="date"]') });
  const anyText = phone.first();
  if (await anyText.count()) {
    await anyText.fill("+15550199").catch(() => {});
  }
  const save = page.getByRole("button", { name: /^save|update/i }).first();
  if (await save.count()) {
    await save.click();
    await page.waitForTimeout(3000);
    check(true, "saved the employee without touching the Gender control");
  } else {
    check(false, "could not find the Save control");
  }

  // Re-open and confirm it is still there.
  await page.goto(`${BASE}/hr/employees/${employeeId}`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByRole("button", { name: /edit/i }).first().click();
  await page.waitForTimeout(1800);
  const after = await page.locator('[role="dialog"]').innerText().catch(() => "");
  const survived = new RegExp(expected, "i").test(after);
  check(survived, `*** the gender survived an unrelated save (still ${expected}) ***`,
    survived ? "" : "the save wiped it — this is the bug the fix targets");

  check(errs.length === 0, "no uncaught client errors", errs.slice(0, 2).join(" | "));
} catch (e) {
  check(false, "verification run completed", String(e.message).split("\n")[0].slice(0, 200));
} finally {
  await browser.close();
}

console.log(`\nPROD VERIFY (gender): ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
