import { chromium } from "playwright";
import { join } from "path";

const BASE = "http://localhost:3000";
const DIR = join(import.meta.dirname, "screenshots", "rfp-report");

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

  async function snap(name, desc) {
    console.log(`  [${name}] ${desc}`);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(DIR, `${name}.png`), fullPage: true });
  }

  async function snapViewport(name, desc) {
    console.log(`  [${name}] ${desc}`);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(DIR, `${name}.png`), fullPage: false });
  }

  // ──── 1. CLIENT MANAGEMENT ────
  console.log("\n=== 1. CLIENT MANAGEMENT ===");
  await page.goto(`${BASE}/institutions`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  await snap("01a-institutions-list", "Institution listing page");

  // Click first institution
  const instLink = page.locator('a[href*="/institutions/"]').first();
  if (await instLink.isVisible()) {
    await instLink.click();
    await page.waitForTimeout(2000);
    await snap("01b-institution-detail", "Institution detail - Governance tab");

    // Click Overview tab
    const overviewTab = page.locator('[role="tab"]:has-text("Overview")');
    if (await overviewTab.isVisible()) {
      await overviewTab.click();
      await page.waitForTimeout(1000);
      await snap("01c-institution-overview", "Institution overview tab");
    }

    // Click Team tab
    const teamTab = page.locator('[role="tab"]:has-text("Team")');
    if (await teamTab.isVisible()) {
      await teamTab.click();
      await page.waitForTimeout(1000);
      await snap("01d-institution-team", "Institution team tab");
    }

    // Click Contracts tab
    const contractsTab = page.locator('[role="tab"]:has-text("Contracts")');
    if (await contractsTab.isVisible()) {
      await contractsTab.click();
      await page.waitForTimeout(1000);
      await snap("01e-institution-contracts", "Institution contracts tab (Contract Repository)");
    }

    // Click Documents tab
    const docsTab = page.locator('[role="tab"]:has-text("Documents")');
    if (await docsTab.isVisible()) {
      await docsTab.click();
      await page.waitForTimeout(1000);
      await snap("01f-institution-documents", "Institution documents tab");
    }

    // Click KPIs tab
    const kpiTab = page.locator('[role="tab"]:has-text("KPIs")');
    if (await kpiTab.isVisible()) {
      await kpiTab.click();
      await page.waitForTimeout(1500);
      await snap("01g-institution-kpis", "Institution KPIs tab (KPI Management)");
    }

    // Click Governance tab back
    const govTab = page.locator('[role="tab"]:has-text("Governance")');
    if (await govTab.isVisible()) {
      await govTab.click();
      await page.waitForTimeout(1000);
      await snap("01h-institution-governance", "Client Governance Dashboard");
    }
  }

  // ──── 2. MARKET MANAGEMENT ────
  console.log("\n=== 2. MARKET MANAGEMENT ===");
  await page.goto(`${BASE}/markets`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  await snap("02a-markets-list", "Markets listing with Create Market button");

  // Open Create Market dialog
  const createMarketBtn = page.locator('button:has-text("Create Market")');
  if (await createMarketBtn.isVisible()) {
    await createMarketBtn.click();
    await page.waitForTimeout(800);
    await snap("02b-create-market-dialog", "Create Market dialog form");
    // Close dialog
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // ──── 3. STAKEHOLDER MANAGEMENT ────
  console.log("\n=== 3. STAKEHOLDER MANAGEMENT ===");
  await page.goto(`${BASE}/stakeholders`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  await snap("03a-stakeholders-schools", "Stakeholders - Schools tab");

  // Agents tab
  const agentsTab = page.locator('[role="tab"]:has-text("Agents")');
  if (await agentsTab.isVisible()) {
    await agentsTab.click();
    await page.waitForTimeout(1000);
    await snap("03b-stakeholders-agents", "Stakeholders - Agents tab");
  }

  // Counsellors tab
  const counsellorsTab = page.locator('[role="tab"]:has-text("Counsellors")');
  if (await counsellorsTab.isVisible()) {
    await counsellorsTab.click();
    await page.waitForTimeout(1000);
    await snap("03c-stakeholders-counsellors", "Stakeholders - Counsellors tab");
  }

  // Performance tab
  const perfTab = page.locator('[role="tab"]:has-text("Performance")');
  if (await perfTab.isVisible()) {
    await perfTab.click();
    await page.waitForTimeout(1000);
    await snap("03d-stakeholders-performance", "Agent Performance Dashboard");
  }

  // Open Add School dialog
  const schoolsTabBack = page.locator('[role="tab"]:has-text("Schools")');
  if (await schoolsTabBack.isVisible()) {
    await schoolsTabBack.click();
    await page.waitForTimeout(800);
  }
  const addSchoolBtn = page.locator('button:has-text("Add School")');
  if (await addSchoolBtn.isVisible()) {
    await addSchoolBtn.click();
    await page.waitForTimeout(800);
    await snap("03e-add-school-dialog", "Add School dialog form");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // ──── 4. ACTIVITY MANAGEMENT ────
  console.log("\n=== 4. ACTIVITY MANAGEMENT ===");
  await page.goto(`${BASE}/activities`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  await snap("04a-activities-list", "Activities listing page");

  // Open Log Activity dialog
  const logActivityBtn = page.locator('button:has-text("Log Activity")');
  if (await logActivityBtn.isVisible()) {
    await logActivityBtn.click();
    await page.waitForTimeout(800);
    await snap("04b-log-activity-dialog", "Log Activity dialog - type selector");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // ──── 5. TRAVEL MANAGEMENT ────
  console.log("\n=== 5. TRAVEL MANAGEMENT ===");
  await page.goto(`${BASE}/travel`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  await snap("05a-travel-plans", "Travel Management - Travel Plans tab");

  // Travel Reporting tab
  const travelReportTab = page.locator('[role="tab"]:has-text("Travel Reporting"), button:has-text("Travel Reporting")');
  if (await travelReportTab.isVisible()) {
    await travelReportTab.click();
    await page.waitForTimeout(1000);
    await snap("05b-travel-reporting", "Travel Management - Travel Reporting tab");
  }

  // Open Create Travel Plan dialog
  const travelPlansTab = page.locator('[role="tab"]:has-text("Travel Plans"), button:has-text("Travel Plans")');
  if (await travelPlansTab.isVisible()) {
    await travelPlansTab.click();
    await page.waitForTimeout(500);
  }
  const createTravelBtn = page.locator('button:has-text("Create Travel Plan")');
  if (await createTravelBtn.isVisible()) {
    await createTravelBtn.click();
    await page.waitForTimeout(800);
    await snap("05c-create-travel-dialog", "Create Travel Plan dialog");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // ──── 6. KPI MANAGEMENT (covered in institution KPIs tab) ────

  // ──── 7. REPORTING ENGINE ────
  console.log("\n=== 7. REPORTING ENGINE ===");
  await page.goto(`${BASE}/reports`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  await snap("07a-reports-list", "Reports page with Monthly/Weekly/QBR tabs");

  // Weekly Activities tab
  const weeklyTab = page.locator('[role="tab"]:has-text("Weekly Activities"), button:has-text("Weekly Activities")');
  if (await weeklyTab.isVisible()) {
    await weeklyTab.click();
    await page.waitForTimeout(1000);
    await snap("07b-weekly-activities", "Weekly Activities tab");
  }

  // QBR page
  await page.goto(`${BASE}/reports/qbr`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  await snap("07c-qbr-page", "Quarterly Business Reviews page");

  // Open Generate QBR dialog
  const genQbrBtn = page.locator('button:has-text("Generate QBR")');
  if (await genQbrBtn.isVisible()) {
    await genQbrBtn.click();
    await page.waitForTimeout(800);
    await snap("07d-generate-qbr-dialog", "Generate QBR dialog");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // Report detail with all sections
  await page.goto(`${BASE}/reports`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1000);
  const monthlyTab = page.locator('[role="tab"]:has-text("Monthly Reports"), button:has-text("Monthly Reports")');
  if (await monthlyTab.isVisible()) {
    await monthlyTab.click();
    await page.waitForTimeout(1000);
  }
  const viewLink = page.locator('a:has-text("View"), button:has-text("View")').first();
  if (await viewLink.isVisible()) {
    await viewLink.click();
    await page.waitForTimeout(2000);
    await snap("07e-report-detail", "Monthly Report detail with all sections");
  }

  // ──── 8. TASKS & ACCOUNTABILITY ────
  console.log("\n=== 8. TASKS & ACCOUNTABILITY ===");
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  await snap("08a-tasks-page", "Tasks page with filters and activity-linked toggle");

  // Open Create Task dialog
  const createTaskBtn = page.locator('button:has-text("Create Task")');
  if (await createTaskBtn.isVisible()) {
    await createTaskBtn.click();
    await page.waitForTimeout(800);
    await snap("08b-create-task-dialog", "Create Task dialog");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // ──── 9. RISK & COMPLIANCE ────
  console.log("\n=== 9. RISK & COMPLIANCE ===");
  await page.goto(`${BASE}/risk-compliance`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  await snap("09a-risk-register", "Risk Register tab");

  // Compliance tab
  const compTab = page.locator('[role="tab"]:has-text("Compliance"), button:has-text("Compliance Tracker")');
  if (await compTab.isVisible()) {
    await compTab.click();
    await page.waitForTimeout(1000);
    await snap("09b-compliance-tracker", "Compliance Tracker tab");
  }

  // Open Add Risk dialog
  const riskTab = page.locator('[role="tab"]:has-text("Risk Register"), button:has-text("Risk Register")');
  if (await riskTab.isVisible()) {
    await riskTab.click();
    await page.waitForTimeout(500);
  }
  const addRiskBtn = page.locator('button:has-text("Add Risk")');
  if (await addRiskBtn.isVisible()) {
    await addRiskBtn.click();
    await page.waitForTimeout(800);
    await snap("09c-add-risk-dialog", "Add Risk dialog (likelihood, impact, mitigation)");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // ──── 10. HR MODULE ────
  console.log("\n=== 10. HR MODULE ===");
  await page.goto(`${BASE}/hr`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  await snapViewport("10a-hr-overview", "HR & ERP overview with charts");

  // Succession Planning tab
  const succTab = page.locator('[role="tab"]:has-text("Succession Planning"), button:has-text("Succession Planning")');
  if (await succTab.isVisible()) {
    await succTab.click();
    await page.waitForTimeout(1000);
    await snap("10b-succession-planning", "Succession Planning tab");
  }

  // Performance Reviews tab
  const prTab = page.locator('[role="tab"]:has-text("Performance Reviews"), button:has-text("Performance Reviews")');
  if (await prTab.isVisible()) {
    await prTab.click();
    await page.waitForTimeout(1000);
    await snap("10c-performance-reviews", "Performance Reviews tab");
  }

  // Employee detail
  await page.goto(`${BASE}/hr`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1000);
  const empTab = page.locator('[role="tab"]:has-text("Employees"), button:has-text("Employees")');
  if (await empTab.isVisible()) {
    await empTab.click();
    await page.waitForTimeout(1000);
  }
  const empLink = page.locator('a[href*="/hr/employees/"]').first();
  if (await empLink.isVisible()) {
    await empLink.click();
    await page.waitForTimeout(2000);
    await snap("10d-employee-detail", "Employee detail page");
  }

  // ──── 11. KNOWLEDGE MANAGEMENT ────
  console.log("\n=== 11. KNOWLEDGE MANAGEMENT ===");
  await page.goto(`${BASE}/knowledge`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  await snapViewport("11a-knowledge-general", "Knowledge Base - General KB tab");

  // Institution KB tab
  const instKbTab = page.locator('[role="tab"]:has-text("Institution KB"), button:has-text("Institution KB")');
  if (await instKbTab.isVisible()) {
    await instKbTab.click();
    await page.waitForTimeout(1000);
    await snap("11b-knowledge-institution", "Knowledge Base - Institution KB tab");
  }

  // Market KB tab
  const mktKbTab = page.locator('[role="tab"]:has-text("Market KB"), button:has-text("Market KB")');
  if (await mktKbTab.isVisible()) {
    await mktKbTab.click();
    await page.waitForTimeout(1000);
    await snap("11c-knowledge-market", "Knowledge Base - Market KB tab");
  }

  // Proposal Library tab
  const propTab = page.locator('[role="tab"]:has-text("Proposal Library"), button:has-text("Proposal Library")');
  if (await propTab.isVisible()) {
    await propTab.click();
    await page.waitForTimeout(1000);
    await snap("11d-knowledge-proposals", "Knowledge Base - Proposal Library tab");
  }

  // ──── 12. EXECUTIVE COMMAND CENTRE ────
  console.log("\n=== 12. EXECUTIVE COMMAND CENTRE ===");
  await page.goto(`${BASE}/analytics`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(2500);
  await snapViewport("12a-analytics-top", "Analytics - Lead trends & Enrollment funnel");

  // Scroll to executive widgets
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  await snapViewport("12b-executive-widgets", "Executive Command Centre - all 5 widgets");

  // Dashboard page
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(2000);
  await snapViewport("12c-dashboard", "Main Dashboard (Executive view)");

  // ──── SIDEBAR ────
  console.log("\n=== SIDEBAR ===");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  // Capture just the sidebar area
  const sidebar = page.locator('aside').first();
  if (await sidebar.isVisible()) {
    await sidebar.screenshot({ path: join(DIR, "00-sidebar.png") });
    console.log("  [00-sidebar] Sidebar with all nav items");
  }

  await browser.close();
  console.log("\nDone! All RFP screenshots saved to ./screenshots/rfp-report/");
}

main().catch(console.error);
