/**
 * Owner pickers must not be built from `role = "ICR"`.
 *
 *   npx tsx --env-file=.env scripts/qa-assignable-users.mjs
 *
 * PRODUCTION HAS ZERO ICR-ROLE USERS. It runs on HQ_EXECUTIVE, REGIONAL_MANAGER
 * and SUPER_ADMIN. Every picker built from `db.user.findMany({ role: "ICR" })`
 * therefore came back empty on live:
 *   - the bulk "Assign ICR" modal opened with no options and a permanently
 *     disabled confirm button — a dead end with only Cancel,
 *   - `lead-form.tsx:1112` hides the whole "Assigned ICR" field when the list is
 *     empty, so on the Add/Edit Lead forms the field did not exist,
 *   - the Add Event form offered only "None", and nothing else in the app writes
 *     `Event.assignedICRId`.
 *
 * THE MIRROR HAS 3 ACTIVE ICR USERS, WHICH IS WHY NONE OF THIS EVER SHOWED UP IN
 * TESTING. So the browser half of this script DELIBERATELY DEACTIVATES THEM to
 * reproduce production's shape, and restores them in `finally`.
 *
 * Footprint: one disposable SUPER_ADMIN (destroyed), and `isActive` toggled off
 * and back on for the ICR users. No rows created or deleted.
 */
import { chromium } from "playwright";
import {
  BASE, db, createAndLogin, destroyUser,
  startSection, expect, summary,
} from "./qa-lib.mjs";

const { leadOwnerOptions, eventOwnerOptions } = await import("@/lib/assignable-users");
const { RECEIVING_ROLES } = await import("@/lib/workload-reassignment");

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
let ctx, clientCtx, browser, suspended = [];

const idsOf = (rows) => rows.map((r) => r.id).sort();

try {
  // ── Predicate, straight against the DB ─────────────────────────────────────
  startSection("leadOwnerOptions: only roles that canAccessLead admits");
  const leadOwners = await leadOwnerOptions();
  const returned = await db.user.findMany({
    where: { id: { in: leadOwners.map((u) => u.id) } },
    select: { role: true },
  });
  const roles = [...new Set(returned.map((r) => r.role))].sort();
  expect(leadOwners.length > 0, `returns ${leadOwners.length} users`, roles.join(", "));
  expect(
    roles.every((r) => RECEIVING_ROLES.includes(r)),
    "every role returned is in RECEIVING_ROLES",
    roles.join(", ")
  );
  // The trap: these hold leads:read/write in the matrix but canAccessLead's
  // switch has no case for them, so an assigned lead would 403 for its owner.
  for (const trap of ["ADMISSIONS_SUPPORT", "ACCOUNT_MANAGER", "VP_GLOBAL_SALES", "INSTITUTION_CLIENT"]) {
    expect(!roles.includes(trap), `excludes ${trap} (canAccessLead denies it)`);
  }

  // ── The union that lets an edit form render its own value ──────────────────
  startSection("Current owner is always offered, even if not otherwise eligible");
  const outsider = await db.user.findFirst({
    where: { isActive: true, deletedAt: null, role: { notIn: [...RECEIVING_ROLES] } },
    select: { id: true, name: true, role: true },
  });
  expect(!!outsider, "mirror has a user outside RECEIVING_ROLES to test with", outsider?.role);
  const base = await leadOwnerOptions();
  const withOutsider = await leadOwnerOptions([outsider.id]);
  expect(
    !base.some((u) => u.id === outsider.id),
    `${outsider.role} absent by default`
  );
  expect(
    withOutsider.some((u) => u.id === outsider.id),
    `${outsider.role} present when passed as current owner`,
    "this is what stops an assigned record rendering as unassigned"
  );
  expect(withOutsider.length === base.length + 1, "union adds exactly one");
  expect(
    idsOf(await leadOwnerOptions([null, undefined, outsider.id, outsider.id])).length ===
      idsOf(withOutsider).length,
    "nulls and duplicates are ignored"
  );

  // ── Events use the wider predicate ─────────────────────────────────────────
  startSection("eventOwnerOptions: internal staff, never a client contact");
  const eventOwners = await eventOwnerOptions();
  expect(eventOwners.length >= leadOwners.length, "wider than lead ownership",
    `${eventOwners.length} vs ${leadOwners.length}`);

  // The mirror holds NO client contacts, so asserting "excludes
  // INSTITUTION_CLIENT" against it proves nothing — an empty set excludes
  // everything. Make one, then assert.
  clientCtx = await createAndLogin({ role: "INSTITUTION_CLIENT" });
  const clientId = clientCtx.user.id;
  expect(
    !(await eventOwnerOptions()).some((u) => u.id === clientId),
    "eventOwnerOptions excludes a real client contact"
  );
  expect(
    !(await leadOwnerOptions()).some((u) => u.id === clientId),
    "leadOwnerOptions excludes a real client contact"
  );
  expect(
    !(await eventOwnerOptions([clientId])).some((u) => u.id === clientId),
    "a client contact is NOT resurrected by the current-owner union",
    "an external contact must never own internal work, even historically"
  );

  // ── Reproduce production: no ICR-role users at all ─────────────────────────
  startSection("With zero ICR users (production's shape) the pickers still work");
  suspended = await db.user.findMany({
    where: { role: "ICR", isActive: true },
    select: { id: true },
  });
  await db.user.updateMany({
    where: { id: { in: suspended.map((u) => u.id) } },
    data: { isActive: false },
  });
  const stillIcr = await db.user.count({ where: { role: "ICR", isActive: true } });
  expect(stillIcr === 0, `simulated prod: 0 active ICR users (was ${suspended.length})`);

  const oldWay = await db.user.count({ where: { isActive: true, role: "ICR" } });
  const newWay = (await leadOwnerOptions()).length;
  expect(oldWay === 0, "OLD predicate now returns 0 — the live bug, reproduced");
  expect(newWay > 0, `NEW predicate returns ${newWay} assignable users`);

  // ── Browser: the two dead ends are alive ───────────────────────────────────
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );
  const page = await bctx.newPage();

  await page.goto(`${BROWSER_BASE}/students`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.waitForTimeout(1200);

  // Select one lead, then open the bulk assign modal.
  await page.locator("table tbody tr td:first-child input, table tbody tr td:first-child button")
    .first().click();
  await page.waitForTimeout(500);
  const assignBtn = page.getByRole("button", { name: /Assign ICR \(\d+\)/ });
  expect(await assignBtn.count() > 0, "bulk Assign ICR button appears on selection");
  await assignBtn.click();
  await page.waitForTimeout(800);

  await page.getByRole("dialog").locator('button[role="combobox"]').first().click();
  await page.waitForTimeout(600);
  const modalOpts = await page.getByRole("option").allTextContents();
  expect(modalOpts.length > 0, `assign modal offers ${modalOpts.length} people (was 0 = dead end)`,
    modalOpts.join(" | "));
  await page.getByRole("option").first().click();
  await page.waitForTimeout(500);
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Assign" });
  expect(await confirm.isEnabled(), "Assign button is now enabled (was permanently disabled)");
  await page.screenshot({ path: "screenshots/assignable-01-assign-modal.png" });
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(500);

  // Add Lead form must actually contain the owner field.
  await page.getByRole("button", { name: /Add Lead/ }).click();
  await page.waitForTimeout(1500);
  const ownerField = page.getByText("Assigned ICR", { exact: true });
  expect(await ownerField.count() > 0,
    '"Assigned ICR" field is rendered on Add Lead (lead-form.tsx:1112 hid it when empty)');
  await page.screenshot({ path: "screenshots/assignable-02-add-lead.png" });

  // Add Event form: the only writer of Event.assignedICRId.
  await page.goto(`${BROWSER_BASE}/events`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Add Event/ }).first().click();
  await page.waitForTimeout(1500);
  const eventCombos = page.getByRole("dialog").locator('button[role="combobox"]');
  let eventOpts = [];
  for (let i = 0; i < await eventCombos.count(); i++) {
    await eventCombos.nth(i).click();
    await page.waitForTimeout(400);
    const o = await page.getByRole("option").allTextContents();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    if (o.includes("None") && o.length > 1) { eventOpts = o; break; }
  }
  expect(eventOpts.length > 1,
    `Add Event owner picker offers ${Math.max(eventOpts.length - 1, 0)} people besides "None"`,
    eventOpts.join(" | "));
  await page.screenshot({ path: "screenshots/assignable-03-add-event.png" });
} catch (e) {
  console.error("FATAL:", e.code ?? "", e.message);
  process.exitCode = 1;
} finally {
  if (suspended.length) {
    await db.user.updateMany({
      where: { id: { in: suspended.map((u) => u.id) } },
      data: { isActive: true },
    });
    const back = await db.user.count({ where: { role: "ICR", isActive: true } });
    console.log(`restored ${suspended.length} ICR users -> active ICR count now ${back}`);
  }
  if (browser) await browser.close();
  if (ctx) await destroyUser(ctx);
  if (clientCtx) await destroyUser(clientCtx);
  summary();
  await db.$disconnect();
}
