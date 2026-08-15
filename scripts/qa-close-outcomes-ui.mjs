/**
 * Spec §15 close outcomes — browser check.
 *
 * The close buttons are rendered by mapping CLOSED_STAGES, and the forms live
 * inside a Radix Dialog that is not in the DOM until opened. Neither can be
 * verified from server HTML, and "the button exists" is not the same as "the
 * form behind it works" — the previous nested-ternary validity check would have
 * left Confirm permanently disabled with nothing on screen saying why, which is
 * exactly the failure this asserts against.
 *
 *   node --import tsx --env-file=.env scripts/qa-close-outcomes-ui.mjs
 */

import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { db, createAndLogin, destroyUser, BASE, startSection, expect, ok, summary, TAG } from "./qa-lib.mjs";

const SHOT = path.join(os.tmpdir(), "close-outcomes.png");
const created = [];
const leads = [];

try {
  startSection("Close outcomes (browser)");

  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  created.push(admin);

  const lead = await db.lead.create({
    data: {
      firstName: TAG, lastName: "CloseUI",
      email: `${TAG.toLowerCase()}-closeui-${Date.now()}@illume.local`,
      phone: "+10000000000", nationality: "Indian", countryOfResidence: "India",
      interestedProgram: "QA", studyLevel: "UNDERGRADUATE",
      intakeYear: 2027, intakeMonth: 9, stage: "QUALIFIED", createdById: admin.user.id,
    },
  });
  leads.push(lead.id);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  await ctx.addCookies(
    [...admin.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e.message)));

  await page.goto(`${BASE}/students/${lead.id}`, { waitUntil: "networkidle" });
  expect(!page.url().includes("/login"), "Reached the student page", page.url());

  await page.waitForSelector("text=Close as:", { timeout: 15000 });

  // All five closed outcomes must now be offered, not the old three.
  for (const label of ["Lost", "Deferred", "Application Rejected", "Withdrawn", "Visa Refused"]) {
    const n = await page.getByRole("button", { name: label, exact: true }).count();
    expect(n === 1, `"${label}" close button is offered`, `found ${n}`);
  }

  await page.locator("text=Close as:").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOT, fullPage: false });
  ok(`screenshot: ${SHOT}`);

  // ── Withdrawn form ───────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Withdrawn", exact: true }).click();
  await page.waitForSelector("text=Why did they withdraw?", { timeout: 10000 });
  ok("Withdrawn dialog opens with its own form");
  expect(await page.locator("text=/Use this rather than Lost/").count() === 1,
    "Withdrawn form explains when NOT to use Lost");

  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Confirm" });
  expect(await confirm.isDisabled(), "Confirm is disabled before a reason is typed");
  await dialog.getByRole("textbox").first().fill("Decided to stay and work locally");
  await page.waitForTimeout(200);
  expect(!(await confirm.isDisabled()),
    "Confirm ENABLES once the withdrawal reason is filled (the fall-through bug would leave it stuck)");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // ── Visa refused form ────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Visa Refused", exact: true }).click();
  await page.waitForSelector("text=Refusal reason", { timeout: 10000 });
  ok("Visa Refused dialog opens with its own form");

  const d2 = page.getByRole("dialog");
  expect(await d2.locator("text=Reapplying?").count() === 1, "Reapplying selector is present");
  const confirm2 = d2.getByRole("button", { name: "Confirm" });
  expect(await confirm2.isDisabled(), "Confirm disabled before the refusal reason is typed");
  await d2.getByRole("textbox").first().fill("Insufficient evidence of funds");
  await page.waitForTimeout(200);
  expect(!(await confirm2.isDisabled()), "Confirm enables once the refusal reason is filled");

  // Actually submit, and confirm it lands.
  await confirm2.click();
  await page.waitForTimeout(2500);
  const row = await db.lead.findUnique({ where: { id: lead.id } });
  expect(row.stage === "VISA_REFUSED", "submitting the form closed the lead as VISA_REFUSED", row.stage);
  expect(row.visaReapplying === null,
    "left at 'Not known yet' → column stays NULL", String(row.visaReapplying));

  const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  expect(real.length === 0, "No console errors", real.slice(0, 3).join(" | "));

  await browser.close();
} finally {
  await db.auditLog.deleteMany({ where: { entityId: { in: leads } } }).catch(() => {});
  await db.leadActivity.deleteMany({ where: { leadId: { in: leads } } }).catch(() => {});
  for (const id of leads) await db.lead.delete({ where: { id } }).catch(() => {});
  for (const c of created) await destroyUser(c);
  await db.$disconnect();
}
summary();
