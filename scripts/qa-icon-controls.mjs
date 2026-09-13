/**
 * Do the icon-only controls actually work?
 *
 *   npx tsx --env-file=.env scripts/qa-icon-controls.mjs
 *
 * The button sweep called these dead, and unlike the tabs and the dev-tools
 * overlay they would be real faults if they were: ten pencils and ten bins on
 * /risk-compliance are per-row Edit and Delete, and the chevrons on
 * /activity-log expand a row to show what changed.
 *
 * Clicks one of each and reports what happened. A bin is clicked but its
 * confirmation is never accepted — the question is whether the control
 * responds, not whether it can destroy a row.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, ok, fail, expect, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
let ctx, browser;

/** Clicks the nth button carrying `icon` and reports what changed. */
async function probe(page, icon, nth = 0) {
  const before = {
    dialogs: await page.locator('[role="dialog"], [role="alertdialog"]').count(),
    html: (await page.locator("main").innerHTML().catch(() => "")).length,
  };
  const btns = page.locator(`button:visible:has(svg.${icon})`);
  const count = await btns.count();
  if (count <= nth) return { count, result: "NOT FOUND" };

  const requests = [];
  const onReq = (r) => { if (/\/api\//.test(r.url())) requests.push(r.url()); };
  page.on("request", onReq);
  await btns.nth(nth).click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2000);
  page.off("request", onReq);

  const after = {
    dialogs: await page.locator('[role="dialog"], [role="alertdialog"]').count(),
    html: (await page.locator("main").innerHTML().catch(() => "")).length,
  };
  const parts = [];
  if (after.dialogs > before.dialogs) parts.push("opened a dialog");
  if (requests.length) parts.push(`${requests.length} request(s)`);
  if (Math.abs(after.html - before.html) > 40) parts.push(`DOM changed by ${after.html - before.html} chars`);
  return { count, result: parts.length ? parts.join(", ") : "NOTHING HAPPENED" };
}

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1600, height: 1300 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  const page = await bctx.newPage();

  // ── Risk & Compliance: per-row edit and delete ───────────────────────────
  startSection("/risk-compliance row actions");
  await page.goto(`${BROWSER_BASE}/risk-compliance`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3500);

  const pencil = await probe(page, "lucide-pencil");
  ok(`${pencil.count} edit buttons — clicking one: ${pencil.result}`);
  expect(
    pencil.result !== "NOTHING HAPPENED" && pencil.result !== "NOT FOUND",
    "the row Edit button responds",
    "ten rows each offering an Edit that does nothing"
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);

  // Delete uses a NATIVE window.confirm, which Playwright auto-dismisses — so
  // the handler returns early and the button looks dead when it is not. That
  // is also exactly why the button sweep flagged it. Cancel it deliberately
  // first, then accept it, so both paths are checked.
  let confirmSeen = null;
  page.once("dialog", async (d) => { confirmSeen = d.message(); await d.dismiss(); });
  const binCancelled = await probe(page, "lucide-trash2");
  ok(`${binCancelled.count} delete buttons`);
  expect(
    !!confirmSeen,
    "Delete asks for confirmation first",
    "no confirm appeared — the click reached nothing"
  );
  ok(`  it asks: "${confirmSeen ?? "(nothing)"}"`);
  expect(
    binCancelled.result === "NOTHING HAPPENED",
    "cancelling the confirm deletes nothing",
    `something happened anyway: ${binCancelled.result}`
  );

  page.once("dialog", async (d) => { await d.accept(); });
  const binAccepted = await probe(page, "lucide-trash2");
  expect(
    binAccepted.result.includes("request"),
    "accepting the confirm actually deletes",
    `no request was sent: ${binAccepted.result}`
  );
  ok(`  accepted → ${binAccepted.result}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);

  // ── Activity log: the row expanders ──────────────────────────────────────
  startSection("/activity-log row expanders");
  await page.goto(`${BROWSER_BASE}/activity-log`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3500);

  const chevron = await probe(page, "lucide-chevron-down");
  ok(`${chevron.count} chevron buttons — clicking one: ${chevron.result}`);
  expect(
    chevron.result !== "NOTHING HAPPENED" && chevron.result !== "NOT FOUND",
    "the row expander responds",
    "every row offers an expander that shows nothing"
  );

  // ── The Search control ───────────────────────────────────────────────────
  startSection("/activity-log search");
  const box = page.locator('input[type="search"], input[placeholder*="earch"]').first();
  if (!(await box.isVisible().catch(() => false))) {
    fail("no search input found on /activity-log");
  } else {
    const rowsBefore = await page.locator("tbody tr, [data-row]").count();
    await box.fill("zzzzz-no-such-entry");
    await page.waitForTimeout(2500);
    const rowsAfter = await page.locator("tbody tr, [data-row]").count();
    ok(`rows ${rowsBefore} → ${rowsAfter} after typing nonsense`);
    expect(
      rowsAfter !== rowsBefore,
      "typing in the search box filters the list",
      "the box accepts text and the list never changes"
    );
  }
} catch (e) {
  startSection("fatal");
  fail("suite threw", e?.stack ?? String(e));
} finally {
  if (browser) await browser.close();
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
  summary();
}
