/**
 * Client issues + account health — browser check.
 *
 *   node --import tsx --env-file=.env scripts/qa-client-issues-ui.mjs
 *
 * A component that exists but is never rendered is the exact failure this whole
 * workstream is fixing, so "it compiles" is not evidence. Radix does not mount
 * inactive tab content and dialog bodies are absent until opened, so both must
 * be driven in a real browser.
 */

import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { db, createAndLogin, destroyUser, BASE, startSection, expect, ok, summary, TAG } from "./qa-lib.mjs";

const SHOT_HEALTH = path.join(os.tmpdir(), "account-health.png");
const SHOT_ISSUES = path.join(os.tmpdir(), "client-issues.png");

const created = [];
const made = { institutions: [] };

try {
  startSection("Client issues + health (browser)");

  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  created.push(admin);

  const inst = await db.institution.create({
    data: { name: `${TAG}-UIClient`, country: "Canada", type: "UNIVERSITY", createdById: admin.user.id },
  });
  made.institutions.push(inst.id);

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

  await page.goto(`${BASE}/institutions/${inst.id}`, { waitUntil: "networkidle" });
  expect(!page.url().includes("/login"), "reached the client page", page.url());

  // ── Account health card, on the Governance tab ──────────────────────────
  await page.getByRole("tab", { name: "Governance" }).click();
  await page.waitForSelector("text=Account Health", { timeout: 15000 });
  ok("Account Health card is rendered on Governance");

  // It must show the REAL rating, not a hardcoded default. A new client is GREY.
  await page.waitForFunction(() => !document.body.innerText.includes("Checking…"), { timeout: 10000 });
  const cardText = await page.locator("text=Account Health").first().locator("..").innerText();
  expect(/Grey/i.test(cardText), "shows the actual current rating (Grey for a new client)", cardText.slice(0, 80));

  await page.getByRole("button", { name: "Change" }).click();
  await page.waitForSelector("text=Set account health", { timeout: 10000 });
  ok("the change dialog opens");

  const dialog = page.getByRole("dialog");
  const save = dialog.getByRole("button", { name: "Save" });
  expect(!(await save.isDisabled()), "Green needs no intervention, so Save is enabled");

  // Choosing Red must demand the four fields the spec names.
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /Red/ }).click();
  await page.waitForTimeout(300);
  for (const f of ["Reason", "Corrective action", "Action owner", "Review date"]) {
    expect(await dialog.locator(`text=${f}`).count() >= 1, `Red asks for ${f}`);
  }
  expect(await save.isDisabled(), "*** Save is blocked until the corrective action is given ***");

  await page.screenshot({ path: SHOT_HEALTH, fullPage: false });
  ok(`screenshot: ${SHOT_HEALTH}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ── Issues tab ──────────────────────────────────────────────────────────
  const issuesTab = page.getByRole("tab", { name: "Issues" });
  expect(await issuesTab.count() === 1, "the Issues tab exists");
  await issuesTab.click();
  await page.waitForSelector("text=Raise an issue", { timeout: 15000 });
  ok("Issues panel is rendered");
  // Wait for the list to actually load — asserting while it still says
  // "Loading…" tested nothing.
  await page.waitForFunction(() => !document.body.innerText.includes("Loading…"), { timeout: 10000 });
  expect(await page.locator("text=No issues raised against this client").count() === 1,
    "empty state shown for a new client");

  await page.getByRole("button", { name: /Raise an issue/ }).click();
  await page.waitForSelector("text=Target resolution", { timeout: 10000 });
  ok("the raise-issue dialog opens");

  const d2 = page.getByRole("dialog");
  const raise = d2.getByRole("button", { name: "Raise issue" });
  expect(await raise.isDisabled(), "blocked until a title and owner are given");

  await d2.getByRole("textbox").first().fill(`${TAG} offer turnaround slipping`);

  // Owner is the third combobox (category, severity, owner). Counting
  // getByRole("option") globally was wrong — it picked up whichever popper was
  // open and reported 1 while the picker was in fact populated. Assert on a
  // real listbox instead, and on a name that can only come from the database.
  await d2.getByRole("combobox").nth(2).click();
  const listbox = page.getByRole("listbox");
  await listbox.waitFor({ timeout: 10000 });
  // Wait for the options to actually render. The listbox element appears before
  // its children, so reading immediately returned just the placeholder and the
  // assertion failed while the picker was in fact fine — the click a line later
  // auto-waited and succeeded, which is how the contradiction showed up.
  await page
    .getByRole("option")
    .filter({ hasNotText: /choose an owner/i })
    .first()
    .waitFor({ timeout: 10000 });
  const optionNames = await listbox.getByRole("option").allInnerTexts();
  const realOwners = optionNames.filter((t) => !/choose an owner/i.test(t));
  expect(realOwners.length > 0,
    "the owner picker is populated from real users",
    `${optionNames.length} options: ${optionNames.slice(0, 3).join(" | ")}`);
  await listbox.getByRole("option").filter({ hasNotText: /choose an owner/i }).first().click();
  await page.waitForTimeout(300);
  expect(!(await raise.isDisabled()), "*** Raise enables once title and owner are set ***");

  await page.screenshot({ path: SHOT_ISSUES, fullPage: false });
  ok(`screenshot: ${SHOT_ISSUES}`);

  // Actually submit, and confirm it lands.
  await raise.click();
  await page.waitForTimeout(2500);
  const storedRows = await db.clientIssue.findMany({
    where: { institutionId: inst.id },
    select: { title: true, ownerId: true, category: true, severity: true },
  });
  expect(storedRows.length === 1, "*** submitting the form actually created the issue ***", `${storedRows.length}`);
  // The owner is what the failing assertion was really about: if the picker had
  // genuinely been empty, this could not have been set.
  expect(!!storedRows[0]?.ownerId,
    "*** the created issue carries a real owner from the picker ***",
    String(storedRows[0]?.ownerId));
  const ownerExists = storedRows[0]?.ownerId
    ? await db.user.count({ where: { id: storedRows[0].ownerId } })
    : 0;
  expect(ownerExists === 1, "that owner is a real user row", `${ownerExists}`);

  const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  expect(real.length === 0, "no console errors", real.slice(0, 2).join(" | "));

  await browser.close();
} finally {
  await db.accountIntervention.deleteMany({ where: { institutionId: { in: made.institutions } } }).catch(() => {});
  await db.clientIssue.deleteMany({ where: { institutionId: { in: made.institutions } } }).catch(() => {});
  await db.auditLog.deleteMany({ where: { entityId: { in: made.institutions } } }).catch(() => {});
  for (const c of created) await destroyUser(c);
  for (const id of made.institutions) await db.institution.delete({ where: { id } }).catch(() => {});
  await db.$disconnect();
}
summary();
