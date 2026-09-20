/**
 * The personal dashboard: does it show work that actually needs doing?
 *
 *   npx tsx --env-file=.env scripts/qa-personal-dashboard.mjs
 *
 * ★ THE POINT OF THE CHANGE. The personal dashboard showed what an ICR HAS —
 * lead counts, a pipeline bar — and nothing about what needs them. The nightly
 * automations already compute exactly that and now email it every morning, so
 * the inbox said "six things need you" and the dashboard had nowhere to look.
 *
 * ★ THE ASSERTION THAT MATTERS is that a card with real work behind it is NOT
 * empty, and a card with none says so in words. "The page returned 200" would
 * pass against a dashboard rendering four zeroes.
 *
 * Footprint: disposable users, leads and tasks, all removed in `finally`.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const { getDashboardActions } = await import("@/lib/dashboard-actions");

const made = { users: [], leads: [], tasks: [] };
let baseline = {};
let browser;
let template;

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
const dayFromNow = (n) => new Date(Date.now() + n * 86_400_000);

try {
  startSection("Fixtures — an ICR with work that genuinely needs doing");
  baseline = { users: await db.user.count(), leads: await db.lead.count(), tasks: await db.task.count() };
  template = await db.lead.findFirst({ where: { deletedAt: null } });
  expect(!!template, "found a lead to copy required fields from");

  const icr = await createAndLogin({ role: "ICR", withEmployee: true });
  made.users.push(icr);

  // Two stalled students. `stageEnteredAt` is the field the staleness is
  // measured from — not lastContactedAt, which is the trap that made an
  // earlier suite look like a broken feature.
  for (let i = 0; i < 2; i++) {
    const { id, createdAt, updatedAt, captureId, ...rest } = template;
    const l = await db.lead.create({
      data: {
        ...rest,
        firstName: "ZZDash", lastName: `Stalled${i}`,
        email: `zzdash-${i}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@illume.local`,
        stage: "CONTACTED",
        assignedICRId: icr.user.id,
        createdById: icr.user.id,
        stageEnteredAt: daysAgo(25),
      },
    });
    made.leads.push(l.id);
  }

  // One overdue task and one upcoming. Task.assigneeId references EMPLOYEES,
  // not users — the odd one out among the ownership columns.
  const overdue = await db.task.create({
    data: {
      title: "ZZDash overdue task", status: "TODO", priority: "HIGH",
      dueDate: daysAgo(3), assigneeId: icr.employee.id, createdById: icr.employee.id,
    },
  });
  const upcoming = await db.task.create({
    data: {
      title: "ZZDash upcoming task", status: "IN_PROGRESS", priority: "MEDIUM",
      dueDate: dayFromNow(5), assigneeId: icr.employee.id, createdById: icr.employee.id,
    },
  });
  made.tasks.push(overdue.id, upcoming.id);

  // ── The data layer ────────────────────────────────────────────────────────
  startSection("getDashboardActions gathers the right work");
  {
    const a = await getDashboardActions(icr.user.id);
    expect(a.counts.stale === 2, `both stalled students found, saw ${a.counts.stale}`);
    expect(a.counts.openTasks === 2, `both open tasks found, saw ${a.counts.openTasks}`);
    expect(a.counts.overdueTasks === 1, `one overdue, saw ${a.counts.overdueTasks}`);
    expect(a.items.length >= 3, `${a.items.length} action items assembled`);
    expect(a.items[0]?.urgent === true,
      "urgent items sort first, so the top of the card cannot wait");
    expect(a.items.some((i) => i.kind === "task" && /overdue/i.test(i.detail)),
      "the overdue task is listed as an action item");
    expect(!a.items.some((i) => i.title.includes("upcoming")),
      "…but a task that is merely upcoming is not — that is not yet a problem");
  }

  // ── Closed students must not be chased ────────────────────────────────────
  startSection("Closed and deferred students are not listed as needing attention");
  {
    const { id, createdAt, updatedAt, captureId, ...rest } = template;
    const closed = await db.lead.create({
      data: {
        ...rest,
        firstName: "ZZDash", lastName: "Closed",
        email: `zzdash-closed-${Date.now()}@illume.local`,
        stage: "LOST",
        assignedICRId: icr.user.id, createdById: icr.user.id,
        stageEnteredAt: daysAgo(200),
      },
    });
    made.leads.push(closed.id);

    const a = await getDashboardActions(icr.user.id);
    expect(!a.items.some((i) => i.title.includes("Closed")),
      "★ a LOST student 200 days cold is not 'needing attention'",
      "closed records are supposed to be dormant; listing them buries the live ones");
    expect(a.counts.stale === 2, `stale count is still 2, saw ${a.counts.stale}`);
  }

  // ── Someone with nothing to do ────────────────────────────────────────────
  startSection("An empty list is a real state, not an error");
  {
    const idle = await createAndLogin({ role: "ICR", withEmployee: true });
    made.users.push(idle);
    const a = await getDashboardActions(idle.user.id);
    expect(a.items.length === 0 && a.tasks.length === 0,
      "a person with no caseload gets an empty list, not a crash");
  }

  // ── A user with no employee row ───────────────────────────────────────────
  startSection("A user with no employee record still loads");
  {
    const noEmp = await createAndLogin({ role: "ICR" });   // withEmployee omitted
    made.users.push(noEmp);
    expect(!noEmp.employee, "this account deliberately has no employee row");
    const a = await getDashboardActions(noEmp.user.id);
    expect(Array.isArray(a.tasks) && a.tasks.length === 0,
      "★ tasks resolve to empty rather than throwing",
      "Task.assigneeId points at employees, so a user without one has no tasks");
  }

  // ── It actually renders ───────────────────────────────────────────────────
  startSection("The cards render on the page with the data in them");
  {
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1400 } });
    await ctx.addCookies(
      [...icr.jar.cookies.entries()].map(([name, value]) => ({
        name, value, domain: "localhost", path: "/",
      }))
    );
    const page = await ctx.newPage();
    const jsErrors = [];
    page.on("pageerror", (e) => jsErrors.push(e.message));

    await page.goto(`${BROWSER_BASE}/dashboard?view=personal`, {
      waitUntil: "networkidle", timeout: 60000,
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".animate-pulse").length === 0, { timeout: 25000 }
    ).catch(() => {});
    await page.waitForTimeout(1200);

    const body = await page.locator("main").innerText();

    expect(/Needs your attention/i.test(body), "the action card is on the page");
    expect(/My tasks/i.test(body), "the tasks card is on the page");
    expect(body.includes("ZZDash Stalled0"),
      "a stalled student is named on it, not just counted");
    expect(body.includes("ZZDash overdue task"),
      "and so is the overdue task");
    expect(/time-critical|urgent/i.test(body),
      "the urgent count is called out");

    // The existing cards must survive — the ask was to ADD, not replace.
    for (const kept of ["My Leads", "Pipeline", "Leave", "Holidays"]) {
      expect(new RegExp(kept, "i").test(body), `"${kept}" is still on the page`);
    }

    for (const bad of ["NaN", "undefined", "[object Object]"]) {
      expect(!body.includes(bad), `renders no "${bad}"`);
    }
    expect(jsErrors.length === 0, "no client-side errors",
      jsErrors.slice(0, 2).join(" | "));

    await page.screenshot({ path: "screenshots/dashboard-personal.png", fullPage: true });
  }
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const id of made.tasks) await db.task.delete({ where: { id } }).catch(() => {});
  for (const id of made.leads) {
    await db.leadActivity.deleteMany({ where: { leadId: id } }).catch(() => {});
    await db.lead.delete({ where: { id } }).catch(() => {});
  }
  await db.lead.deleteMany({ where: { firstName: "ZZDash" } }).catch(() => {});
  await db.task.deleteMany({ where: { title: { startsWith: "ZZDash" } } }).catch(() => {});
  for (const u of made.users) await destroyUser(u);

  const after = { users: await db.user.count(), leads: await db.lead.count(), tasks: await db.task.count() };
  startSection("Footprint");
  for (const k of Object.keys(baseline)) {
    expect(after[k] === baseline[k], `${k} back to ${baseline[k]}`, `now ${after[k]}`);
  }
  summary();
  await db.$disconnect();
}
