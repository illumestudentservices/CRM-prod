/**
 * Event participation — verified by logging in for real, three times.
 *
 *   node --import tsx --env-file=.env scripts/qa-event-participation.mjs
 *
 * Two things are proved:
 *
 * 1. EventParticipation carries the assigned consultant, status, attendance,
 *    activity summary, outcome notes and cost per institution — and had NO user
 *    interface, so none of it could be recorded.
 *
 * 2. Editing an event's institution list used to delete EVERY participation row
 *    and recreate them, so an institution that STAYED in the list lost its
 *    consultant, attendance, notes and cost. That is silent data loss on an
 *    ordinary edit, and it is asserted against directly below.
 *
 * Each pass signs in through the real form — email, password, live TOTP — rather
 * than reusing an API session, drives the panel by hand, then destroys its own
 * account and asserts it is gone.
 */

import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

const PASSES = 3;
const allCreated = [];
const made = { events: [], institutions: [] };

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

  // Two institutions so the reconcile can be tested: one stays, one is removed.
  const instA = await db.institution.create({
    data: { name: `${TAG}-p${pass}-A`, country: "Malaysia", type: "UNIVERSITY", createdById: admin.user.id },
  });
  const instB = await db.institution.create({
    data: { name: `${TAG}-p${pass}-B`, country: "Vietnam", type: "UNIVERSITY", createdById: admin.user.id },
  });
  made.institutions.push(instA.id, instB.id);

  const event = await db.event.create({
    data: {
      name: `${TAG} p${pass} participation event`,
      type: "EDUCATION_FAIR", date: new Date(),
      city: "Kuala Lumpur", country: "Malaysia",
      createdById: admin.user.id,
      participations: {
        create: [
          { institutionId: instA.id, status: "CONFIRMED" },
          { institutionId: instB.id, status: "CONFIRMED" },
        ],
      },
    },
  });
  made.events.push(event.id);

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e.message)));

  await signIn(page, admin.email, admin.password, row.twoFactorSecret);
  expect(!/login|verify-2fa/.test(new URL(page.url()).pathname),
    "signed in through the real form", page.url());

  // ── The panel must render, with both institutions ───────────────────────
  await page.goto(`${BASE}/events/${event.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Participating Institutions", { timeout: 15000 });
  ok("participation panel is rendered on the event page");

  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading participation…"),
    { timeout: 10000 }
  );
  for (const name of [`${TAG}-p${pass}-A`, `${TAG}-p${pass}-B`]) {
    expect(await page.locator(`text=${name}`).count() >= 1, `${name} is listed`);
  }
  expect(await page.locator("text=with no consultant assigned").count() === 1,
    "unassigned participations are called out");

  // ── Assign a consultant and record an outcome, by hand ──────────────────
  // Scope to the participation CARD, not any div containing the text. A bare
  // `div` filter resolves to the innermost matching element, which holds the
  // name but none of the controls.
  const card = page
    .locator("div.rounded-lg.border")
    .filter({ hasText: `${TAG}-p${pass}-A` })
    .first();
  await card.waitFor({ timeout: 15000 });
  const consultant = card.getByRole("combobox").first();
  await consultant.click();
  const listbox = page.getByRole("listbox");
  await listbox.waitFor({ timeout: 10000 });
  await listbox.getByRole("option").filter({ hasNotText: /^None$/ }).first().waitFor({ timeout: 10000 });
  const chosen = (await listbox.getByRole("option").filter({ hasNotText: /^None$/ }).first().innerText()).trim();
  await listbox.getByRole("option").filter({ hasNotText: /^None$/ }).first().click();
  await page.waitForTimeout(400);
  ok(`chose consultant "${chosen}"`);

  await card.getByRole("textbox").first().fill(`${TAG} ran two counselling sessions`);
  await page.waitForTimeout(300);

  const saveBtn = page.getByRole("button", { name: "Save" }).first();
  await saveBtn.waitFor({ timeout: 10000 });
  await saveBtn.click();
  await page.waitForTimeout(2500);

  const savedA = await db.eventParticipation.findFirst({
    where: { eventId: event.id, institutionId: instA.id },
    select: { assignedICRId: true, activitySummary: true },
  });
  expect(!!savedA?.assignedICRId,
    "*** the consultant was saved — a field with no UI until now ***",
    String(savedA?.assignedICRId));
  expect((savedA?.activitySummary ?? "").includes("counselling"),
    "*** the activity summary was saved ***", String(savedA?.activitySummary));

  // ── The data-loss regression ────────────────────────────────────────────
  // Edit the event's institution list, keeping A and dropping B. A must keep
  // everything; B must go.
  const patch = await fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: admin.jar.header() },
    body: JSON.stringify({ institutionIds: [instA.id] }),
  });
  expect(patch.ok, "editing the event's institution list succeeded", `status ${patch.status}`);

  const afterA = await db.eventParticipation.findFirst({
    where: { eventId: event.id, institutionId: instA.id },
    select: { assignedICRId: true, activitySummary: true },
  });
  expect(!!afterA, "the institution that stayed still has a participation row");
  expect(afterA?.assignedICRId === savedA?.assignedICRId,
    "*** its consultant SURVIVED the edit (was wiped before) ***",
    `${savedA?.assignedICRId} -> ${afterA?.assignedICRId}`);
  expect((afterA?.activitySummary ?? "").includes("counselling"),
    "*** its outcome notes SURVIVED the edit ***", String(afterA?.activitySummary));

  const afterB = await db.eventParticipation.count({
    where: { eventId: event.id, institutionId: instB.id },
  });
  expect(afterB === 0, "the institution genuinely removed is gone", `${afterB}`);

  const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  expect(real.length === 0, "no console errors", real.slice(0, 2).join(" | "));

  await ctx.close();

  // ── Destroy this pass's account and prove it went ───────────────────────
  await db.eventParticipation.deleteMany({ where: { eventId: event.id } }).catch(() => {});
  await db.event.deleteMany({ where: { createdById: admin.user.id } }).catch(() => {});
  await db.institution.deleteMany({ where: { id: { in: [instA.id, instB.id] } } }).catch(() => {});
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
  await db.eventParticipation.deleteMany({ where: { eventId: { in: made.events } } }).catch(() => {});
  await db.event.deleteMany({ where: { name: { startsWith: TAG } } }).catch(() => {});
  await db.institution.deleteMany({ where: { id: { in: made.institutions } } }).catch(() => {});
  for (const c of allCreated) await destroyUser(c);
  const leakedUsers = await db.user.count({ where: { email: { contains: TAG.toLowerCase() } } }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leakedUsers}\n`);
  await db.$disconnect();
}
summary();
