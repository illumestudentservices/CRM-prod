import { chromium } from "playwright";
import { join } from "path";

const BASE = "http://localhost:3000";
const DIR = join(import.meta.dirname, "screenshots");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Login
  console.log("Logging in...");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"], input[name="email"]', "admin@illume.edu");
  await page.fill('input[type="password"], input[name="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard**", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const screenshots = [
    // Sidebar (captured from dashboard)
    { name: "01-sidebar-new-items", path: "/dashboard", desc: "Sidebar with new nav items" },
    // Module 2 - Markets
    { name: "02-markets-listing", path: "/markets", desc: "Markets listing page" },
    // Module 3 - Stakeholders
    { name: "03-stakeholders", path: "/stakeholders", desc: "Stakeholders page with tabs" },
    // Module 4 - Activities
    { name: "04-activities", path: "/activities", desc: "Activities page with Log Activity button" },
    // Module 5 - Travel
    { name: "05-travel", path: "/travel", desc: "Travel Management page" },
    // Module 7 - Reports
    { name: "06-reports", path: "/reports", desc: "Reports page with QBR link" },
    // Module 7 - QBR
    { name: "07-qbr", path: "/reports/qbr", desc: "Quarterly Business Reviews page" },
    // Module 8 - Tasks
    { name: "08-tasks", path: "/tasks", desc: "Tasks page" },
    // Module 9 - Risk & Compliance
    { name: "09-risk-compliance", path: "/risk-compliance", desc: "Risk & Compliance page" },
    // Module 10 - HR (with new tabs)
    { name: "10-hr", path: "/hr", desc: "HR page with Performance Reviews and Succession tabs" },
    // Module 11 - Knowledge
    { name: "11-knowledge", path: "/knowledge", desc: "Knowledge Base page" },
    // Module 12 - Analytics/Executive
    { name: "12-analytics-executive", path: "/analytics", desc: "Analytics with Executive Command Centre widgets" },
  ];

  for (const s of screenshots) {
    console.log(`Capturing: ${s.desc}...`);
    try {
      await page.goto(`${BASE}${s.path}`, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: join(DIR, `${s.name}.png`), fullPage: true });
      console.log(`  -> saved ${s.name}.png`);
    } catch (err) {
      console.log(`  -> FAILED: ${err.message}`);
      // Take whatever is on screen
      await page.screenshot({ path: join(DIR, `${s.name}-error.png`), fullPage: true });
    }
  }

  // Now capture institution detail with KPIs tab
  console.log("Capturing institution detail with KPIs tab...");
  try {
    await page.goto(`${BASE}/institutions`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
    // Click first institution card/link
    const instLink = page.locator('a[href*="/institutions/"]').first();
    if (await instLink.isVisible()) {
      await instLink.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: join(DIR, "13-institution-detail.png"), fullPage: true });
      console.log("  -> saved 13-institution-detail.png");

      // Click KPIs tab
      const kpiTab = page.locator('button:has-text("KPIs"), [role="tab"]:has-text("KPIs")');
      if (await kpiTab.isVisible()) {
        await kpiTab.click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(DIR, "14-institution-kpis.png"), fullPage: true });
        console.log("  -> saved 14-institution-kpis.png");
      }
    }
  } catch (err) {
    console.log(`  -> FAILED: ${err.message}`);
  }

  // Capture market detail if any market exists
  console.log("Capturing market detail...");
  try {
    await page.goto(`${BASE}/markets`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);
    const marketLink = page.locator('a[href*="/markets/"]').first();
    if (await marketLink.isVisible()) {
      await marketLink.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: join(DIR, "15-market-detail.png"), fullPage: true });
      console.log("  -> saved 15-market-detail.png");
    }
  } catch (err) {
    console.log(`  -> FAILED: ${err.message}`);
  }

  // Scroll analytics page to see executive widgets
  console.log("Capturing executive widgets (scrolled)...");
  try {
    await page.goto(`${BASE}/analytics`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(3000);
    // Scroll down to see executive widgets
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(DIR, "16-executive-widgets-scrolled.png"), fullPage: false });
    console.log("  -> saved 16-executive-widgets-scrolled.png");
  } catch (err) {
    console.log(`  -> FAILED: ${err.message}`);
  }

  await browser.close();
  console.log("\nDone! All screenshots saved to ./screenshots/");
}

main().catch(console.error);
