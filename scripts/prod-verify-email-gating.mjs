/**
 * Verifies the email gating on production, through the real login path.
 *
 *   node --import tsx scripts/prod-verify-email-gating.mjs \
 *     <icrEmail> <icrPw> <icrSecret> <rmEmail> <rmPw> <rmSecret> <reportId>
 *
 * Run LOCALLY against the live URL — Playwright is not on the VPS.
 *
 * DELIBERATELY DOES NOT SEND. Brevo is live on production, so completing a
 * whole-report send would put real mail on a real domain's sending reputation,
 * addressed to somebody. The thing this change actually altered is the gate, and
 * the gate is fully observable without sending: the ICR is refused at the API,
 * and the manager's controls are present. The PDF build behind the manager's
 * button is untouched code that was already running in production before this
 * deploy.
 */
import { chromium } from "playwright";
const { totpGenerate } = await import("../lib/totp.ts");

const [icrEmail, icrPw, icrSecret, rmEmail, rmPw, rmSecret, reportId] = process.argv.slice(2);
const BASE = "https://illumestudentservices.cloud";

let pass = 0, fail = 0;
const check = (cond, label, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  → " + detail : ""}`); }
};

async function signIn(page, email, password, secret) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 }
  );
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
}

const browser = await chromium.launch();

try {
  // ── The rep ─────────────────────────────────────────────────────────────
  const icrCtx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const icrPage = await icrCtx.newPage();
  await signIn(icrPage, icrEmail, icrPw, icrSecret);
  check(true, "ICR signed in to production (MFA challenged, not bypassed)");

  await icrPage.goto(`${BASE}/reports/${reportId}`, { waitUntil: "networkidle", timeout: 45000 });
  const icrBody = await icrPage.locator("body").innerText();
  check(/Verification College/i.test(icrBody), "the ICR can open their own report",
    icrBody.slice(0, 90).replace(/\n/g, " "));

  const icrButtons = await icrPage.getByRole("button", { name: /email/i }).count();
  check(icrButtons === 0,
    "*** no email control is rendered for the ICR ***", `${icrButtons} found`);
  check(!/Email Report/i.test(icrBody), "*** the 'Email Report' button is gone ***");
  check(/Key Performance Indicators|Leads Collected|deploy verification/i.test(icrBody),
    "the rest of the report is untouched");

  // The API, not just the screen — hiding a button is not a permission.
  const icrApi = await icrPage.evaluate(async (id) => {
    const r = await fetch("/api/email/send-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: id, to: "blocked@example.com" }),
    });
    return { status: r.status, body: (await r.text()).slice(0, 160) };
  }, reportId);
  check(icrApi.status === 403,
    "*** POST /api/email/send-report is refused for an ICR on production ***",
    `status ${icrApi.status} ${icrApi.body}`);
  check(/not permitted to email/i.test(icrApi.body),
    "and refused on the capability, with a reason", icrApi.body.slice(0, 90));

  const icrSection = await icrPage.evaluate(async () => {
    const r = await fetch("/api/email/send-section", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "blocked@example.com", subject: "x", sectionTitle: "x", sectionHtml: "<p>x</p>" }),
    });
    return r.status;
  });
  check(icrSection === 403 && icrApi.status === icrSection,
    "*** both send routes now answer identically ***",
    `report=${icrApi.status} section=${icrSection}`);

  // ── The manager ─────────────────────────────────────────────────────────
  const rmCtx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const rmPage = await rmCtx.newPage();
  await signIn(rmPage, rmEmail, rmPw, rmSecret);
  check(true, "Regional Manager signed in to production");

  await rmPage.goto(`${BASE}/reports/${reportId}`, { waitUntil: "networkidle", timeout: 45000 });
  const rmBody = await rmPage.locator("body").innerText();
  const rmButtons = await rmPage.getByRole("button", { name: /email/i }).count();
  check(rmButtons > 0, "*** the manager still has the email controls ***", `${rmButtons} found`);
  check(/Email Report/i.test(rmBody), "including the whole-report button");

  await rmPage.getByRole("button", { name: /Email Report/i }).first().click();
  await rmPage.waitForTimeout(800);
  const dialog = await rmPage.locator("[role=dialog]").innerText().catch(() => "");
  check(dialog.length > 0, "and the compose dialog opens", dialog.slice(0, 80).replace(/\n/g, " "));
  console.log("  --   not pressing send: Brevo is live here and this would put real mail on a real domain");
} catch (e) {
  check(false, "verification run completed", String(e.message).slice(0, 200));
} finally {
  await browser.close();
}

console.log(`\nPROD VERIFY: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
