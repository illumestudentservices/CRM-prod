/**
 * Hand-checks the controls the button sweep called dead.
 *
 *   npx tsx --env-file=.env scripts/qa-dead-control-triage.mjs
 *
 * The sweep reported 152, but 89 of those were the Next.js dev overlay and the
 * theme radios, and most of the rest are tabs that were ALREADY selected —
 * clicking those correctly does nothing. This looks at the ones that survive
 * that filter and would be real faults if they were genuinely inert:
 *
 *   - Export on /students and /events
 *   - 28 unlabelled controls and a Search button on /activity-log
 *   - 12 unlabelled controls on /risk-compliance
 *
 * It reports what each one actually is rather than asserting, because the
 * question here is "is this a bug or a bad detector" and that has to be
 * answered by looking.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, ok, fail, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
let ctx, browser;

/** Describes every control the sweep would have seen, with enough to judge it. */
async function describe(page, route, filter) {
  await page.goto(`${BROWSER_BASE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  return page.evaluate((f) => {
    const out = [];
    for (const el of document.querySelectorAll("button")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const label = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (f === "unlabelled" && label) continue;
      if (f && f !== "unlabelled" && !label.toLowerCase().includes(f.toLowerCase())) continue;
      out.push({
        label: label || "(unlabelled)",
        aria: el.getAttribute("aria-label") ?? "",
        title: el.getAttribute("title") ?? "",
        role: el.getAttribute("role") ?? "",
        hasPopup: el.getAttribute("aria-haspopup") ?? "",
        disabled: el.disabled,
        // The icon inside an unlabelled button is usually the whole story.
        icon: el.querySelector("svg")?.getAttribute("class")?.split(" ").find((c) => c.startsWith("lucide-")) ?? "",
        near: (el.closest("tr, li, div")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
      });
    }
    return out;
  }, filter);
}

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  const page = await bctx.newPage();

  // ── Export ───────────────────────────────────────────────────────────────
  startSection("Export on /students and /events");

  for (const route of ["/students", "/events"]) {
    await page.goto(`${BROWSER_BASE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);
    const btn = page.getByRole("button", { name: /^export$/i }).first();
    if (!(await btn.isVisible().catch(() => false))) {
      fail(`${route}: no Export button found`);
      continue;
    }
    const before = await page.getByRole("menu").count();
    await btn.click();
    await page.waitForTimeout(1500);
    const after = await page.getByRole("menu").count();
    const items = await page.getByRole("menuitem").allTextContents();
    if (after > before || items.length) {
      ok(`${route}: Export opens a menu — ${JSON.stringify(items.map((i) => i.trim()))}`);
    } else {
      fail(`${route}: Export opened NOTHING`, "this one would be a real dead control");
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // ── The unlabelled clusters ──────────────────────────────────────────────
  for (const route of ["/activity-log", "/risk-compliance"]) {
    startSection(`unlabelled controls on ${route}`);
    const ctrls = await describe(page, route, "unlabelled");
    ok(`${ctrls.length} unlabelled buttons`);
    const byIcon = {};
    for (const c of ctrls) byIcon[c.icon || "(no icon)"] = (byIcon[c.icon || "(no icon)"] ?? 0) + 1;
    ok(`icons: ${JSON.stringify(byIcon)}`);
    for (const c of ctrls.slice(0, 4)) {
      ok(`  e.g. icon=${c.icon || "none"} aria=${c.aria || "-"} title=${c.title || "-"} near="${c.near}"`);
    }
  }

  // ── The Search button ────────────────────────────────────────────────────
  startSection("Search on /activity-log");
  await page.goto(`${BROWSER_BASE}/activity-log`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  const search = page.getByRole("button", { name: /^search$/i }).first();
  if (!(await search.isVisible().catch(() => false))) {
    ok("no Search BUTTON — the sweep likely clicked a search input's wrapper");
  } else {
    const requests = [];
    page.on("request", (r) => { if (/\/api\//.test(r.url())) requests.push(r.url()); });
    await search.click();
    await page.waitForTimeout(2500);
    if (requests.length) ok(`Search fired ${requests.length} request(s)`);
    else fail("Search fired no request", "either it needs text first, or it is genuinely dead");
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
