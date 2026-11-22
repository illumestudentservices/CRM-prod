/**
 * Lead form: the new "Source type" filter narrows the Source picker.
 *   • pick School  -> picker lists the school, NOT the agent
 *   • pick Agent   -> picker lists the agent, NOT the school
 * Seeds one AGENT + one SCHOOL partner; cleans up.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-lead-source-type.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const admin = await createAndLogin({ role: "SUPER_ADMIN" });
const tag = Date.now().toString().slice(-6);
let browser, agent, school, fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

try {
  agent = await db.recruitmentPartner.create({ data: { name: `ZZAgent ${tag}`, type: "AGENT", country: "India", createdById: admin.user.id, isActive: true } });
  school = await db.recruitmentPartner.create({ data: { name: `ZZSchool ${tag}`, type: "SCHOOL", country: "UAE", createdById: admin.user.id, isActive: true } });
  const AG = `ZZAgent ${tag}`, SC = `ZZSchool ${tag}`;

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();

  await page.goto(`${BROWSER_BASE}/students`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /Add Lead/i }).first().click();
  await page.waitForTimeout(800);
  const dialog = page.getByRole("dialog");
  ok("Source type field present on the form", (await dialog.getByText("Source type", { exact: true }).count()) >= 1);

  // Stable element handles: the type trigger (shows "All types") and the source
  // combobox (shows its value "No source"). Handles survive the text changing.
  const typeTrigger = await dialog.getByRole("combobox").filter({ hasText: "All types" }).first().elementHandle();
  const srcTrigger = await dialog.getByRole("combobox").filter({ hasText: "No source" }).first().elementHandle();

  async function pickTypeAndOptions(typeLabel) {
    await typeTrigger.click();
    await page.waitForTimeout(300);
    await page.getByRole("option", { name: typeLabel, exact: true }).click();
    await page.waitForTimeout(500);
    await srcTrigger.click();
    await page.waitForTimeout(500);
    const opts = await page.locator("[data-index]").allInnerTexts();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    return opts.join(" | ");
  }

  const schoolOpts = await pickTypeAndOptions("School");
  ok("School type -> picker lists the school", schoolOpts.includes(SC), schoolOpts.slice(0, 160));
  ok("School type -> picker hides the agent", !schoolOpts.includes(AG), schoolOpts.slice(0, 160));

  const agentOpts = await pickTypeAndOptions("Agent");
  ok("Agent type -> picker lists the agent", agentOpts.includes(AG), agentOpts.slice(0, 160));
  ok("Agent type -> picker hides the school", !agentOpts.includes(SC), agentOpts.slice(0, 160));
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const p of [agent, school]) if (p) await db.recruitmentPartner.delete({ where: { id: p.id } }).catch(() => {});
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}
