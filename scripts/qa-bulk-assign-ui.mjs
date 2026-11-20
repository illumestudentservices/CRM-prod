/**
 * Browser check for the bulk "Assign to reps" dialog on /tasks.
 *   • HQ Executive sees the button; opening it, picking people and submitting
 *     creates one task per person (verified in the DB)
 *   • a non-bulk role (ICR) does NOT see the button
 * Throwaway reps + tasks, cleaned up.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-bulk-assign-ui.mjs
 */
import { chromium } from "playwright";
import bcrypt from "bcryptjs";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
let fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

async function makeRep(tag) {
  const u = await db.user.create({ data: { email: `uirep-${tag}@qa.local`, firstName: "UIRep", lastName: tag, name: `UIRep ${tag}`, password: await bcrypt.hash("x", 4), role: "ICR", isActive: true } });
  const e = await db.employee.create({ data: { userId: u.id, employeeId: `UIREP-${tag}`, jobTitle: "Rep", employmentType: "FULL_TIME", startDate: new Date(), isActive: true } });
  return { userId: u.id, empId: e.id, name: `UIRep ${tag}` };
}

async function cookiesFor(ctx, jar) {
  await ctx.addCookies([...jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
}

const hq = await createAndLogin({ role: "HQ_EXECUTIVE", withEmployee: true });
let icr, browser;
const reps = [];
try {
  const tag = Date.now().toString().slice(-6);
  reps.push(await makeRep(`${tag}a`), await makeRep(`${tag}b`));

  browser = await chromium.launch();

  // ── HQ Executive: button present, dialog works ──
  const ctxHq = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await cookiesFor(ctxHq, hq.jar);
  const page = await ctxHq.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${BROWSER_BASE}/tasks`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  ok("tasks page loads, no pageerror", errs.length === 0, errs.join(" | "));
  ok("HQ Exec sees 'Assign to reps'", (await page.getByRole("button", { name: /Assign to reps/i }).count()) >= 1);

  await page.getByRole("button", { name: /Assign to reps/i }).click();
  await page.waitForTimeout(400);
  ok("dialog opens", (await page.getByText(/Assign a task to several people/i).count()) >= 1);

  await page.getByLabel("Title").fill(`UI bulk ${tag}`);
  // Pick both reps via the search + checkboxes.
  for (const rep of reps) {
    await page.getByPlaceholder(/Search people/i).fill(rep.name);
    await page.waitForTimeout(300);
    await page.getByRole("checkbox").first().click();
  }
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/tasks/bulk") && r.request().method() === "POST", { timeout: 20000 }),
    page.getByRole("button", { name: /^Assign to/i }).last().click(),
  ]);
  ok("bulk POST responded 201", resp.status() === 201, `status ${resp.status()}`);
  await page.waitForTimeout(500);

  const created = await db.task.count({ where: { title: `UI bulk ${tag}` } });
  ok("one task per selected rep persisted", created === 2, `count ${created}`);

  // ── ICR: button absent ──
  icr = await createAndLogin({ role: "ICR", withEmployee: true });
  const ctxIcr = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await cookiesFor(ctxIcr, icr.jar);
  const page2 = await ctxIcr.newPage();
  await page2.goto(`${BROWSER_BASE}/tasks`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page2.waitForTimeout(1200);
  ok("ICR does NOT see 'Assign to reps'", (await page2.getByRole("button", { name: /Assign to reps/i }).count()) === 0);
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  await db.task.deleteMany({ where: { assigneeId: { in: reps.map((r) => r.empId) } } }).catch(() => {});
  for (const rep of reps) {
    await db.employee.deleteMany({ where: { id: rep.empId } }).catch(() => {});
    await db.user.deleteMany({ where: { id: rep.userId } }).catch(() => {});
  }
  if (icr) await destroyUser(icr).catch(() => {});
  await destroyUser(hq).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}
