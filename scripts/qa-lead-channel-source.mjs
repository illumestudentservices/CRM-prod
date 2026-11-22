/**
 * The lead form shows an inline agent/school picker right under Lead Channel
 * when the channel is Agent Referral / School Referral, and hides it otherwise.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-lead-channel-source.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
let browser, fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };
const bodyHas = (page, t) => page.evaluate((s) => document.body.innerText.includes(s), t);

try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();

  await page.goto(`${BROWSER_BASE}/students`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("button", { name: "Add Lead" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Add New Lead"), { timeout: 15000 });

  const channel = await page.getByRole("combobox").filter({ hasText: "Select channel" }).elementHandle();
  const pick = async (optionName) => {
    await channel.click();
    await page.getByRole("option", { name: optionName, exact: true }).click();
    await page.waitForTimeout(400);
  };

  // Agent Referral → "Which agent?" picker (combobox rendered, not the empty-state)
  await pick("Agent Referral");
  ok("Agent Referral shows 'Which agent?'", await bodyHas(page, "Which agent?"));
  ok("…with an agent picker (not the empty-state)",
    (await bodyHas(page, "Not listed / no specific one")) && !(await bodyHas(page, "No agents have been set up")));
  ok("…and not the school label", !(await bodyHas(page, "Which school?")));
  ok("…and NO duplicate 'Source type' in Assignment section",
    !(await bodyHas(page, "Source type")) && (await bodyHas(page, "Set above under Lead Channel")));

  // School Referral → "Which school?" picker
  await pick("School Referral");
  ok("School Referral shows 'Which school?'", await bodyHas(page, "Which school?"));
  ok("…with a school picker",
    (await bodyHas(page, "Not listed / no specific one")) && !(await bodyHas(page, "No schools have been set up")));
  ok("…and not the agent label", !(await bodyHas(page, "Which agent?")));

  // Direct Lead → selectable, no inline picker, Assignment Source control shows
  await pick("Direct Lead");
  ok("Direct Lead is selectable with no inline agent/school picker",
    !(await bodyHas(page, "Which agent?")) && !(await bodyHas(page, "Which school?")));
  ok("…and keeps the Assignment-section Source control", await bodyHas(page, "Source type"));

  // Website → no inline picker, and the Assignment Source control is back
  await pick("Website");
  ok("Website shows no inline agent/school picker",
    !(await bodyHas(page, "Which agent?")) && !(await bodyHas(page, "Which school?")));
  ok("…and the Assignment-section Source type/Source control returns",
    (await bodyHas(page, "Source type")) && !(await bodyHas(page, "Set above under Lead Channel")));
} catch (e) {
  fail++; console.error("CRASH", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}
