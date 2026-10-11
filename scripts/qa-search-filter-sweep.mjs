/**
 * Every table in the app: does its search box find a row you can see?
 *
 *   node --import tsx --env-file=.env.local scripts/qa-search-filter-sweep.mjs
 *
 * ★ WHY THIS EXISTS.
 *
 * There are already browser sweeps. qa-page-sweep loads every page and reports
 * crashes. qa-button-sweep clicks every control and reports the dead ones.
 * qa-surfaces checks the numbers are right. Not one of them has ever typed
 * into a search box or touched a filter.
 *
 * So the Employees directory shipped with its search bound to the ID column
 * alone: typing a colleague's name answered "No results found" while they sat
 * two rows below, and every suite stayed green. qa-employee-list-complete even
 * asserted that all 101 rows were RETURNED — which they were. Returning a row
 * and being able to find it are different claims, and only one of them was
 * ever tested.
 *
 * The method here is deliberately dumb, because clever tests are the ones that
 * pass while the screen is broken:
 *
 *   1. Read a word that is VISIBLE in the table.
 *   2. Type it into the search box.
 *   3. The row it came from must still be there.
 *
 * If that fails, the search is lying to whoever is using it.
 *
 * It also reports tables with no search box at all, which is a finding rather
 * than a failure — some lists are short enough not to need one.
 */
import { chromium } from "playwright";
import { db, createAndLogin, destroyUser, BASE } from "./qa-lib.mjs";
const { totpGenerate } = await import("../lib/totp.ts");

/** Every screen that draws a table, with the tab it lives on. */
const ROUTES = [
  ["/hr?tab=employees", "HR · Employees"],
  ["/hr?tab=leave", "HR · Leave"],
  ["/hr?tab=attendance", "HR · Attendance"],
  ["/hr?tab=performance-reviews", "HR · Performance reviews"],
  ["/hr?tab=succession-planning", "HR · Succession planning"],
  ["/hr?tab=assets", "HR · Assets"],
  ["/hr?tab=holidays", "HR · Holidays"],
  ["/hr?tab=timesheets", "HR · Timesheets"],
  ["/hr?tab=leave-balances", "HR · Leave balances"],
  ["/settings", "Settings · Users"],
  ["/students", "Students & pipeline"],
  ["/events", "Events"],
  ["/recruitment-network/partners", "Recruitment network · Partners"],
  ["/stakeholders", "Stakeholders"],
  ["/recycle-bin", "Recycle bin"],
  ["/market-intelligence", "Market intelligence"],
  ["/reports", "Reports"],
  ["/recruitment-planning", "Recruitment planning"],
];

const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
const secretRow = await db.user.findUnique({
  where: { id: admin.user.id }, select: { twoFactorSecret: true },
});

const results = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();

function note(route, label, verdict, detail) {
  results.push({ route, label, verdict, detail });
  const mark = verdict === "ok" ? "  ok  " : verdict === "none" ? "  --  " : " FAIL ";
  console.log(`${mark} ${label.padEnd(34)} ${detail}`);
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
  console.log(`signed in as ${admin.email}\n`);
  console.log("legend:  ok = search finds a visible row   -- = no search box   FAIL = search is lying\n");

  for (const [route, label] of ROUTES) {
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });

      /**
       * ★ WAIT FOR ROWS, DO NOT GUESS AT A DELAY.
       *
       * These tabs fetch after mount and some are slow. A flat 2.6s wait made
       * this sweep flaky in the worst possible direction: Leave balances
       * reported 157 searchable rows on one run and "nothing in the table" on
       * the next, and "nothing in the table" reads like a screen that needs no
       * testing rather than a screen that was never tested. A test that
       * silently skips is more dangerous than one that fails.
       */
      const bodyRows = page.locator("table tbody tr");
      let rowsBefore = 0;
      for (let i = 0; i < 24; i++) {
        rowsBefore = await bodyRows.count();
        const settled = await page
          .getByText(/no results found|nothing in the recycle bin|no .*(found|yet)/i)
          .count();
        /**
         * Rows WITH TEXT IN THEM. A loading skeleton is still a <tr>, so
         * counting rows alone let this break out early and then read a row of
         * empty cells — which it reported as "no searchable text", meaning a
         * screen that works looked like a screen with no search. Waiting for
         * actual characters is the difference between testing it and skipping
         * it while appearing not to.
         */
        const firstRowText = rowsBefore
          ? (await bodyRows.first().innerText().catch(() => "")).trim()
          : "";
        if ((rowsBefore > 1 && firstRowText.length > 3) || settled > 0) break;
        await page.waitForTimeout(600);
      }

      /**
       * An empty table still renders ONE row, to hold "No results found. Try
       * adjusting your search or filters." The first version of this sweep
       * read that sentence as data, searched for the word "adjusting", and
       * reported a broken search on a screen that simply had nothing in it.
       * A false alarm in a tool built to find real ones is worse than useless.
       */
      const emptyBefore = await page
        .getByText(/no results found|nothing in the recycle bin|no .*(found|yet)/i)
        .count();
      if (rowsBefore === 0 || emptyBefore > 0) {
        note(route, label, "none", "nothing in the table to search for");
        continue;
      }

      /**
       * ★ NOT THE FIRST SEARCH BOX ON THE PAGE.
       *
       * Every screen carries the app-wide header search, "Search students,
       * institutions…", and it is first in the DOM. The first version of this
       * sweep typed the table's own row text into THAT, got nothing back, and
       * reported five broken searches on five screens that were all fine.
       * Five false alarms is how a tool like this loses the right to be
       * believed, which is worse than not having it.
       */
      const placeholders = await page
        .locator('input[placeholder*="earch" i]')
        .evaluateAll((els) => els.map((e) => e.placeholder));
      const tableBoxIndex = placeholders.findIndex(
        (ph) => !/students,\s*institutions/i.test(ph),
      );
      if (tableBoxIndex === -1) {
        note(route, label, "none", `${rowsBefore} row(s), but no search box of its own`);
        continue;
      }
      const tableBox = page.locator('input[placeholder*="earch" i]').nth(tableBoxIndex);

      /**
       * A word taken from what is actually rendered. Not from the database —
       * the point is to search for something the reader can see with their
       * own eyes, which is the claim the box is making.
       */
      const cells = await bodyRows.first().locator("td").allInnerTexts();
      const token = cells
        .flatMap((c) => c.split(/\s+/))
        .map((w) => w.replace(/[^\w@.\-]/g, ""))
        .filter((w) => w.length >= 4 && !/^\d+$/.test(w))
        .sort((a, b) => b.length - a.length)[0];

      if (!token) {
        note(route, label, "none", "no searchable text in the first row");
        continue;
      }

      await tableBox.fill(token);
      await page.waitForTimeout(900);

      const emptyState = await page.getByText(/no results found|no .* found/i).count();
      const rowsAfter = await bodyRows.count();
      const stillThere = await page.locator("table tbody").getByText(token, { exact: false }).count();

      if (emptyState > 0 || stillThere === 0) {
        note(route, label, "fail",
          `searched "${token}" (visible on row 1) and it vanished — ${rowsAfter} row(s)`);
      } else {
        note(route, label, "ok", `"${token}" → ${rowsAfter} row(s), the row survives`);
      }

      await tableBox.fill("");
      await page.waitForTimeout(500);
    } catch (e) {
      note(route, label, "fail", `threw: ${String(e.message).slice(0, 70)}`);
    }
  }
} catch (e) {
  console.error("\nFATAL:", e.message);
} finally {
  await ctx.close();
  await browser.close();
  await destroyUser(admin);
  await db.$disconnect();

  const fails = results.filter((r) => r.verdict === "fail");
  const nones = results.filter((r) => r.verdict === "none");
  const oks = results.filter((r) => r.verdict === "ok");

  console.log("\n" + "=".repeat(64));
  console.log(`  searches that work:        ${oks.length}`);
  console.log(`  searches that lie:         ${fails.length}`);
  console.log(`  tables with no search box: ${nones.length}`);
  if (fails.length) {
    console.log("\n  LYING SEARCHES:");
    for (const f of fails) console.log(`    ${f.label} (${f.route})\n      ${f.detail}`);
  }
  if (nones.length) {
    console.log("\n  NO SEARCH BOX:");
    for (const n of nones) console.log(`    ${n.label.padEnd(34)} ${n.detail}`);
  }
  console.log("=".repeat(64));
  process.exit(fails.length ? 1 : 0);
}
