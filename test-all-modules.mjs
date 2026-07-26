import { chromium } from "playwright";
import { join } from "path";
import { mkdirSync } from "fs";

const BASE = "http://localhost:3000";
const DIR = join(import.meta.dirname, "screenshots", "guide");
mkdirSync(DIR, { recursive: true });

const results = [];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  async function test(name, desc, fn) {
    try {
      await fn();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: join(DIR, `${name}.png`), fullPage: false });
      console.log(`  PASS [${name}] ${desc}`);
      results.push({ name, desc, status: "PASS" });
    } catch (e) {
      console.log(`  FAIL [${name}] ${desc}: ${e.message}`);
      try { await page.screenshot({ path: join(DIR, `${name}-error.png`), fullPage: false }); } catch {}
      results.push({ name, desc, status: "FAIL", error: e.message });
    }
  }

  // Login
  console.log("Logging in...");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"], input[name="email"]', "admin@illume.edu");
  await page.fill('input[type="password"], input[name="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard**", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // ──── DASHBOARD ────
  console.log("\n=== DASHBOARD ===");
  await test("01-dashboard", "Dashboard loads with stats", async () => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(2000);
  });

  // ──── CLIENTS (INSTITUTIONS) ────
  console.log("\n=== CLIENTS ===");
  await test("02a-clients-list", "Institution list with data", async () => {
    await page.goto(`${BASE}/institutions`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
    const cards = await page.locator('a[href*="/institutions/"]').count();
    if (cards < 1) throw new Error("No institution cards found");
  });

  await test("02b-client-detail", "Institution detail page", async () => {
    await page.locator('a[href*="/institutions/"]').first().click();
    await page.waitForTimeout(2500);
  });

  await test("02c-client-kpis", "KPIs tab with data", async () => {
    const kpiTab = page.locator('[role="tab"]:has-text("KPIs")');
    if (await kpiTab.isVisible()) {
      await kpiTab.click();
      await page.waitForTimeout(1500);
    }
  });

  await test("02d-client-contracts", "Contracts tab with Files column", async () => {
    const tab = page.locator('[role="tab"]:has-text("Contracts")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1500);
    }
  });

  await test("02e-client-contacts", "Contacts tab", async () => {
    const tab = page.locator('[role="tab"]:has-text("Contacts")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
  });

  await test("02f-client-governance", "Governance dashboard", async () => {
    const tab = page.locator('[role="tab"]:has-text("Governance")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1500);
    }
  });

  // ──── STUDENTS ────
  console.log("\n=== STUDENTS ===");
  await test("03-students", "Student pipeline with leads", async () => {
    await page.goto(`${BASE}/students`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(2000);
  });

  // ──── MARKETS ────
  console.log("\n=== MARKETS ===");
  await test("04a-markets", "Markets listing", async () => {
    await page.goto(`${BASE}/markets`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  await test("04b-market-detail", "Market detail page", async () => {
    const link = page.locator('a[href*="/markets/"]').first();
    if (await link.isVisible()) {
      await link.click();
      await page.waitForTimeout(2000);
    }
  });

  // ──── STAKEHOLDERS ────
  console.log("\n=== STAKEHOLDERS ===");
  await test("05a-stakeholders-schools", "Schools tab with data", async () => {
    await page.goto(`${BASE}/stakeholders`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  await test("05b-stakeholders-agents", "Agents tab with data", async () => {
    const tab = page.locator('[role="tab"]:has-text("Agents")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
  });

  await test("05c-stakeholders-counsellors", "Counsellors tab", async () => {
    const tab = page.locator('[role="tab"]:has-text("Counsellors")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
  });

  await test("05d-stakeholders-performance", "Agent performance dashboard", async () => {
    const tab = page.locator('[role="tab"]:has-text("Performance")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
  });

  // ──── ACTIVITIES ────
  console.log("\n=== ACTIVITIES ===");
  await test("06a-activities", "Activities list with data", async () => {
    await page.goto(`${BASE}/activities`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  await test("06b-log-activity", "Log Activity dialog", async () => {
    const btn = page.locator('button:has-text("Log Activity")');
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(800);
    }
  });

  // ──── TASKS ────
  console.log("\n=== TASKS ===");
  await test("07-tasks", "Tasks page with data", async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  // ──── TRAVEL ────
  console.log("\n=== TRAVEL ===");
  await test("08a-travel", "Travel management page", async () => {
    await page.goto(`${BASE}/travel`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  await test("08b-travel-reporting", "Travel reporting tab", async () => {
    const tab = page.locator('[role="tab"]:has-text("Travel Reporting"), button:has-text("Travel Reporting")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
  });

  // ──── REPORTS ────
  console.log("\n=== REPORTS ===");
  await test("09a-reports", "Reports page", async () => {
    await page.goto(`${BASE}/reports`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  await test("09b-qbr", "QBR page", async () => {
    await page.goto(`${BASE}/reports/qbr`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  // ──── RISK & COMPLIANCE ────
  console.log("\n=== RISK & COMPLIANCE ===");
  await test("10a-risks", "Risk register with data", async () => {
    await page.goto(`${BASE}/risk-compliance`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  await test("10b-compliance", "Compliance tracker", async () => {
    const tab = page.locator('[role="tab"]:has-text("Compliance"), button:has-text("Compliance")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
  });

  // ──── HR & ERP ────
  console.log("\n=== HR & ERP ===");
  await test("11a-hr-overview", "HR overview with charts", async () => {
    await page.goto(`${BASE}/hr`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  await test("11b-performance-reviews", "Performance reviews tab", async () => {
    const tab = page.locator('[role="tab"]:has-text("Performance Reviews"), button:has-text("Performance Reviews")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
  });

  await test("11c-succession", "Succession planning tab", async () => {
    const tab = page.locator('[role="tab"]:has-text("Succession Planning"), button:has-text("Succession Planning")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
  });

  // ──── KNOWLEDGE BASE ────
  console.log("\n=== KNOWLEDGE BASE ===");
  await test("12a-knowledge-general", "General knowledge base", async () => {
    await page.goto(`${BASE}/knowledge`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  await test("12b-knowledge-institution", "Institution KB tab", async () => {
    const tab = page.locator('[role="tab"]:has-text("Institution KB"), button:has-text("Institution KB")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
  });

  await test("12c-knowledge-market", "Market KB tab", async () => {
    const tab = page.locator('[role="tab"]:has-text("Market KB"), button:has-text("Market KB")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
  });

  await test("12d-knowledge-proposals", "Proposal library tab", async () => {
    const tab = page.locator('[role="tab"]:has-text("Proposal Library"), button:has-text("Proposal Library")');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
  });

  // ──── ANALYTICS ────
  console.log("\n=== ANALYTICS ===");
  await test("13a-analytics", "Analytics dashboard", async () => {
    await page.goto(`${BASE}/analytics`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(2500);
  });

  await test("13b-executive-widgets", "Executive command centre", async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  });

  // ──── SIDEBAR ────
  console.log("\n=== SIDEBAR ===");
  await test("14-sidebar", "Sidebar with all nav items", async () => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
    const sidebar = page.locator('aside').first();
    if (await sidebar.isVisible()) {
      await sidebar.screenshot({ path: join(DIR, "14-sidebar.png") });
    }
  });

  await browser.close();

  // Summary
  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  console.log(`\n${"=".repeat(50)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${results.length}`);
  if (failed > 0) {
    console.log("\nFailed tests:");
    results.filter(r => r.status === "FAIL").forEach(r => console.log(`  - ${r.name}: ${r.error}`));
  }
  console.log(`\nScreenshots saved to ./screenshots/guide/`);
}

main().catch(console.error);
