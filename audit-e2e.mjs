import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = "https://illumestudentservices.cloud";
const EMAIL = "admin@illumestudentservices.cloud";
const PASSWORD = "Illume@Admin2026!";
const OUT = join(import.meta.dirname, "audit-shots");
mkdirSync(OUT, { recursive: true });

const PAGES = [
  ["dashboard", "/dashboard"],
  ["students", "/students"],
  ["institutions", "/institutions"],
  ["sources", "/sources"],
  ["markets", "/markets"],
  ["stakeholders", "/stakeholders"],
  ["activities", "/activities"],
  ["events", "/events"],
  ["tasks", "/tasks"],
  ["travel", "/travel"],
  ["reports", "/reports"],
  ["reports-qbr", "/reports/qbr"],
  ["reports-new", "/reports/new"],
  ["risk-compliance", "/risk-compliance"],
  ["knowledge", "/knowledge"],
  ["analytics", "/analytics"],
  ["hr", "/hr"],
  ["whatsapp", "/whatsapp"],
  ["activity-log", "/activity-log"],
  ["settings", "/settings"],
  ["search", "/search"],
];

const findings = [];
const log = (sev, area, msg) => {
  findings.push({ sev, area, msg });
  console.log(`[${sev}] ${area}: ${msg}`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();

// Collect runtime problems
const consoleErrors = [];
const netFails = [];
page.on("console", (m) => {
  if (m.type() === "error") {
    const t = m.text();
    if (!/favicon|Download the React DevTools|net::ERR_/.test(t)) consoleErrors.push({ url: page.url(), text: t.slice(0, 300) });
  }
});
page.on("pageerror", (e) => consoleErrors.push({ url: page.url(), text: "PAGEERROR: " + String(e).slice(0, 300) }));
page.on("response", (r) => {
  if (r.status() >= 400 && !r.url().includes("favicon")) netFails.push({ page: page.url(), url: r.url(), status: r.status() });
});

console.log("=== LOGIN ===");
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.screenshot({ path: join(OUT, "00-login.png") });

await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
const tLogin = Date.now();
await page.click('button[type="submit"]');
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(1500);
  if (!page.url().includes("/login")) break;
}
const loginMs = Date.now() - tLogin;
console.log(`Login took ${(loginMs / 1000).toFixed(1)}s`);
if (loginMs > 5000) log("MEDIUM", "auth", `Login is slow: ${(loginMs / 1000).toFixed(1)}s to redirect`);

const afterLogin = page.url();
console.log("After login URL:", afterLogin);
if (afterLogin.includes("/login")) {
  log("BLOCKER", "auth", `Login failed for ${EMAIL}. Still at ${afterLogin}`);
  await page.screenshot({ path: join(OUT, "00-login-FAILED.png") });
  await browser.close();
  writeFileSync(join(OUT, "findings.json"), JSON.stringify({ findings, consoleErrors, netFails }, null, 2));
  process.exit(1);
}
console.log("Login OK\n");

console.log("=== PAGE SWEEP ===");
for (const [name, path] of PAGES) {
  const before = consoleErrors.length;
  const beforeNet = netFails.length;
  try {
    const resp = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    const status = resp?.status() ?? 0;
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 4000));

    let flag = "OK";
    if (status >= 400) { flag = "HTTP " + status; log("HIGH", name, `HTTP ${status} on ${path}`); }
    if (/Application error|client-side exception|Internal Server Error|something went wrong/i.test(bodyText)) {
      flag = "APP ERROR"; log("BLOCKER", name, `Application error rendered on ${path}`);
    }
    if (bodyText.trim().length < 120) { flag = "EMPTY"; log("MEDIUM", name, `Page looks empty (${bodyText.trim().length} chars) on ${path}`); }

    const newErrs = consoleErrors.length - before;
    const newNet = netFails.length - beforeNet;
    if (newErrs) log("HIGH", name, `${newErrs} console error(s)`);
    if (newNet) log("MEDIUM", name, `${newNet} failed request(s)`);

    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
    console.log(`  ${name.padEnd(18)} ${String(status).padEnd(4)} ${flag.padEnd(10)} "${title.slice(0, 45)}"`);
  } catch (e) {
    log("HIGH", name, `Navigation failed: ${String(e).slice(0, 150)}`);
    console.log(`  ${name.padEnd(18)} FAILED`);
  }
}

// ---- Deep checks ----
console.log("\n=== DEEP CHECKS ===");

// Reports list -> open a report detail
try {
  await page.goto(`${BASE}/reports`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);
  const viewLink = page.locator('a[href^="/reports/"]:not([href="/reports/new"]):not([href="/reports/qbr"])').first();
  if (await viewLink.count()) {
    const href = await viewLink.getAttribute("href");
    await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(OUT, "detail-report.png"), fullPage: true });
    const txt = await page.evaluate(() => document.body.innerText);
    console.log("  Report detail loaded:", href);
    const mailBtns = await page.locator('button[title="Email this section"]').count();
    console.log("  Email-section buttons found:", mailBtns);
    if (mailBtns === 0) log("HIGH", "reports", "No email-section buttons rendered on report detail");
    if (/Application error/i.test(txt)) log("BLOCKER", "reports", "Report detail crashed");
    // Check PDF endpoint
    const pdfResp = await page.request.get(`${BASE}/api/reports/${href.split("/").pop()}/pdf`);
    console.log("  PDF endpoint:", pdfResp.status());
    if (pdfResp.status() !== 200) log("HIGH", "reports", `PDF endpoint returned ${pdfResp.status()}`);
  } else {
    log("MEDIUM", "reports", "No report rows found to open");
  }
} catch (e) { log("HIGH", "reports", "Deep check failed: " + String(e).slice(0, 150)); }

// Settings -> users tab (RBAC surface)
try {
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, "detail-settings.png"), fullPage: true });
} catch (e) { log("MEDIUM", "settings", String(e).slice(0, 120)); }

// Mobile viewport check on key pages
console.log("\n=== MOBILE (390x844) ===");
const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
for (const [name, path] of [["dashboard", "/dashboard"], ["students", "/students"], ["reports", "/reports"]]) {
  try {
    await m.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await m.waitForTimeout(2500);
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await m.screenshot({ path: join(OUT, `mobile-${name}.png`), fullPage: true });
    console.log(`  mobile-${name.padEnd(12)} h-overflow: ${overflow}px`);
    if (overflow > 8) log("MEDIUM", "responsive", `${path} overflows horizontally by ${overflow}px on mobile`);
  } catch (e) { log("MEDIUM", "responsive", `${path}: ${String(e).slice(0, 100)}`); }
}

await browser.close();

// ---- Report ----
console.log("\n\n================ SUMMARY ================");
const bySev = { BLOCKER: [], HIGH: [], MEDIUM: [], LOW: [] };
findings.forEach((f) => bySev[f.sev]?.push(f));
for (const s of ["BLOCKER", "HIGH", "MEDIUM", "LOW"]) {
  if (bySev[s].length) {
    console.log(`\n${s} (${bySev[s].length}):`);
    bySev[s].forEach((f) => console.log(`  - [${f.area}] ${f.msg}`));
  }
}
if (consoleErrors.length) {
  console.log(`\nCONSOLE ERRORS (${consoleErrors.length}):`);
  const seen = new Set();
  consoleErrors.forEach((e) => {
    const k = e.text.slice(0, 120);
    if (!seen.has(k)) { seen.add(k); console.log(`  - ${new URL(e.url).pathname}: ${e.text.slice(0, 200)}`); }
  });
}
if (netFails.length) {
  console.log(`\nFAILED REQUESTS (${netFails.length}):`);
  const seen = new Set();
  netFails.forEach((n) => {
    const k = n.status + new URL(n.url).pathname;
    if (!seen.has(k)) { seen.add(k); console.log(`  - ${n.status} ${new URL(n.url).pathname}  (on ${new URL(n.page).pathname})`); }
  });
}
if (!findings.length && !consoleErrors.length && !netFails.length) console.log("\nNo issues detected.");
writeFileSync(join(OUT, "findings.json"), JSON.stringify({ findings, consoleErrors, netFails }, null, 2));
console.log(`\nScreenshots: ${OUT}`);
