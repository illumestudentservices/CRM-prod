/**
 * Browser check: the Create Task form offers a MULTI-assignee picker to a
 * bulk-capable user (HQ Executive) and a single assignee to everyone else.
 *   • HQ Exec: open Create Task, pick several people, submit → one task each
 *   • ICR: Create Task shows a single "Assignee" select, no multi picker
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

  // ── HQ Executive: multi-assignee picker in Create Task ──
  const ctxHq = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await cookiesFor(ctxHq, hq.jar);
  const page = await ctxHq.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${BROWSER_BASE}/tasks`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1200);
  ok("tasks page loads, no pageerror", errs.length === 0, errs.join(" | "));

  await page.getByRole("button", { name: /Create Task/i }).first().click();
  await page.waitForTimeout(400);
  const dialog = page.getByRole("dialog");
  ok("HQ Exec sees multi 'Assignees' picker", (await dialog.getByText(/Assignees\s*\(/i).count()) >= 1);

  await page.locator("#task-title").fill(`UI multi ${tag}`);
  for (const rep of reps) {
    await dialog.getByPlaceholder(/Search people/i).fill(rep.name);
    await page.waitForTimeout(300);
    await dialog.getByText(rep.name, { exact: true }).click(); // label toggles the checkbox
  }
  ok("two people selected", (await dialog.getByText(/Assignees\s*\(2 selected\)/i).count()) >= 1);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/tasks/bulk") && r.request().method() === "POST", { timeout: 20000 }),
    dialog.getByRole("button", { name: /^Create$/ }).click(),
  ]);
  ok("submit hits bulk endpoint → 201", resp.status() === 201, `status ${resp.status()}`);
  await page.waitForTimeout(500);
  const created = await db.task.count({ where: { title: `UI multi ${tag}` } });
  ok("one task per selected person persisted", created === 2, `count ${created}`);

  // ── ICR: single assignee only ──
  icr = await createAndLogin({ role: "ICR", withEmployee: true });
  const ctxIcr = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await cookiesFor(ctxIcr, icr.jar);
  const page2 = await ctxIcr.newPage();
  await page2.goto(`${BROWSER_BASE}/tasks`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page2.waitForTimeout(1000);
  await page2.getByRole("button", { name: /Create Task/i }).first().click();
  await page2.waitForTimeout(400);
  ok("ICR sees single 'Assignee' (no multi picker)",
    (await page2.getByText(/Assignees\s*\(/i).count()) === 0 && (await page2.getByText(/^Assignee$/).count()) >= 1);
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
