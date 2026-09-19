/**
 * Every filter in the app, driven in a browser and checked against the DATABASE.
 *
 *   npx tsx --env-file=.env scripts/qa-all-filters.mjs
 *
 * ★ THE ASSERTION THAT MATTERS is "rendered rows === count() of the same
 * predicate", never "the list got shorter". A filter that drops the wrong rows,
 * or one that silently searches only a capped first page, passes the second
 * check and fails the first. Every expectation below is computed from the DB.
 *
 * Read-only: one disposable SUPER_ADMIN, destroyed in `finally`. Creates no
 * fixtures and writes nothing, so it is safe to re-run.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
let ctx, browser, page;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Data rows only. `td[colspan]` is the "no results" row — counting it makes an
 *  empty table look like it holds one record. */
const ROWS = "table tbody tr:not(:has(td[colspan]))";
const rowCount = () => page.locator(ROWS).count();

/**
 * ★ THE NUMBER TO ASSERT ON.
 *
 * `components/shared/data-table.tsx` paginates at 25 and prints
 * "Showing 1 to 25 of N results", where N is `getFilteredRowModel().rows.length`
 * — the size of the FILTERED set, not of the page. Counting <tr> elements on a
 * paginated table caps every answer at 25 and reports a false failure the moment
 * a list outgrows one page (53 leads read as 25).
 *
 * Falls back to counting rows for the pages that do not use DataTable.
 */
async function resultCount(cardSelector) {
  // Shape 1 — shared DataTable: "Showing 1 to 25 of 53 results".
  const footer = page.getByText(/Showing\s+\d+\s+to\s+\d+\s+of\s+\d+\s+results/).first();
  if (await footer.count()) {
    const m = (await footer.innerText()).match(/of\s+(\d+)\s+results/);
    if (m) return Number(m[1]);
  }
  // Shape 2 — institutions: "Showing 3 of 8 clients". Rendered ONLY while a
  // filter is active, so its absence is not an error.
  const banner = page.getByText(/Showing\s+\d+\s+of\s+\d+\s+\w+/).first();
  if (await banner.count()) {
    const m = (await banner.innerText()).match(/Showing\s+(\d+)\s+of\s+\d+/);
    if (m) return Number(m[1]);
  }
  // Shape 3 — a card grid with no table at all (institutions unfiltered).
  if (cardSelector) return page.locator(cardSelector).count();
  return rowCount();
}

async function go(route) {
  await page.goto(`${BROWSER_BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await page
    .waitForFunction(() => document.querySelectorAll(".animate-pulse").length === 0, { timeout: 20000 })
    .catch(() => {});
}

/**
 * Opens a Radix Select and picks an option.
 *
 * A plain `.click()` is not reliable here: opening the Select mounts a portal
 * whose overlay then "intercepts pointer events", so Playwright's actionability
 * retry re-clicks the trigger and times out even though the dropdown DID open.
 * So: only click when it is closed, then confirm options actually appeared
 * before reaching for one.
 */
async function pickCombo(label, option) {
  await page.keyboard.press("Escape").catch(() => {});   // clear any stray portal
  await page.waitForTimeout(150);

  const trigger = page.locator('button[role="combobox"]', { hasText: label }).first();
  if ((await trigger.getAttribute("data-state").catch(() => null)) !== "open") {
    await trigger.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(450);
  }
  if ((await page.getByRole("option").count()) === 0) {
    await trigger.click({ force: true, timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(450);
  }
  const opt = page.getByRole("option", { name: option, exact: true }).first();
  if ((await opt.count()) === 0) {
    const available = await page.getByRole("option").allTextContents();
    await page.keyboard.press("Escape").catch(() => {});
    throw new Error(`option "${option}" not offered under "${label}" — saw: ${available.join(" | ")}`);
  }
  await opt.click({ timeout: 8000 });
  await page.waitForTimeout(700);
}

/**
 * Enum value -> the label the UI renders.
 * `APPLICATION_SUBMITTED` -> `Application Submitted`. The whole string must be
 * lowercased first: these enums arrive fully upper-case, so capitalising the
 * first letter alone leaves "ENROLLED" and no option ever matches.
 */
const titleCase = (v) =>
  v.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Types into a search box and waits for the debounce (shared ListSearch is 400ms). */
async function typeSearch(placeholderFragment, text) {
  const box = page.locator(`input[placeholder*="${placeholderFragment}" i]`).first();
  await box.fill(text);
  await page.waitForTimeout(900);
}

/** Server-side filters navigate. Waiting on the URL beats a sleep — these pages
 *  take 3-4s against the dev server. */
async function goParams(route, params) {
  const qs = new URLSearchParams(params).toString();
  await go(`${route}?${qs}`);
}

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  page = await bctx.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(e.message));

  // ═══ STUDENTS (client-side over an uncapped query) ═════════════════════════
  startSection("/students — search, stage, institution, ICR");
  {
    const total = await db.lead.count({ where: { deletedAt: null } });
    await go("/students");
    // The page opens on the kanban board; the table lives behind "List".
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.waitForTimeout(1200);
    expect(await resultCount() === total, `unfiltered list shows all ${total} leads`, `saw ${await resultCount()}`);

    // Stage filter, checked against the DB's own count for that stage.
    const byStage = await db.lead.groupBy({
      by: ["stage"], where: { deletedAt: null }, _count: true,
      orderBy: { _count: { stage: "desc" } }, take: 1,
    });
    if (byStage.length) {
      const stage = byStage[0].stage;
      const label = titleCase(stage);
      await pickCombo("All Stages", label);
      expect(await resultCount() === byStage[0]._count,
        `stage "${label}" shows ${byStage[0]._count} (DB count)`, `saw ${await resultCount()}`);
      await pickCombo(label, "All Stages").catch(() => {});
      await page.waitForTimeout(400);
    }

    // Search must match the DB's own LIKE over the same columns the component
    // searches (name, email, programme, nationality, residence, institution).
    const sample = await db.lead.findFirst({ where: { deletedAt: null, firstName: { not: "" } } });
    if (sample) {
      const term = sample.firstName;
      await typeSearch("Search leads", term);
      const dbHits = await db.lead.count({
        where: {
          deletedAt: null,
          OR: [
            { firstName: { contains: term, mode: "insensitive" } },
            { lastName: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
            { interestedProgram: { contains: term, mode: "insensitive" } },
            { nationality: { contains: term, mode: "insensitive" } },
            { countryOfResidence: { contains: term, mode: "insensitive" } },
            { institution: { name: { contains: term, mode: "insensitive" } } },
          ],
        },
      });
      expect(await resultCount() === dbHits,
        `search "${term}" shows ${dbHits} (DB count over the same columns)`, `saw ${await resultCount()}`);

      // A term that cannot match must empty the list AND say so.
      await typeSearch("Search leads", "zzz-no-such-student-zzz");
      expect(await resultCount() === 0, "impossible search returns 0 rows");
      const emptyMsg = await page.locator("td[colspan]").count();
      expect(emptyMsg > 0, "…and renders an empty-state row rather than a blank table");
      await typeSearch("Search leads", "");
    }

    // Unassigned: the option only appears when such leads exist, so check both.
    const unassigned = await db.lead.count({ where: { deletedAt: null, assignedICRId: null } });
    const icrTrigger = page.locator('button[aria-label="Filter by assigned ICR"]');
    if (await icrTrigger.count()) {
      await icrTrigger.click();
      await page.waitForTimeout(450);
      const opts = await page.getByRole("option").allTextContents();
      await page.keyboard.press("Escape");
      expect(opts.includes("Unassigned") === unassigned > 0,
        `"Unassigned" option present iff unassigned leads exist (${unassigned})`, opts.join(" | "));
    }
  }

  // ═══ INSTITUTIONS (client-side, uncapped) ══════════════════════════════════
  startSection("/institutions — status, type, region, country");
  {
    // This page is a CARD GRID with no table, so rows cannot be counted, and
    // the "Showing X of Y clients" line renders ONLY while a filter is active.
    // InstitutionCard is a `<Card>` (a plain div with `onClick={router.push}`,
    // not an anchor and with no data-slot), so there is no stable wrapper to
    // select. Assert on the NAMES instead — a stronger check than any count,
    // because it proves the right eight records are on screen, not just eight.
    const names = (
      await db.institution.findMany({ where: { deletedAt: null }, select: { name: true } })
    ).map((i) => i.name);
    await go("/institutions");
    const body = (await page.locator("main").innerText()).toLowerCase();
    const missing = names.filter((n) => !body.includes(n.toLowerCase()));
    expect(missing.length === 0,
      `unfiltered page shows all ${names.length} clients by name`,
      missing.length ? `missing: ${missing.join(", ")}` : "");

    const byType = await db.institution.groupBy({
      by: ["type"], where: { deletedAt: null }, _count: true,
      orderBy: { _count: { type: "desc" } }, take: 1,
    });
    if (byType.length && byType[0].type) {
      const t = byType[0].type;
      const label = titleCase(t);
      try {
        await pickCombo("All Types", label);
        expect(await resultCount() === byType[0]._count,
          `type "${label}" shows ${byType[0]._count} (DB count)`, `saw ${await resultCount()}`);
      } catch { expect(false, `type option "${label}" was selectable`); }
    }
  }

  // ═══ TASKS ═════════════════════════════════════════════════════════════════
  startSection("/tasks — status, priority");
  {
    await go("/tasks");
    const shown = await resultCount();
    expect(shown > 0, `task list renders ${shown} rows`);
    const byStatus = await db.task.groupBy({
      by: ["status"], _count: true, orderBy: { _count: { status: "desc" } }, take: 1,
    });
    if (byStatus.length) {
      const s = byStatus[0].status;
      const label = titleCase(s);
      try {
        await pickCombo("All Statuses", label);
        // Tasks may be scoped; compare to the visible total rather than the raw
        // table when the page scopes by assignee.
        const got = await resultCount();
        expect(got === byStatus[0]._count,
          `status "${label}" shows ${byStatus[0]._count} (DB count)`, `saw ${got}`);
      } catch { expect(false, `status option "${label}" was selectable`); }
    }
  }

  // ═══ EVENTS ════════════════════════════════════════════════════════════════
  startSection("/events — status, type");
  {
    const total = await db.event.count({ where: { deletedAt: null } });
    await go("/events");
    expect(await resultCount() === total, `unfiltered shows all ${total} events`, `saw ${await resultCount()}`);
    const byStatus = await db.event.groupBy({
      by: ["status"], where: { deletedAt: null }, _count: true,
      orderBy: { _count: { status: "desc" } }, take: 1,
    });
    if (byStatus.length) {
      const s = byStatus[0].status;
      const label = titleCase(s);
      try {
        await pickCombo("All Statuses", label);
        expect(await resultCount() === byStatus[0]._count,
          `status "${label}" shows ${byStatus[0]._count} (DB count)`, `saw ${await resultCount()}`);
      } catch { expect(false, `status option "${label}" was selectable`); }
    }
  }

  // ═══ PARTNERS (server-side URL params, 259 rows, take: 300) ════════════════
  startSection("/recruitment-network/partners — server-side filters");
  {
    const R = "/recruitment-network/partners";

    // ★ Even the "All Partners" tab restricts to PARTNER_TAB_TYPES. DIGITAL,
    // CAMPAIGN and WALK_IN rows share the Source table but are lead CHANNELS,
    // not partners, and page.tsx excludes them deliberately. Counting every
    // active Source row here reports a 4-row shortfall that is not a bug — the
    // expectation has to use the page's own predicate.
    const TAB_TYPES = ["AGENT", "SCHOOL", "REFERRAL_PARTNER", "PARTNER", "EDUCATION_PARTNER"];
    const activeWhere = { deletedAt: null, isActive: true, type: { in: TAB_TYPES } };

    await go(R);
    const baseline = await db.recruitmentPartner.count({ where: activeWhere });
    expect(await resultCount() === baseline,
      `default view shows the ${baseline} ACTIVE partners`, `saw ${await resultCount()}`);

    // Channel rows must be excluded from the page but still exist in the table.
    const channels = await db.recruitmentPartner.count({
      where: { deletedAt: null, isActive: true, type: { notIn: TAB_TYPES } },
    });
    expect(channels > 0, `${channels} DIGITAL/CAMPAIGN/WALK_IN channel rows exist`,
      "they are deliberately not partners — see TYPE_GROUPS in page.tsx");

    // Country — the largest one, so the assertion has teeth. The null group is
    // dropped in JS: Prisma 7 rejects both `country: { not: null }` and
    // `NOT: { country: null }` on a nullable column in groupBy.
    const topCountry = (
      await db.recruitmentPartner.groupBy({
        by: ["country"], where: activeWhere, _count: true,
        orderBy: { _count: { country: "desc" } },
      })
    ).filter((r) => r.country).slice(0, 1);
    if (topCountry.length) {
      const c = topCountry[0].country;
      await goParams(R, { country: c });
      expect(await resultCount() === topCountry[0]._count,
        `country="${c}" shows ${topCountry[0]._count} (DB count)`, `saw ${await resultCount()}`);
    }

    // Status — deactivated partners were unreachable before PR #124.
    const inactive = await db.recruitmentPartner.count({
      where: { deletedAt: null, isActive: false, type: { in: TAB_TYPES } },
    });
    await goParams(R, { status: "inactive" });
    expect(await resultCount() === inactive,
      `status=inactive shows the ${inactive} deactivated partners`, `saw ${await resultCount()}`);
    await goParams(R, { status: "all" });
    expect(await resultCount() === baseline + inactive,
      `status=all shows ${baseline + inactive}`, `saw ${await resultCount()}`);

    // Search.
    const p = await db.recruitmentPartner.findFirst({ where: activeWhere, select: { name: true } });
    if (p) {
      const term = p.name.split(" ")[0];
      await goParams(R, { q: term });
      const hits = await db.recruitmentPartner.count({
        where: {
          ...activeWhere,
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { country: { contains: term, mode: "insensitive" } },
            { city: { contains: term, mode: "insensitive" } },
            { contactPerson: { contains: term, mode: "insensitive" } },
          ],
        },
      });
      expect(await resultCount() === hits, `q="${term}" shows ${hits} (DB count)`, `saw ${await resultCount()}`);
    }

    // ★ Combining two filters must AND them, not replace one with the other.
    // NOTE the tab key is `agents`, not the enum `AGENT` — TYPE_GROUPS is keyed
    // by tab slug and `?type=AGENT` is not a known key, so the page falls back
    // to "all" and quietly returns the unfiltered count. Passing the enum here
    // makes the assertion look like a broken filter when it is a bad test.
    if (topCountry.length) {
      const c = topCountry[0].country;
      await goParams(R, { country: c, type: "agents" });
      const both = await db.recruitmentPartner.count({
        where: { ...activeWhere, country: c, type: "AGENT" },
      });
      expect(await resultCount() === both,
        `country="${c}" AND type=agents shows ${both} — filters combine`, `saw ${await resultCount()}`);
    }

    // An unknown tab key must fail SAFE (fall back to all), not error.
    await goParams(R, { type: "not-a-real-tab" });
    expect(await resultCount() === baseline,
      "an unknown ?type= falls back to All Partners rather than erroring",
      `saw ${await resultCount()}`);

    // ★ Tab counts must honour the active filters. Before PR #124 a tab read
    // "Agents 40" above three rows.
    if (topCountry.length) {
      const c = topCountry[0].country;
      await goParams(R, { country: c });
      const agentsInCountry = await db.recruitmentPartner.count({
        where: { ...activeWhere, country: c, type: "AGENT" },
      });
      const tabText = await page.locator('a[href*="type=agents"]').first().innerText().catch(() => "");
      expect(tabText.includes(String(agentsInCountry)),
        `the Agents tab counts within the country filter (${agentsInCountry})`, `tab read "${tabText.trim()}"`);
    }
  }

  // ═══ RECRUITMENT PLANNING → EVENTS (server-side) ═══════════════════════════
  startSection("/recruitment-planning/events — search + status tabs");
  {
    const R = "/recruitment-planning/events";
    const total = await db.event.count({ where: { deletedAt: null } });
    await go(R);
    expect(await resultCount() === total, `unfiltered shows ${total}`, `saw ${await resultCount()}`);

    const byStatus = await db.event.groupBy({
      by: ["status"], where: { deletedAt: null }, _count: true,
      orderBy: { _count: { status: "desc" } }, take: 1,
    });
    if (byStatus.length) {
      const s = byStatus[0].status;
      await goParams(R, { status: s });
      expect(await resultCount() === byStatus[0]._count,
        `status=${s} shows ${byStatus[0]._count} (DB count)`, `saw ${await resultCount()}`);

      // ★ A status tab must carry the search term across. Dropping `q` on a tab
      // click is a bug this codebase has shipped twice.
      const ev = await db.event.findFirst({ where: { deletedAt: null, status: s }, select: { name: true } });
      if (ev) {
        const term = ev.name.split(" ")[0];
        await goParams(R, { q: term });
        const tabHref = await page.locator(`a[href*="status=${s}"]`).first().getAttribute("href").catch(() => "");
        expect((tabHref ?? "").includes("q="),
          `status tab preserves the search term (q=${term})`, `href was "${tabHref}"`);
      }
    }
  }

  // ═══ RISK & COMPLIANCE ═════════════════════════════════════════════════════
  startSection("/risk-compliance — tabs + status");
  {
    await go("/risk-compliance");
    const risks = await db.riskRegister.count();
    expect(await resultCount() === risks, `Risk Register tab shows ${risks}`, `saw ${await resultCount()}`);
  }

  // ═══ ACTIVITY LOG (273 rows — the cap question) ════════════════════════════
  startSection("/activity-log — search over a large table");
  {
    await go("/activity-log");
    const shown = await resultCount();
    const total = await db.auditLog.count();
    expect(shown > 0, `renders ${shown} of ${total} audit rows`);
    expect(shown <= total, "does not render more rows than exist");
    // This search USED to fire only on form submit, so typing and waiting did
    // nothing — it was the only list in the app that behaved that way, while
    // the entity and action filters beside it applied on change. It is now
    // debounced at 400ms like components/shared/list-search.tsx.
    const box = page.locator('input[placeholder*="Search user, entity, action" i]').first();
    await box.fill("zzz-impossible-zzz");
    await page.waitForTimeout(2500);          // 400ms debounce + the refetch
    expect(await resultCount() === 0,
      `typing alone filters the list — no button press needed (was ${shown}/${total})`,
      `saw ${await resultCount()}`);

    // The Search button is gone; Enter must still work and must NOT reload.
    await box.fill("");
    await page.waitForTimeout(2000);
    expect(await resultCount() === shown, `clearing restores all ${shown} rows`);
    await box.fill("zzz-impossible-zzz");
    await box.press("Enter");
    await page.waitForTimeout(2000);
    expect(await resultCount() === 0, "Enter flushes the debounce rather than reloading the page");
    expect(new URL(page.url()).pathname === "/activity-log",
      "…and the form did not navigate away", page.url());
  }

  // ═══ STAKEHOLDERS ══════════════════════════════════════════════════════════
  startSection("/stakeholders — school/counsellor tabs");
  {
    await go("/stakeholders");
    const schools = await db.school.count();
    expect(await resultCount() === schools, `Schools tab shows ${schools}`, `saw ${await resultCount()}`);
    const counsellors = await db.counsellor.count();
    const cTab = page.locator("a,button").filter({ hasText: /Counsellors \(\d+\)/ }).first();
    if (await cTab.count()) {
      const t = await cTab.innerText();
      expect(t.includes(String(counsellors)), `Counsellors tab count reads ${counsellors}`, t.trim());
    }
  }

  // ═══ FIELD OPERATIONS (take: 100 — client-side filter over a capped query) ══
  startSection("/field-operations — capped query behind a client-side filter");
  {
    await go("/field-operations");
    const total = await db.activity.count();
    const shown = await resultCount();
    expect(shown <= 100, `renders ${shown} rows, query caps at 100 (${total} exist)`);
    expect(total <= 100 ? shown === total : true,
      `with ${total} activities the cap is not yet reached — the filter sees everything today`);
  }

  expect(jsErrors.length === 0, "no uncaught client-side errors across the sweep",
    jsErrors.slice(0, 2).join(" | "));
} catch (e) {
  console.error("FATAL:", e.code ?? "", e.message, "\n", e.stack?.split("\n").slice(1, 4).join("\n"));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (ctx) await destroyUser(ctx);
  summary();
  await db.$disconnect();
}
