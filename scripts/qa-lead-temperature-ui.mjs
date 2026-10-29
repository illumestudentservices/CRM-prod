/**
 * Browser smoke for the lead-temperature UI: the pipeline list shows a Temp
 * badge + a Temperature filter, the lead page shows the badge, and the Analytics
 * "Lead Temperature" widget renders and a tile opens a drill. (no page broken)
 *
 *   npx tsx --env-file=.env.local scripts/qa-lead-temperature-ui.mjs
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const B = BASE.replace("127.0.0.1", "localhost");
let browser, admin, leadIds = [];
try {
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const base = { nationality: "T", countryOfResidence: "T", interestedProgram: "CS", intakeYear: 2027, intakeMonth: 9, studyLevel: "UNDERGRADUATE", createdById: admin.user.id, assignedICRId: admin.user.id };
  const hot = await db.lead.create({ data: { ...base, firstName: TAG, lastName: "Hot", leadTemperature: "HOT" } });
  for (const t of ["WARM", "COLD"]) leadIds.push((await db.lead.create({ data: { ...base, firstName: TAG, lastName: t, leadTemperature: t } })).id);
  leadIds.push(hot.id);

  const warm = (path) => fetch(`${BASE}${path}`, { headers: { Cookie: admin.jar.header() } }).then(() => {}).catch(() => {});
  for (const p of ["/api/auth/session", "/api/auth/csrf", "/students", `/students/${hot.id}`, "/analytics", "/api/analytics/overview?startDate=2026-01-01&endDate=2027-12-31"]) await warm(p);

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const open = async (path, ready) => {
    const p = await ctx.newPage();
    for (let a = 0; a < 5; a++) {
      await p.goto(`${B}${path}`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
      if (await p.locator(ready).first().waitFor({ state: "visible", timeout: 25000 }).then(() => true).catch(() => false)) break;
    }
    await p.waitForTimeout(1200);
    return p;
  };

  // ── Students list ────────────────────────────────────────────────────────
  startSection("Students list — Temp badge + filter");
  let p = await open("/students", "table");
  expect((await p.getByRole("columnheader", { name: "Temp" }).count()) >= 1, "list has a Temp column");
  expect((await p.getByText("All temperatures").count()) >= 1, "temperature filter control present");
  expect((await p.getByText("Hot", { exact: true }).count()) >= 1, "at least one temperature badge renders");
  await p.close();

  // ── Lead page ──────────────────────────────────────────────────────────────
  startSection("Lead page — temperature badge");
  p = await open(`/students/${hot.id}`, "h1");
  expect((await p.locator("main").getByText("Hot", { exact: true }).count()) >= 1, "lead page header shows the Hot badge");
  await p.close();

  // ── Analytics widget ───────────────────────────────────────────────────────
  startSection("Analytics — Lead Temperature widget + drill");
  p = await open("/analytics", ".recharts-surface");
  const widget = p.getByText("Lead Temperature").first();
  expect((await widget.count()) >= 1, "Lead Temperature widget renders");
  // Click the Hot tile → a drill dialog opens.
  await p.getByRole("button").filter({ hasText: "Hot" }).first().click({ force: true }).catch(() => {});
  const opened = await p.locator('[role="dialog"]').first().isVisible({ timeout: 6000 }).catch(() => false);
  expect(opened, "clicking a temperature tile opens the drill-down");
  await p.close();
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const id of leadIds) await db.lead.delete({ where: { id } }).catch(() => {});
  if (admin) await destroyUser(admin);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
