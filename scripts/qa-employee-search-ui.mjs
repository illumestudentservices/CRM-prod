/**
 * HR → Employees: the search box finds people, and the filters filter.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-employee-search-ui.mjs
 *
 * ★ WHY THIS EXISTS, AND WHY IT SHOULD HAVE EXISTED ALREADY.
 *
 * qa-settings-users-table.mjs was written for exactly this bug on the Users
 * screen — "no column declared an accessor, so row.getValue() returned nothing
 * and the global filter had nothing to work with". The Employees table had the
 * same fault and nobody looked. On top of it the search box was bound to
 * `searchKey="employeeId"`, so it matched the ID column alone: typing a
 * colleague's name answered "No results found" while they sat two rows below.
 *
 * An earlier suite, qa-employee-list-complete, checked that all 101 rows were
 * RETURNED. They were. It never checked that any of them could be FOUND, which
 * is the thing a directory is for. Counting rows is not the same as using the
 * screen, so this one drives the actual box.
 */
import { chromium } from "playwright";
import { db, createAndLogin, destroyUser, BASE, TAG } from "./qa-lib.mjs";
const { totpGenerate } = await import("../lib/totp.ts");

const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
const secretRow = await db.user.findUnique({
  where: { id: admin.user.id }, select: { twoFactorSecret: true },
});

let pass = 0, fail = 0;
const check = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  → " + detail : ""}`); }
};
const section = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 56 - t.length))}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

/**
 * How many people the screen says it is showing.
 *
 * NOT a count of <tr>: the table paginates at 25 rows, so counting rows
 * measures the page size, not the result set — and an empty result still
 * renders one row to hold the "No results found" message. The "N of M"
 * counter is the number the screen is actually claiming.
 */
async function shownCount() {
  await page.waitForTimeout(600);
  const txt = await page.getByText(/^\d+ of \d+$/).first().textContent().catch(() => null);
  if (txt) return Number(txt.split(" of ")[0]);
  // No counter (shouldn't happen) — fall back to real data rows.
  const empty = await page.getByText(/no results found/i).count();
  if (empty) return 0;
  return page.locator("table tbody tr").count();
}
/** Rows matching the SEARCH box, which the counter does not include. */
async function visibleRows() {
  await page.waitForTimeout(600);
  if (await page.getByText(/no results found/i).count()) return 0;
  return page.locator("table tbody tr").count();
}
async function typeSearch(text) {
  const box = page.getByPlaceholder(/search name, email, id/i).first();
  await box.fill(text);
  await page.waitForTimeout(700);
}

try {
  // ── Sign in ───────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(admin.email);
  await page.locator('input[type="password"]').fill(admin.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secretRow.twoFactorSecret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((x) => !/verify-2fa|login/.test(x.pathname), { timeout: 30000 });

  await page.goto(`${BASE}/hr?tab=employees`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  // A real person from the directory to hunt for.
  const target = await db.employee.findFirst({
    where: {
      isActive: true,
      user: { deletedAt: null, name: { not: null } },
      // Must have a department: half this suite filters by one.
      department: { isNot: null },
      NOT: { id: admin.employee.id },
    },
    select: {
      employeeId: true, jobTitle: true,
      user: { select: { name: true, email: true } },
      department: { select: { name: true } },
    },
    orderBy: { employeeId: "desc" },
  });
  if (!target) throw new Error("no employee to search for");
  const fullName = target.user.name;
  const firstName = fullName.split(" ")[0];
  console.log(`\n  hunting for: ${fullName} (${target.employeeId}, ${target.user.email})`);

  section("The table loads");
  const baseline = await shownCount();
  check(baseline > 50, "the whole directory is loaded, not one page",
    `the screen says it is showing ${baseline}`);

  const searchBox = page.getByPlaceholder(/search name, email, id/i);
  check(await searchBox.count() > 0,
    "the search box invites a name, not just an ID",
    "placeholder still says something else");

  // ── The thing that was broken ─────────────────────────────────────────────
  section("Searching by name");
  await typeSearch(firstName);
  const byFirst = await visibleRows();
  check(byFirst > 0 && byFirst < baseline,
    `*** typing a first name ("${firstName}") finds somebody ***`,
    `${byFirst} row(s) from ${baseline}`);
  check(await page.locator("table tbody").getByText(fullName, { exact: false }).count() > 0,
    "*** and the person typed is among them ***", "they are not in the results");

  await typeSearch(fullName);
  const byFull = await visibleRows();
  check(byFull >= 1, "a full name finds them too", `${byFull} row(s)`);

  section("Searching by the other things on the row");
  await typeSearch(target.user.email);
  check(await visibleRows() >= 1, "*** an email address finds them ***", "nothing found");

  await typeSearch(target.employeeId);
  check(await visibleRows() >= 1, "an employee ID still works", "nothing found");

  await typeSearch(target.jobTitle);
  check(await visibleRows() >= 1, "*** a job title finds people ***", "nothing found");

  if (target.department?.name) {
    await typeSearch(target.department.name);
    check(await visibleRows() >= 1, "*** a department name finds people ***", "nothing found");
  }

  section("And it says so when there is nothing");
  await typeSearch("zzzzz-no-such-person-zzzzz");
  const none = await visibleRows();
  check(none === 0, "a nonsense search returns no rows", `${none} row(s)`);
  check(await page.getByText(/no results found/i).count() > 0,
    "and the empty state is shown", "no empty state");

  await typeSearch("");
  check(await shownCount() === baseline, "clearing the box brings everyone back",
    `${await shownCount()} vs ${baseline}`);

  // ── Filters ───────────────────────────────────────────────────────────────
  section("Filters exist at all");
  const comboboxes = await page.locator('button[role="combobox"]').count();
  check(comboboxes >= 4,
    "*** there are filter dropdowns (status, department, region, type) ***",
    `${comboboxes} found`);

  const counter = page.getByText(/^\d+ of \d+$/);
  check(await counter.count() > 0,
    "and a count of what is shown against the total", "no counter");

  section("Filtering by department");
  const deptName = target.department?.name;
  if (deptName) {
    await page.locator('button[role="combobox"]').nth(1).click();
    await page.waitForTimeout(400);
    await page.getByRole("option", { name: deptName, exact: true }).first().click();
    await page.waitForTimeout(800);
    const filtered = await shownCount();
    check(filtered > 0 && filtered < baseline,
      `*** choosing "${deptName}" narrows the list ***`,
      `${filtered} of ${baseline}`);

    const dbCount = await db.employee.count({
      where: { isActive: true, user: { deletedAt: null }, department: { name: deptName } },
    });
    check(filtered === dbCount,
      "and shows exactly the people in it",
      `${filtered} on screen, ${dbCount} in the database`);
  } else {
    check(false, "a department to filter by", "the sample employee has none");
  }

  section("Clearing filters");
  const clear = page.getByRole("button", { name: /clear filters/i });
  check(await clear.count() > 0, "*** a Clear filters button appears once filtering ***", "missing");
  if (await clear.count()) {
    await clear.first().click();
    await page.waitForTimeout(800);
    check(await shownCount() === baseline, "and it puts everyone back",
      `${await shownCount()} vs ${baseline}`);
  }

  section("Filters and search compose");
  if (deptName) {
    await page.locator('button[role="combobox"]').nth(1).click();
    await page.waitForTimeout(400);
    await page.getByRole("option", { name: deptName, exact: true }).first().click();
    await page.waitForTimeout(600);
    await typeSearch(firstName);
    const both = await visibleRows();
    check(both >= 1,
      "*** a department filter plus a name search still finds them ***",
      `${both} row(s)`);
  }
} catch (e) {
  fail++;
  console.error("\nFATAL:", e.message);
  await page.screenshot({ path: "scratch/qa-employee-search-failure.png" }).catch(() => {});
} finally {
  await ctx.close();
  await browser.close();
  await destroyUser(admin);
  await db.$disconnect();
  console.log(`\n${"=".repeat(60)}\n  TOTAL: ${pass} pass / ${fail} fail\n${"=".repeat(60)}`);
  process.exit(fail ? 1 : 0);
}
