/**
 * Proves the ICR Monthly Report is reachable and usable by a real person on
 * production, through the real login path including MFA.
 *
 *   node --import tsx scripts/prod-verify-icr-report.mjs <email> <password> <totpSecret>
 *
 * Runs LOCALLY against the live URL because Playwright is not installed on the
 * VPS. Deliberately minimal in what it writes: it creates one report for the
 * disposable account and nothing else — no leads, no institutions, no events.
 * Production has no pipeline for this account, so the figures will all be zero;
 * that the arithmetic is right was proven on the mirror. What is being checked
 * here is that the page, the API and the migration agree on a live box.
 *
 * The report it creates is removed by the account teardown, which now knows
 * about icr_monthly_reports.
 */
import { chromium } from "playwright";
const { totpGenerate } = await import("../lib/totp.ts");

const [email, password, secret] = process.argv.slice(2);
const BASE = "https://illumestudentservices.cloud";

let pass = 0, fail = 0;
const check = (cond, label, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  → " + detail : ""}`); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|DevTools/i.test(m.text())) errs.push(m.text());
});

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 }
  );
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  check(true, "password step accepted, MFA challenged (not bypassed)");

  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
  check(true, "MFA accepted, signed in to production");

  // How a rep would actually find it.
  await page.goto(`${BASE}/reports`, { waitUntil: "networkidle", timeout: 45000 });
  const reportsBody = await page.locator("body").innerText();
  check(/ICR Monthly/i.test(reportsBody),
    "*** the Reports page links through to the rep-wise report ***",
    reportsBody.slice(0, 100).replace(/\n/g, " "));

  await page.goto(`${BASE}/reports/icr-monthly`, { waitUntil: "networkidle", timeout: 45000 });
  check(!/\/login/.test(new URL(page.url()).pathname), "not bounced back to login", page.url());
  const listBody = await page.locator("body").innerText();
  check(/ICR Monthly Reports/i.test(listBody), "*** the list page renders on production ***");
  check(/No monthly reports yet/i.test(listBody), "correct empty state");
  check(!/Application error|Internal Server Error/i.test(listBody),
    "no server error", listBody.slice(0, 100).replace(/\n/g, " "));

  // Generate one, which exercises the migration, the auto-fill and the page.
  await page.getByRole("button", { name: /New monthly report/i }).click();
  await page.getByRole("button", { name: /Generate from CRM/i }).click();
  await page.waitForURL(/\/reports\/icr-monthly\/[0-9a-f-]{10,}/, { timeout: 60000 });
  check(true, "*** a report generated against the live database ***");

  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  const body = await page.locator("body").innerText();

  const SECTIONS = [
    [/1\.\s*Executive Summary/i, "1. Executive Summary"],
    [/1\.1[\s\S]{0,4}Performance Overview/i, "1.1 Performance Overview"],
    [/1\.2[\s\S]{0,4}Application Pipeline Snapshot/i, "1.2 Pipeline Snapshot"],
    [/1\.3[\s\S]{0,4}Priority Applications/i, "1.3 Priority Applications"],
    [/1\.4[\s\S]{0,4}Key Highlights/i, "1.4 Key Highlights"],
    [/1\.5[\s\S]{0,4}Key Challenges/i, "1.5 Key Challenges"],
    [/2\.\s*Pipeline\s*&\s*Agent Activity/i, "2. Pipeline & Agent Activity"],
    [/2\.4[\s\S]{0,4}New Channel Development/i, "2.4 New Channel Development"],
    [/3\.\s*Events\s*&\s*Business Development/i, "3. Events & Business Development"],
    [/4\.\s*Market Update/i, "4. Market Update"],
    [/5\.\s*Top 3 Priorities/i, "5. Top 3 Priorities"],
    [/6\.\s*Support Requested/i, "6. Support Requested"],
    [/7\.\s*Snapshots/i, "7. Snapshots"],
  ];
  for (const [re, label] of SECTIONS) check(re.test(body), `renders ${label}`);

  check(/Not tracked in the CRM/i.test(body),
    "*** Visa Approvals is honest about being untracked ***");
  check(/Send to manager/i.test(body), "the submit action is offered to the rep");

  // §7 depends on the attachments API accepting the new parent type — the
  // 422 that was fixed in this change.
  const att = await page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    const r = await fetch(`/api/attachments?parentType=ICR_MONTHLY_REPORT&parentId=${id}`);
    return { status: r.status, body: (await r.text()).slice(0, 120) };
  });
  check(att.status === 200,
    "*** §7 Snapshots: the attachments API accepts ICR_MONTHLY_REPORT ***",
    `status ${att.status} ${att.body}`);

  check(errs.length === 0, "no uncaught client errors", errs.slice(0, 2).join(" | "));
} catch (e) {
  check(false, "verification run completed", String(e.message).slice(0, 200));
} finally {
  await browser.close();
}

console.log(`\nPROD VERIFY: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
