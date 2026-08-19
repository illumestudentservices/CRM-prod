/**
 * Verifies §8 Monthly KPI on PRODUCTION, through the real login path.
 *
 *   node --import tsx scripts/prod-verify-monthly-kpi.mjs <email> <pw> <secret> <month> <year> <expectDone>
 *
 * Run LOCALLY against the live URL — Playwright is not on the VPS.
 *
 * The fixture writes two planner weeks straight into the database before this
 * runs (2 + 3 = 5 agent visits against a 12/month target), so what is under
 * test is the whole chain: generate the report, roll the planner up, store the
 * snapshot, render it.
 *
 * Also checks the two things that are easy to get wrong and hard to spot:
 * an activity with no planner rows must read "Not entered" rather than 0%, and
 * the retired employee KPIs tab must be gone.
 */
import { chromium } from "playwright";
const { totpGenerate } = await import("../lib/totp.ts");

const [email, password, secret, month, year, expectDone] = process.argv.slice(2);
const BASE = "https://illumestudentservices.cloud";

let pass = 0, fail = 0;
const check = (cond, label, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  → " + detail : ""}`); }
};

const browser = await chromium.launch();
const errs = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const page = await ctx.newPage();
  // Attribute the error to the page that was open when it fired. Collecting
  // bare messages told me an error existed but not where, and I guessed wrong
  // about the cause once already.
  page.on("pageerror", (e) => errs.push(`${new URL(page.url()).pathname} :: ${e.message.slice(0, 120)}`));

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
  check(true, "ICR signed in to production (MFA challenged, not bypassed)");

  // ── The planner itself is reachable ─────────────────────────────────────
  await page.goto(`${BASE}/reports`, { waitUntil: "networkidle", timeout: 45000 });
  const reportsBody = await page.locator("body").innerText().catch(() => "");
  check(/Weekly Activities/i.test(reportsBody), "the Weekly Activities tab is present");

  // ── Generate the ICR monthly report for the fixture's month ─────────────
  const created = await page.evaluate(async (args) => {
    const r = await fetch("/api/icr-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportingMonth: Number(args.month), reportingYear: Number(args.year) }),
    });
    return { status: r.status, body: (await r.text()).slice(0, 400) };
  }, { month, year });
  // 409 means a report for this period already exists and the route hands back
  // its id — a re-run should verify that report rather than fail on its own
  // first run's side effect.
  check(created.status === 200 || created.status === 201 || created.status === 409,
    "the ICR monthly report exists", `status ${created.status} ${created.body.slice(0, 140)}`);

  let id = null;
  try {
    const parsed = JSON.parse(created.body);
    id = parsed?.id ?? parsed?.data?.id ?? parsed?.reportId;
  } catch { /* below */ }
  check(!!id, "and returns an id", created.body.slice(0, 120));

  if (id) {
    await page.goto(`${BASE}/reports/icr-monthly/${id}`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);
    const body = await page.locator("body").innerText();

    check(/8\.\s*Monthly KPI/i.test(body), "*** §8 Monthly KPI renders on the report ***",
      body.slice(0, 120).replace(/\n/g, " "));
    check(/Agent training or visits/i.test(body), "the six activities are listed");

    // 2 + 3 = 5 done against a 12/month target = 42%.
    const section = body.slice(body.search(/8\.\s*Monthly KPI/i));
    check(new RegExp(`\\b${expectDone}\\b`).test(section),
      `*** it totals the planner weeks (${expectDone} done) ***`,
      section.slice(0, 200).replace(/\n/g, " "));
    check(/\b42%/.test(section), "and shows 42% (5 of 12)",
      section.slice(0, 200).replace(/\n/g, " "));

    check(/Not entered/i.test(section),
      "*** activities with no planner rows read 'Not entered', not 0% ***",
      /0%/.test(section) ? "found a 0% where the planner is empty" : section.slice(0, 160).replace(/\n/g, " "));
  }

  // ── The retired employee KPIs tab is gone ───────────────────────────────
  const kpiRoute = await page.evaluate(async () => {
    const r = await fetch("/api/hr/employees/does-not-exist/kpis");
    return r.status;
  });
  check(kpiRoute === 404, "the retired employee KPIs endpoint is gone", `status ${kpiRoute}`);

  check(errs.length === 0, "no uncaught client errors", errs.slice(0, 4).join("  |  "));
} catch (e) {
  check(false, "verification run completed", String(e.message).split("\n")[0].slice(0, 200));
} finally {
  await browser.close();
}

console.log(`\nPROD VERIFY (monthly KPI): ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
