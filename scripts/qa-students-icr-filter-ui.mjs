/**
 * "Assigned ICR" filter on Students & Pipeline.
 *
 *   npx tsx --env-file=.env scripts/qa-students-icr-filter-ui.mjs
 *
 * The dropdown used to be built from `db.user.findMany({ isActive: true,
 * role: "ICR" })`, which meant:
 *   - a lead owned by someone whose role is not ICR could never be filtered for
 *     (the mirror has exactly one such lead, which is why it is asserted here),
 *   - a lead owned by a deactivated/offboarded ICR likewise,
 *   - the whole control vanished when no ICR-role user existed, even though
 *     every lead on screen had an owner — which is the state production is in.
 *
 * It is now derived from the leads themselves, plus an "Unassigned" entry that
 * only appears when such leads exist.
 *
 * Counts are compared against the DATABASE, not against the previous screen, so
 * a filter that silently returns everything cannot pass.
 *
 * Footprint: creates one disposable SUPER_ADMIN (destroyed at the end) and
 * temporarily clears one lead's assignedICRId to exercise the "Unassigned"
 * branch. The original owner is restored in `finally`.
 */
import { chromium } from "playwright";
import {
  BASE, db, createAndLogin, destroyUser,
  startSection, expect, summary,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const PATH = "/students";

let ctx, browser, unassigned = null;

/** The "N leads" counter in the filter bar. */
async function shownCount(page) {
  const txt = await page.locator("span").filter({ hasText: /^\d+ leads?$/ }).first().textContent();
  return Number(txt.trim().split(" ")[0]);
}

/**
 * The trigger is addressed by aria-label, not by its text: once an ICR is
 * chosen the trigger reads "Aisha Rahman", so a text locator matches on the
 * first screen and then silently times out on the second.
 */
const icrTrigger = (page) => page.getByLabel("Filter by assigned ICR");

/** Opens the ICR Select and returns its option labels. */
async function icrOptions(page) {
  await icrTrigger(page).click();
  await page.waitForTimeout(400);
  const opts = await page.getByRole("option").allTextContents();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return opts.map((o) => o.trim());
}

async function pickIcr(page, label) {
  await icrTrigger(page).click();
  await page.waitForTimeout(400);
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.waitForTimeout(600);
}

async function reload(page) {
  await page.goto(`${BROWSER_BASE}${PATH}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
}

try {
  // ── Expected truth, straight from the DB ───────────────────────────────────
  const owners = await db.lead.groupBy({
    by: ["assignedICRId"],
    where: { deletedAt: null, assignedICRId: { not: null } },
    _count: true,
  });
  const expected = [];
  for (const o of owners) {
    const u = await db.user.findUnique({
      where: { id: o.assignedICRId },
      select: { id: true, name: true, role: true },
    });
    expected.push({ id: o.assignedICRId, name: u.name, role: u.role, count: o._count });
  }
  expected.sort((a, b) => a.name.localeCompare(b.name));
  const nonIcrOwner = expected.find((e) => e.role !== "ICR");
  const totalLeads = await db.lead.count({ where: { deletedAt: null } });

  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );
  const page = await bctx.newPage();

  // ── 1. Dropdown contents ───────────────────────────────────────────────────
  startSection("Dropdown is present and lists every real owner");
  await reload(page);
  await page.screenshot({ path: "screenshots/icr-filter-01-page.png" });

  const opts = await icrOptions(page);
  expect(opts.length > 0, "ICR dropdown renders", `options: ${opts.join(" | ")}`);
  expect(opts[0] === "All ICRs", '"All ICRs" is first', `got ${opts[0]}`);
  for (const e of expected) {
    expect(opts.includes(e.name), `lists ${e.name} (role ${e.role})`);
  }
  expect(
    !!nonIcrOwner && opts.includes(nonIcrOwner.name),
    "lists an owner whose role is NOT ICR (the old bug)",
    nonIcrOwner ? `${nonIcrOwner.name} = ${nonIcrOwner.role}` : "no such owner in DB"
  );
  const names = opts.filter((o) => o !== "All ICRs" && o !== "Unassigned");
  expect(
    JSON.stringify(names) === JSON.stringify(expected.map((e) => e.name)),
    "owners are sorted by name",
    `${names.join(",")} vs ${expected.map((e) => e.name).join(",")}`
  );

  // ── 2. "Unassigned" is hidden when nothing is unassigned ───────────────────
  startSection('"Unassigned" only appears when it applies');
  const unassignedInDb = await db.lead.count({ where: { deletedAt: null, assignedICRId: null } });
  expect(
    opts.includes("Unassigned") === unassignedInDb > 0,
    `"Unassigned" shown == (${unassignedInDb} unassigned leads exist)`,
    `present=${opts.includes("Unassigned")}`
  );

  // ── 3. Filtering actually narrows, on Kanban ───────────────────────────────
  startSection("Kanban view honours the filter");
  expect(await shownCount(page) === totalLeads, `unfiltered shows all ${totalLeads} leads`);

  for (const e of expected) {
    await pickIcr(page, e.name);
    const n = await shownCount(page);
    expect(n === e.count, `${e.name} -> ${e.count} leads`, `screen showed ${n}`);
  }
  await page.screenshot({ path: "screenshots/icr-filter-02-filtered.png" });

  // The non-ICR owner is the case the old code could not express at all.
  await pickIcr(page, nonIcrOwner.name);
  expect(
    await shownCount(page) === nonIcrOwner.count,
    `non-ICR owner ${nonIcrOwner.name} filters to ${nonIcrOwner.count}`
  );

  // ── 4. List view honours the same filter ───────────────────────────────────
  startSection("List view honours the filter");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.waitForTimeout(1200);
  const rows = await page.locator("table tbody tr:not(:has(td[colspan]))").count();
  expect(
    rows === nonIcrOwner.count,
    `list shows ${nonIcrOwner.count} row(s) for ${nonIcrOwner.name}`,
    `got ${rows}`
  );
  await page.screenshot({ path: "screenshots/icr-filter-03-list.png" });

  // ── 5. Clear filters resets it ─────────────────────────────────────────────
  startSection("Clear filters resets the ICR filter");
  await page.getByRole("button", { name: /Clear filters/ }).click();
  await page.waitForTimeout(800);
  expect(await shownCount(page) === totalLeads, `back to all ${totalLeads} leads`);

  // ── 6. "Unassigned" branch, with one lead temporarily orphaned ─────────────
  startSection('"Unassigned" appears and works when a lead has no owner');
  const victim = await db.lead.findFirst({
    where: { deletedAt: null, assignedICRId: { not: null } },
    select: { id: true, assignedICRId: true },
  });
  unassigned = victim;
  await db.lead.update({ where: { id: victim.id }, data: { assignedICRId: null } });

  await reload(page);
  const opts2 = await icrOptions(page);
  expect(opts2.includes("Unassigned"), '"Unassigned" now offered', `options: ${opts2.join(" | ")}`);
  await pickIcr(page, "Unassigned");
  const n2 = await shownCount(page);
  expect(n2 === 1, "Unassigned -> 1 lead", `screen showed ${n2}`);
  await page.screenshot({ path: "screenshots/icr-filter-04-unassigned.png" });
} catch (e) {
  console.error("FATAL:", e.code ?? "", e.message);
  process.exitCode = 1;
} finally {
  if (unassigned) {
    await db.lead.update({
      where: { id: unassigned.id },
      data: { assignedICRId: unassigned.assignedICRId },
    });
    const back = await db.lead.count({ where: { deletedAt: null, assignedICRId: null } });
    console.log(`restored lead ${unassigned.id} -> owner ${unassigned.assignedICRId}; unassigned now ${back}`);
  }
  if (browser) await browser.close();
  if (ctx) await destroyUser(ctx);
  summary();
  await db.$disconnect();
}
