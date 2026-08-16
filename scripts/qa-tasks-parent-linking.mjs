/**
 * Tasks — parent linking, verified by logging in for real, three times.
 *
 *   node --import tsx --env-file=.env scripts/qa-tasks-parent-linking.mjs
 *
 * The task form could not create ANY task. Spec §1 requires every task except a
 * personal or internal one to be attached to a parent record, and the API
 * enforces it — but the form had no category and no parent field, so it sent
 * neither. `category` defaults to OTHER, which requires a parent, so every
 * submission was rejected 422 "parentType and parentId are both required",
 * surfaced through alert() naming fields that were not on screen.
 *
 * Each pass signs in through the real form and creates a task by hand, once
 * without a parent (personal) and once with one (student follow-up).
 */

import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");
const { requiresParent } = await import("../lib/task-workflow.ts");

const PASSES = 3;
const allCreated = [];
const made = { leads: [] };

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

/** Opens the create dialog and fills the common fields. */
async function openCreate(page, title) {
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  const newBtn = page.getByRole("button", { name: /new task|create task|add task/i }).first();
  await newBtn.waitFor({ timeout: 15000 });
  await newBtn.click();
  await page.waitForSelector("text=Create Task", { timeout: 15000 });
  const dialog = page.getByRole("dialog");
  await dialog.locator("#task-title").fill(title);
  return dialog;
}

async function runPass(pass, browser) {
  startSection(`PASS ${pass} of ${PASSES} — real sign-in`);

  // The rule the form must mirror, asserted rather than assumed.
  expect(requiresParent("OTHER") === true,
    "OTHER requires a parent — which is why the old form could not create anything");
  expect(requiresParent("PERSONAL") === false, "PERSONAL does not require a parent");

  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  allCreated.push(admin);
  const row = await db.user.findUnique({
    where: { id: admin.user.id },
    select: { twoFactorSecret: true },
  });

  const lead = await db.lead.create({
    data: {
      firstName: TAG, lastName: `Task-p${pass}`,
      email: `${TAG.toLowerCase()}-task-p${pass}-${Date.now()}@illume.local`,
      phone: "+10000000000", nationality: "Indian", countryOfResidence: "India",
      interestedProgram: "QA", studyLevel: "UNDERGRADUATE",
      intakeYear: 2027, intakeMonth: 9, createdById: admin.user.id,
    },
  });
  made.leads.push(lead.id);

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e.message)));
  // The form reports failures through alert(); accept them so a rejection does
  // not hang the run, and record what was said.
  const alerts = [];
  page.on("dialog", async (d) => { alerts.push(d.message()); await d.accept(); });

  await signIn(page, admin.email, admin.password, row.twoFactorSecret);
  expect(!/login|verify-2fa/.test(new URL(page.url()).pathname),
    "signed in through the real form", page.url());

  // ── A personal task needs no parent ─────────────────────────────────────
  const personalTitle = `${TAG} p${pass} personal task`;
  let dialog = await openCreate(page, personalTitle);
  ok("create dialog opened with the new fields present");
  expect(await dialog.locator("#task-category").count() === 1, "the category field exists");
  expect(await dialog.locator("#task-parent-type").count() === 1, "the parent-type field exists");
  expect(await dialog.locator("#task-parent-id").count() === 1, "the parent record field exists");

  await dialog.getByRole("button", { name: /^create/i }).last().click();
  await page.waitForTimeout(2500);

  const personal = await db.task.findFirst({ where: { title: personalTitle } });
  expect(!!personal,
    "*** a personal task can be created — the form could create NOTHING before ***",
    alerts.slice(-1)[0] ?? "no alert");
  expect(personal?.category === "PERSONAL", "stored with the chosen category", String(personal?.category));

  // ── A student follow-up must carry its parent ───────────────────────────
  const linkedTitle = `${TAG} p${pass} student follow-up`;
  dialog = await openCreate(page, linkedTitle);

  await dialog.locator("#task-category").click();
  let box = page.getByRole("listbox");
  await box.waitFor({ timeout: 10000 });
  await box.getByRole("option").filter({ hasText: "Student follow-up" }).first().click();
  await page.waitForTimeout(300);
  expect(await dialog.locator("text=This category needs a record").count() === 1,
    "the form says a record is required for this category");

  await dialog.locator("#task-parent-type").click();
  box = page.getByRole("listbox");
  await box.waitFor({ timeout: 10000 });
  await box.getByRole("option").filter({ hasText: "Student" }).first().click();
  await page.waitForTimeout(600);

  await dialog.locator("#task-parent-id").click();
  box = page.getByRole("listbox");
  await box.waitFor({ timeout: 10000 });
  await box.getByRole("option").filter({ hasNotText: /^None$/ }).first().waitFor({ timeout: 15000 });
  const optionCount = await box.getByRole("option").count();
  expect(optionCount > 1, "the record picker is populated", `${optionCount} options`);
  await box.getByRole("option").filter({ hasText: `${TAG} Task-p${pass}` }).first().click();
  await page.waitForTimeout(300);
  expect(await dialog.locator("text=Linked.").count() === 1, "the form confirms it is linked");

  await dialog.getByRole("button", { name: /^create/i }).last().click();
  await page.waitForTimeout(2500);

  const linked = await db.task.findFirst({ where: { title: linkedTitle } });
  expect(!!linked, "*** a linked task was created ***", alerts.slice(-1)[0] ?? "no alert");
  expect(linked?.category === "STUDENT_FOLLOW_UP", "stored with the chosen category", String(linked?.category));
  expect(linked?.parentType === "STUDENT",
    "*** parentType persisted — a field with no UI until now ***", String(linked?.parentType));
  expect(linked?.parentId === lead.id,
    "*** parentId points at the student that was chosen ***", `${linked?.parentId} vs ${lead.id}`);

  const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  expect(real.length === 0, "no console errors", real.slice(0, 2).join(" | "));

  await ctx.close();

  // ── Destroy this pass's account and prove it went ───────────────────────
  if (admin.employee) {
    await db.task.deleteMany({ where: { createdById: admin.employee.id } }).catch(() => {});
    await db.task.deleteMany({ where: { assigneeId: admin.employee.id } }).catch(() => {});
  }
  await db.task.deleteMany({ where: { title: { startsWith: `${TAG} p${pass}` } } }).catch(() => {});
  await db.lead.deleteMany({ where: { id: lead.id } }).catch(() => {});
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
  await db.task.deleteMany({ where: { title: { startsWith: TAG } } }).catch(() => {});
  await db.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
  for (const c of allCreated) await destroyUser(c);
  const leakedUsers = await db.user.count({ where: { email: { contains: TAG.toLowerCase() } } }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leakedUsers}\n`);
  await db.$disconnect();
}
summary();
