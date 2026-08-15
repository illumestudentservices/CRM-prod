/**
 * Workload reassignment — browser check.
 *
 * The block and the reassign dialog only render for an APPROVED, not-yet-revoked
 * departure whose owner still holds live work, so this seeds exactly that state
 * and drives it. Radix Tabs does not mount inactive tab content and Radix
 * Dialog content is not in the DOM until opened, so neither can be verified by
 * grepping server HTML — both give false negatives.
 *
 *   node --import tsx --env-file=.env scripts/qa-reassignment-ui.mjs
 */

import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { db, createAndLogin, destroyUser, BASE, startSection, expect, ok, summary, TAG } from "./qa-lib.mjs";

const SHOT_BLOCKED = path.join(os.tmpdir(), "reassign-blocked.png");
const SHOT_DIALOG = path.join(os.tmpdir(), "reassign-dialog.png");
const SHOT_SETTINGS = path.join(os.tmpdir(), "reassign-settings-card.png");

const created = [];
const fx = { users: [], employees: [], leads: [], regions: [], requests: [] };

async function makePerson(label, regionId) {
  const u = await db.user.create({
    data: {
      email: `${TAG.toLowerCase()}-${label}-${Date.now()}@illume.local`,
      firstName: TAG, lastName: label, name: `${TAG} ${label}`,
      role: "ICR", isActive: true, regionId,
    },
  });
  const e = await db.employee.create({
    data: {
      userId: u.id, employeeId: `${TAG}-${label}-${Date.now().toString().slice(-5)}`,
      jobTitle: `QA ${label}`, employmentType: "FULL_TIME", startDate: new Date(),
    },
  });
  fx.users.push(u.id); fx.employees.push(e.id);
  return { user: u, employee: e };
}

try {
  startSection("Reassignment UI (browser)");

  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  created.push(admin);

  const region = await db.region.create({ data: { name: `${TAG}-UIR`, code: `${TAG}U` } });
  fx.regions.push(region.id);

  const leaver = await makePerson("uileaver", region.id);
  await makePerson("uisucc", region.id); // a valid recipient for the picker

  // Two live students and one enrolled, so the copy has to distinguish them.
  for (const stage of ["NEW_LEAD", "QUALIFIED", "ENROLLED"]) {
    const l = await db.lead.create({
      data: {
        firstName: TAG, lastName: `${stage}-ui`, email: `${TAG.toLowerCase()}-${stage}-ui-${Date.now()}@illume.local`,
        phone: "+10000000000", nationality: "Indian", countryOfResidence: "India",
        interestedProgram: "QA", studyLevel: "UNDERGRADUATE", intakeYear: 2027, intakeMonth: 9,
        stage, assignedICRId: leaver.user.id, createdById: admin.user.id, regionId: region.id,
      },
    });
    fx.leads.push(l.id);
  }

  const req = await db.offboardingRequest.create({
    data: {
      employeeId: leaver.employee.id, reason: "RESIGNATION",
      lastWorkingDay: new Date(), notes: `${TAG} UI fixture for the reassignment block`,
      requestedById: admin.user.id, status: "APPROVED",
      reviewedById: admin.user.id, reviewedAt: new Date(),
    },
  });
  fx.requests.push(req.id);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.addCookies(
    [...admin.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );

  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e.message)));

  await page.goto(`${BASE}/hr?tab=offboarding`, { waitUntil: "networkidle" });
  expect(!page.url().includes("/login"), "Reached /hr without being bounced to login", page.url());
  await page.waitForSelector("text=Raise a departure", { timeout: 15000 });

  // ── The blocked state ────────────────────────────────────────────────────
  await page.waitForSelector("text=Still owns", { timeout: 15000 });
  ok("Blocked banner rendered on the approved departure");

  const banner = await page.locator("text=/Still owns .*students/").first().innerText();
  expect(/2 students/.test(banner), "Banner counts the 2 live students, not all 3", banner);
  expect(!/3 students/.test(banner), "Enrolled student is excluded from the count", banner);

  const revoke = page.getByRole("button", { name: "Mark access revoked" });
  expect(await revoke.count() === 1, "'Mark access revoked' button is present");
  expect(await revoke.isDisabled(), "'Mark access revoked' is DISABLED while work is owned");

  const reassignBtn = page.getByRole("button", { name: "Reassign workload" });
  expect(await reassignBtn.count() === 1, "'Reassign workload' button is offered");
  expect(await page.getByRole("button", { name: "Override" }).count() === 1,
    "'Override' escape hatch is offered to the reviewer");

  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOT_BLOCKED, fullPage: false });
  ok(`screenshot: ${SHOT_BLOCKED}`);

  // ── The reassign dialog ──────────────────────────────────────────────────
  await reassignBtn.click();
  await page.waitForSelector("text=Hand over to", { timeout: 10000 });
  ok("Reassign dialog opens");

  expect(await page.locator("text=/Enrolled students, closed journeys/").count() >= 1,
    "Dialog explains what stays behind");

  // The itemised breakdown, not just a total.
  const dialog = page.getByRole("dialog");
  const dialogText = await dialog.innerText();
  expect(/students/.test(dialogText), "Dialog itemises the students bucket");

  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading colleagues…"),
    { timeout: 10000 }
  );
  expect(await page.locator("text=Nobody available").count() === 0,
    "Recipient picker is not empty once loaded");
  await dialog.getByRole("combobox").first().click();
  const opts = await page.getByRole("option").count();
  expect(opts > 0, "Recipient dropdown lists colleagues", `${opts} options`);
  // The leaver must not be offered as their own successor.
  const optionText = await page.getByRole("option").allInnerTexts();
  expect(!optionText.some((t) => t.includes("uileaver")),
    "The departing person is excluded from their own recipient list", optionText.join(" | "));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOT_DIALOG, fullPage: false });
  ok(`screenshot: ${SHOT_DIALOG}`);
  await page.keyboard.press("Escape");

  // ── The Settings entry point ─────────────────────────────────────────────
  // Settings has no ?tab= deep link (unlike the HR tabs), so the Security tab
  // has to be clicked. Radix does not mount inactive tab content, so the card
  // genuinely is not in the DOM until then.
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Security" }).click();
  await page.waitForSelector("text=Workload Reassignment", { timeout: 15000 });
  ok("Settings → Security carries the Workload Reassignment card");
  await page.waitForFunction(
    () => /cannot have access revoked|No departures are waiting/.test(document.body.innerText),
    { timeout: 10000 }
  );
  const cardText = await page.locator("text=/cannot have access revoked/").first().innerText();
  expect(/1 approved departure/.test(cardText), "Card counts the blocked departure", cardText);
  await page.locator("text=Workload Reassignment").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOT_SETTINGS, fullPage: false });
  ok(`screenshot: ${SHOT_SETTINGS}`);

  const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  expect(real.length === 0, "No console errors", real.slice(0, 3).join(" | "));

  await browser.close();
} finally {
  for (const id of fx.requests) await db.offboardingRequest.delete({ where: { id } }).catch(() => {});
  await db.auditLog.deleteMany({ where: { entity: "OffboardingRequest" } }).catch(() => {});
  for (const id of fx.leads) await db.lead.delete({ where: { id } }).catch(() => {});
  for (const c of created) await destroyUser(c);
  for (const id of fx.employees) await db.employee.delete({ where: { id } }).catch(() => {});
  for (const id of fx.users) {
    await db.notification.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.auditLog.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of fx.regions) await db.region.delete({ where: { id } }).catch(() => {});
  await db.$disconnect();
}
summary();
