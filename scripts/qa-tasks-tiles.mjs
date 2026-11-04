/**
 * QA — Tasks page figure tiles are clickable.
 *
 * Seeds 5 tasks for a disposable admin (with an Employee record), then drives
 * the real /tasks page and asserts:
 *   - the 4 summary cards (Total / To Do / In Progress / Done) filter the list
 *   - the 5 "My Task Dashboard" tiles deep-link to ?view=<bucket> and filter
 * Each assertion block runs 3× for stability.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-tasks-tiles.mjs
 */
import { chromium } from "playwright";
import { db, BASE, createAndLogin, destroyUser } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

function at(hour, dayOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function run() {
  const ctx = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  if (!ctx.employee) throw new Error("no employee created for test user");
  const empId = ctx.employee.id;
  const tag = ctx.user.name.split(" ")[0]; // the TAG

  const TITLES = {
    todoToday: `${tag} todo-today`,
    inprogOverdue: `${tag} inprog-overdue`,
    doneWeek: `${tag} done-week`,
    waiting: `${tag} waiting-ext`,
    todoWeek: `${tag} todo-week`,
  };

  const seeded = [];
  async function seed(title, data) {
    const t = await db.task.create({
      data: { title, createdById: empId, assigneeId: empId, category: "PERSONAL", ...data },
    });
    seeded.push(t.id);
  }
  await seed(TITLES.todoToday, { status: "TODO", dueDate: at(12, 0) });
  await seed(TITLES.inprogOverdue, { status: "IN_PROGRESS", dueDate: at(12, -1) });
  await seed(TITLES.doneWeek, { status: "DONE", completedAt: at(12, -2) });
  await seed(TITLES.waiting, { status: "WAITING_ON_EXTERNAL_PARTY" });
  await seed(TITLES.todoWeek, { status: "TODO", dueDate: at(12, 3) });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies([...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, url: BASE })));
    const page = await context.newPage();

    // which of our 5 seeded titles are currently rendered as rows
    async function shown() {
      const out = {};
      for (const [k, title] of Object.entries(TITLES)) {
        out[k] = (await page.getByText(title, { exact: true }).count()) > 0;
      }
      return out;
    }
    const only = (s, keys) =>
      keys.every((k) => s[k]) && Object.keys(TITLES).filter((k) => !keys.includes(k)).every((k) => !s[k]);

    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      await page.goto(`${BASE}/tasks`, { waitUntil: "domcontentloaded" });
      // Wait for our rows to render (table populated).
      await page.getByText(TITLES.todoToday, { exact: true }).first().waitFor({ timeout: 20000 });

      // --- Summary cards (status filter) ---
      await page.getByRole("button", { name: /To Do/ }).first().click();
      await page.waitForTimeout(300);
      expect("To Do card → only TODO tasks", only(await shown(), ["todoToday", "todoWeek"]));

      await page.getByRole("button", { name: /In Progress/ }).first().click();
      await page.waitForTimeout(300);
      expect("In Progress card → only IN_PROGRESS", only(await shown(), ["inprogOverdue"]));

      await page.getByRole("button", { name: /Total Tasks/ }).first().click();
      await page.waitForTimeout(300);
      expect("Total card → all 5 shown", only(await shown(), Object.keys(TITLES)));

      await page.getByRole("button", { name: /^Done/ }).first().click();
      await page.waitForTimeout(300);
      expect("Done card → only DONE", only(await shown(), ["doneWeek"]));

      // --- My Task Dashboard tiles (?view= buckets) ---
      await page.getByRole("link", { name: /Overdue/ }).first().click();
      await page.waitForURL(/view=overdue/, { timeout: 10000 });
      await page.waitForTimeout(300);
      expect("Overdue tile → only overdue task", only(await shown(), ["inprogOverdue"]));
      expect("Overdue banner visible", (await page.getByText(/Showing\s+Overdue/i).count()) >= 1);

      await page.getByRole("link", { name: /Due today/ }).first().click();
      await page.waitForURL(/view=dueToday/, { timeout: 10000 });
      await page.waitForTimeout(300);
      expect("Due today tile → only due-today task", only(await shown(), ["todoToday"]));

      await page.getByRole("link", { name: /Due this week/ }).first().click();
      await page.waitForURL(/view=dueThisWeek/, { timeout: 10000 });
      await page.waitForTimeout(300);
      // dueThisWeek is [today .. +7d], so today + the +3d task both qualify
      expect("Due this week tile → today + in-week tasks", only(await shown(), ["todoToday", "todoWeek"]));

      await page.getByRole("link", { name: /Waiting/ }).first().click();
      await page.waitForURL(/view=waiting/, { timeout: 10000 });
      await page.waitForTimeout(300);
      expect("Waiting tile → only waiting task", only(await shown(), ["waiting"]));

      await page.getByRole("link", { name: /Done this week/ }).first().click();
      await page.waitForURL(/view=completedThisWeek/, { timeout: 10000 });
      await page.waitForTimeout(300);
      expect("Done this week tile → only done task", only(await shown(), ["doneWeek"]));
    }
  } finally {
    await browser.close();
    for (const id of seeded) await db.task.delete({ where: { id } }).catch(() => {});
    await destroyUser(ctx).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
