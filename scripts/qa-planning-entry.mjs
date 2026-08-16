/**
 * Recruitment planning data entry — verified by logging in for real, 3 times.
 *
 *   node --import tsx --env-file=.env scripts/qa-planning-entry.mjs
 *
 * PlannedTravel and PlannedFieldActivity were both displayed on a plan and both
 * wired into activation — approving a plan turns planned travel into real
 * TravelRequests and planned activities into stub Field Operations — but
 * neither could be CREATED. The quarterly planning module was built to replace
 * five spreadsheets and could replace none of them, because its core data had
 * no way in.
 *
 * Each pass signs in through the real form and adds both by hand.
 */

import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

const PASSES = 3;
const allCreated = [];
const made = { plans: [], institutions: [] };

async function signIn(page, email, password, secret) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  const submit = page.locator('button[type="submit"]').first();
  await submit.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 15000 }
  );
  await submit.click();
  await page.waitForURL(/verify-2fa/, { timeout: 20000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 20000 });
}

async function runPass(pass, browser) {
  startSection(`PASS ${pass} of ${PASSES} — real sign-in`);

  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  allCreated.push(admin);
  const row = await db.user.findUnique({
    where: { id: admin.user.id },
    select: { twoFactorSecret: true },
  });

  const inst = await db.institution.create({
    data: { name: `${TAG}-p${pass}-Client`, country: "Malaysia", type: "UNIVERSITY", createdById: admin.user.id },
  });
  made.institutions.push(inst.id);

  // DRAFT so the plan is writable — an approved plan is deliberately locked.
  const plan = await db.quarterlyRecruitmentPlan.create({
    data: {
      icrId: admin.user.id,
      institutionId: inst.id,
      quarter: 3,
      year: 2026,
      status: "DRAFT",
      reportingCurrency: "USD",
    },
  });
  made.plans.push(plan.id);

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e.message)));

  await signIn(page, admin.email, admin.password, row.twoFactorSecret);
  expect(!/login|verify-2fa/.test(new URL(page.url()).pathname),
    "signed in through the real form", page.url());

  await page.goto(`${BASE}/recruitment-planning/${plan.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Planned Field Activities", { timeout: 15000 });
  ok("plan detail page loaded");

  // ── Planned activity, by hand ───────────────────────────────────────────
  const paOpen = page.locator("#pa-open");
  expect(await paOpen.count() === 1, "*** an Add planned activity control exists (there was none) ***");
  await paOpen.click();
  await page.locator("#pa-count").waitFor({ timeout: 10000 });

  const paSave = page.locator("#pa-save");
  expect(await paSave.isDisabled(), "save is blocked until a count is entered");
  await page.locator("#pa-type").selectOption("SCHOOL_VISIT");
  await page.locator("#pa-count").fill("12");
  await page.locator("#pa-notes").fill(`${TAG} termly school visit programme`);
  await page.waitForTimeout(200);
  expect(!(await paSave.isDisabled()), "save enables once a count is given");
  await paSave.click();
  await page.waitForTimeout(2500);

  const activities = await db.plannedFieldActivity.findMany({ where: { planId: plan.id } });
  expect(activities.length === 1,
    "*** a planned field activity was created through the UI ***", `${activities.length}`);
  expect(activities[0]?.activityType === "SCHOOL_VISIT" && activities[0]?.plannedCount === 12,
    "stored with the chosen type and count",
    `${activities[0]?.activityType} / ${activities[0]?.plannedCount}`);

  // One row per type — a second would make the planned total ambiguous.
  const dupe = await fetch(`${BASE}/api/recruitment-planning/plans/${plan.id}/planned-activities`, {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: admin.jar.header() },
    body: JSON.stringify({ activityType: "SCHOOL_VISIT", plannedCount: 3 }),
  });
  expect(dupe.status === 409, "a duplicate activity type is refused", `got ${dupe.status}`);

  // ── Planned travel, by hand ─────────────────────────────────────────────
  await page.goto(`${BASE}/recruitment-planning/${plan.id}`, { waitUntil: "networkidle" });
  // The plan detail tabs are plain <button> elements driving useState, not
  // Radix tabs — getByRole("tab") matches nothing. The inactive tab's content
  // is genuinely not mounted, so it must be clicked.
  await page.getByRole("button", { name: "Travel", exact: true }).click();
  await page.waitForTimeout(700);
  const ptOpen = page.locator("#pt-open");
  await ptOpen.waitFor({ timeout: 15000 });
  expect(await ptOpen.count() === 1, "*** an Add planned travel control exists (there was none) ***");
  await ptOpen.click();
  await page.locator("#pt-destination").waitFor({ timeout: 10000 });

  const ptSave = page.locator("#pt-save");
  expect(await ptSave.isDisabled(), "save is blocked until the required fields are filled");

  await page.locator("#pt-destination").fill("Ho Chi Minh City");
  await page.locator("#pt-country").fill("Vietnam");
  await page.locator("#pt-cost").fill("2400");
  await page.locator("#pt-start").fill("2026-09-10");
  await page.locator("#pt-end").fill("2026-09-15");
  await page.locator("#pt-purpose").fill(`${TAG} agent visits and a school fair`);
  await page.waitForTimeout(200);
  expect(!(await ptSave.isDisabled()), "save enables once required fields are filled");
  await ptSave.click();
  await page.waitForTimeout(2500);

  const travel = await db.plannedTravel.findMany({ where: { planId: plan.id } });
  expect(travel.length === 1, "*** planned travel was created through the UI ***", `${travel.length}`);
  expect(travel[0]?.destination === "Ho Chi Minh City" && travel[0]?.country === "Vietnam",
    "stored with the entered destination", `${travel[0]?.destination}, ${travel[0]?.country}`);
  expect(travel[0]?.estimatedCurrency === "USD",
    "currency defaulted from the plan, not a hardcoded value", String(travel[0]?.estimatedCurrency));

  // Return before departure must be refused.
  const backwards = await fetch(`${BASE}/api/recruitment-planning/plans/${plan.id}/planned-travel`, {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: admin.jar.header() },
    body: JSON.stringify({
      destination: "X", country: "Y",
      plannedStart: "2026-09-20T00:00:00.000Z",
      plannedEnd: "2026-09-10T00:00:00.000Z",
      purpose: "backwards",
    }),
  });
  expect(backwards.status === 422, "a return date before departure is refused", `got ${backwards.status}`);

  // ── An approved plan is locked ──────────────────────────────────────────
  await db.quarterlyRecruitmentPlan.update({ where: { id: plan.id }, data: { status: "APPROVED" } });
  const locked = await fetch(`${BASE}/api/recruitment-planning/plans/${plan.id}/planned-activities`, {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: admin.jar.header() },
    body: JSON.stringify({ activityType: "WEBINAR", plannedCount: 2 }),
  });
  expect(locked.status === 409,
    "*** an approved plan refuses new entries — changes go through a Variation Request ***",
    `got ${locked.status}`);

  await page.goto(`${BASE}/recruitment-planning/${plan.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  expect(await page.locator("#pa-open").count() === 0,
    "the add control is hidden once the plan is approved");

  const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  expect(real.length === 0, "no console errors", real.slice(0, 2).join(" | "));

  await ctx.close();

  // ── Destroy this pass's account and prove it went ───────────────────────
  await db.plannedTravel.deleteMany({ where: { planId: plan.id } }).catch(() => {});
  await db.plannedFieldActivity.deleteMany({ where: { planId: plan.id } }).catch(() => {});
  await db.quarterlyRecruitmentPlan.deleteMany({ where: { icrId: admin.user.id } }).catch(() => {});
  await db.institution.deleteMany({ where: { id: inst.id } }).catch(() => {});
  await destroyUser(admin);

  const left = await db.user.count({ where: { id: admin.user.id } });
  expect(left === 0, `pass ${pass}: the disposable account was deleted`, `${left} remaining`);
  if (left === 0) {
    const i = allCreated.indexOf(admin);
    if (i >= 0) allCreated.splice(i, 1);
  }
}

async function main() {
  startSection("Baseline");
  const beforeUsers = await db.user.count();
  ok(`users=${beforeUsers}`);

  const browser = await chromium.launch();
  try {
    for (let p = 1; p <= PASSES; p++) await runPass(p, browser);
  } finally {
    await browser.close();
  }

  startSection("Footprint after three real sign-ins");
  const afterUsers = await db.user.count();
  expect(afterUsers === beforeUsers,
    "*** user count back to baseline — no account survived ***",
    `${beforeUsers} -> ${afterUsers}`);
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.code ?? "", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", `${e.code ?? ""} ${e.message}`);
} finally {
  await db.plannedTravel.deleteMany({ where: { planId: { in: made.plans } } }).catch(() => {});
  await db.plannedFieldActivity.deleteMany({ where: { planId: { in: made.plans } } }).catch(() => {});
  await db.quarterlyRecruitmentPlan.deleteMany({ where: { id: { in: made.plans } } }).catch(() => {});
  await db.institution.deleteMany({ where: { id: { in: made.institutions } } }).catch(() => {});
  for (const c of allCreated) await destroyUser(c);
  const leakedUsers = await db.user.count({ where: { email: { contains: TAG.toLowerCase() } } }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leakedUsers}\n`);
  await db.$disconnect();
}
summary();
