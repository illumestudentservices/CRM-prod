/**
 * Recruitment events form parity — verified by logging in for real, three times.
 *
 *   node --import tsx --env-file=.env scripts/qa-events-manual-login.mjs
 *
 * This does NOT reuse an API cookie jar. Each pass drives the actual sign-in
 * screen — email, password, then a live TOTP code — exactly as a person would,
 * then creates an event through the form using a type and a status that were
 * previously impossible to choose.
 *
 * Why three passes with a fresh account each time: a single pass proves the
 * happy path once. Repeating catches order-dependence, state left behind by the
 * previous run, and races that pass by luck. In the previous module it exposed
 * that the disposable account was never actually being deleted.
 *
 * Every account is destroyed at the end of its own pass and the residue is
 * asserted to be zero.
 */

import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

// The app's own generator, not otplib directly — it carries the
// epochTolerance the server verifies against.
const { totpGenerate } = await import("../lib/totp.ts");
const { EVENT_TYPES, EVENT_STATUSES, EVENT_TYPE_OPTIONS, EVENT_STATUS_OPTIONS } =
  await import("../lib/event-options.ts");

const PASSES = 3;
const allCreated = [];
const madeEvents = [];

/** Signs in through the real form: credentials, then TOTP. */
async function signIn(page, email, password, secret) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  // The submit button is deliberately held until hydration — a pre-hydration
  // submit once fell back to a native GET and put the password in the query
  // string. Wait for it rather than racing it.
  const submit = page.locator('button[type="submit"]').first();
  await submit.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 15000 }
  );
  await submit.click();

  // MFA is mandatory for every role, so a successful sign-in always lands here.
  await page.waitForURL(/verify-2fa/, { timeout: 20000 });
  const code = await totpGenerate(secret);
  await page.locator('input[inputmode="numeric"]').fill(code);
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

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e.message)));

  // ── Sign in as a person would ───────────────────────────────────────────
  await signIn(page, admin.email, admin.password, row.twoFactorSecret);
  expect(!/login|verify-2fa/.test(new URL(page.url()).pathname),
    `signed in through the real form (${new URL(page.url()).pathname})`, page.url());

  // ── Open the events form ────────────────────────────────────────────────
  await page.goto(`${BASE}/events`, { waitUntil: "networkidle" });
  const newBtn = page.getByRole("button", { name: /new event|add event|create event/i }).first();
  await newBtn.waitFor({ timeout: 15000 });
  await newBtn.click();
  await page.waitForSelector("text=Type", { timeout: 15000 });
  ok("event form opened");

  const dialog = page.getByRole("dialog");

  // ── Every type the spec expects must be selectable ──────────────────────
  await dialog.getByRole("combobox").first().click();
  const listbox = page.getByRole("listbox");
  await listbox.waitFor({ timeout: 10000 });
  await listbox.getByRole("option").first().waitFor({ timeout: 10000 });
  const typeOptions = await listbox.getByRole("option").allInnerTexts();

  expect(typeOptions.length === EVENT_TYPE_OPTIONS.length,
    `*** all ${EVENT_TYPE_OPTIONS.length} event types are offered (was 6) ***`,
    `${typeOptions.length}: ${typeOptions.slice(0, 4).join(", ")}…`);
  for (const want of ["School Fair", "Open Day", "Student Seminar", "Application Day", "Conversion Event", "Agent Workshop"]) {
    expect(typeOptions.some((t) => t.includes(want)), `"${want}" can now be chosen`);
  }
  expect(!typeOptions.some((t) => /Agent Training/.test(t)),
    "the retired Agent Training value is no longer offered", typeOptions.join(","));

  // Choose one that was previously impossible.
  await listbox.getByRole("option").filter({ hasText: "Conversion Event" }).first().click();
  await page.waitForTimeout(300);

  // ── Status must include Closed ──────────────────────────────────────────
  await dialog.getByRole("combobox").nth(1).click();
  const statusBox = page.getByRole("listbox");
  await statusBox.waitFor({ timeout: 10000 });
  await statusBox.getByRole("option").first().waitFor({ timeout: 10000 });
  const statusOptions = await statusBox.getByRole("option").allInnerTexts();
  expect(statusOptions.length === EVENT_STATUSES.length,
    `*** all ${EVENT_STATUSES.length} statuses are offered (was 4) ***`,
    `${statusOptions.length}: ${statusOptions.join(", ")}`);
  for (const want of ["In Progress", "Closed"]) {
    expect(statusOptions.some((t) => t.includes(want)),
      `*** "${want}" is selectable — an event could not be ${want.toLowerCase()} before ***`);
  }
  await statusBox.getByRole("option").filter({ hasText: "Closed" }).first().click();
  await page.waitForTimeout(300);

  // ── Fill the rest and actually save it ──────────────────────────────────
  const eventName = `${TAG} p${pass} conversion event`;
  await dialog.locator("#name").fill(eventName);
  // datetime-local, not date — a date-only value is silently rejected by the
  // input and the form then fails its required check with no visible cause.
  await dialog.locator("#date").fill(new Date().toISOString().slice(0, 16));
  await dialog.locator("#city").fill("Kuala Lumpur");
  await dialog.locator("#country").fill("Malaysia");

  // Capture what the server actually said. A silent "nothing happened" is the
  // failure mode this whole workstream exists to eliminate, so the test must
  // not reproduce it.
  const postPromise = page
    .waitForResponse((r) => r.url().includes("/api/events") && r.request().method() === "POST", { timeout: 20000 })
    .catch(() => null);
  await dialog.getByRole("button", { name: /create|save/i }).last().click();
  const post = await postPromise;
  if (post) {
    const bodyText = await post.text().catch(() => "");
    ok(`POST /api/events -> ${post.status()} ${bodyText.slice(0, 200)}`);
  } else {
    // No request at all means client-side validation blocked it.
    const visibleErrors = await dialog.locator("p.text-red-500, .text-red-500").allInnerTexts().catch(() => []);
    ok(`no POST fired; form errors on screen: ${JSON.stringify(visibleErrors)}`);
  }
  await page.waitForTimeout(2500);

  // ── Prove it stored with the previously-impossible values ───────────────
  const stored = await db.event.findFirst({
    where: { name: eventName },
    select: { id: true, type: true, status: true },
  });
  expect(!!stored, "the event was created through the form", String(stored?.id));
  if (stored) {
    madeEvents.push(stored.id);
    expect(stored.type === "CONVERSION_EVENT",
      "*** stored as CONVERSION_EVENT — a type the form could not offer before ***", stored.type);
    expect(stored.status === "CLOSED",
      "*** stored as CLOSED — a status the form could not offer before ***", stored.status);
  }

  const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  expect(real.length === 0, "no console errors during the pass", real.slice(0, 2).join(" | "));

  await ctx.close();

  // ── Delete the account and prove it is gone ─────────────────────────────
  // Events reference their creator, so they must go first — the previous module
  // showed destroyUser silently failing on exactly this kind of FK.
  await db.event.deleteMany({ where: { name: { startsWith: `${TAG} p${pass}` } } }).catch(() => {});
  await db.event.deleteMany({ where: { createdById: admin.user.id } }).catch(() => {});
  await destroyUser(admin);

  const left = await db.user.count({ where: { id: admin.user.id } });
  expect(left === 0, `pass ${pass}: the disposable account was deleted`, `${left} remaining`);
  const sessions = await db.session.count({ where: { userId: admin.user.id } });
  expect(sessions === 0, `pass ${pass}: its sessions were deleted`, `${sessions}`);
  if (left === 0) {
    const i = allCreated.indexOf(admin);
    if (i >= 0) allCreated.splice(i, 1);
  }
}

async function main() {
  startSection("Baseline");
  const beforeUsers = await db.user.count();
  ok(`users=${beforeUsers}; form now offers ${EVENT_TYPES.length} types and ${EVENT_STATUSES.length} statuses`);

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
  await db.event.deleteMany({ where: { name: { startsWith: TAG } } }).catch(() => {});
  for (const c of allCreated) await destroyUser(c);
  const leakedUsers = await db.user.count({ where: { email: { contains: TAG.toLowerCase() } } }).catch(() => -1);
  const leakedEvents = await db.event.count({ where: { name: { startsWith: TAG } } }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leakedUsers}, leaked events: ${leakedEvents}\n`);
  await db.$disconnect();
}
summary();
