/**
 * Confirms the stage requirement checklist is really live on PRODUCTION.
 *
 * Runs on a WORKSTATION against the public URL, with an account made and
 * unmade on the VPS by `prod-fixture.mjs`. It cannot use `qa-lib`'s
 * `createAndLogin`: that creates the user in whatever DATABASE_URL points at
 * — the mirror — and then authenticates against production, which fails at
 * "2fa verify 401" and reads as a broken deployment.
 *
 *   PROD_EMAIL=… PROD_PASSWORD=… PROD_TOTP=… \
 *     npx tsx scripts/prod-verify-stage-requirements.mjs
 *
 * READ-ONLY. It opens dialogs and closes them; it saves nothing. The only
 * footprint is the sign-in, which lands in audit_logs by design — check `who`
 * on any new rows before calling them residue.
 */
import { chromium } from "playwright";
import { generate as totpGenerate } from "otplib";

const BASE = process.env.PROD_BASE ?? "https://illumestudentservices.cloud";
const EMAIL = process.env.PROD_EMAIL;
const PASSWORD = process.env.PROD_PASSWORD;
const TOTP = process.env.PROD_TOTP;

if (!EMAIL || !PASSWORD || !TOTP) {
  console.error("PROD_EMAIL, PROD_PASSWORD and PROD_TOTP are all required.");
  process.exit(2);
}

let pass = 0, fail = 0;
const check = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1300 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  console.log(`\nSigning in to ${BASE}`);
  // `networkidle`, plus a pause, because the form is a React island: filling
  // before it hydrates puts text in the DOM that never reaches component
  // state, so Sign in posts empty credentials and the page simply sits there.
  // With `domcontentloaded` this failed on a login that works by hand.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();

  // POLL the URL; do not use `waitForURL`.
  //
  // These are client-side navigations, so no `load` event fires after the
  // first page — and `waitForURL` waits for BOTH the url and its waitUntil
  // state. It therefore times out on a sign-in that plainly worked, which is
  // exactly how a healthy deployment gets reported as broken.
  const until = async (predicate, ms, what) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (predicate(page.url())) return true;
      await page.waitForTimeout(500);
    }
    throw new Error(`timed out waiting for ${what} (still at ${page.url()})`);
  };

  await until((u) => !/\/login/.test(u), 90_000, "the password step to clear");

  if (/verify-2fa/.test(page.url())) {
    const code = await totpGenerate({ secret: TOTP });
    const boxes = page.locator('input[inputmode="numeric"], input[type="text"], input[type="tel"]');
    const n = await boxes.count();
    if (n >= 6) {
      for (let i = 0; i < 6; i++) await boxes.nth(i).fill(code[i]);
    } else {
      await boxes.first().fill(code);
    }
    const submit = page.locator('button[type="submit"]').first();
    if (await submit.isEnabled()) await submit.click();
    // The MfaUnlockOverlay animation runs ~10s between submit and dashboard.
    await until((u) => !/verify-2fa/.test(u), 90_000, "the 2FA step to clear");
  }
  check("signed in", !/login|verify-2fa/.test(page.url()), page.url());

  // Match a UUID, NOT merely `/students/`.
  //
  // `a[href^="/students/"]` also matches /students/offline and /students/new,
  // and the first link on the page was one of those — so this reported the
  // requirement card missing from a page that never had one. Fourth time a
  // loose selector in this project has read as an absent feature.
  await page.goto(`${BASE}/students`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const hrefs = await page
    .locator('a[href^="/students/"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const href = hrefs.find((h) => /^\/students\/[0-9a-f-]{36}$/i.test(h ?? ""));
  check("found a student to open", !!href, `links seen: ${JSON.stringify(hrefs.slice(0, 5))}`);

  if (href) {
    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);
    const body = await page.locator("body").innerText();

    const ready = /Everything .+ needs is done/i.test(body);
    check(
      "the requirement card is on the page",
      /To move to /i.test(body) || ready,
      body.slice(0, 200)
    );

    if (!ready) {
      check("it shows progress, not only failures", /\d+ of \d+ done/.test(body));

      // The headline change: outstanding rules are buttons carrying a
      // destination, not bullets.
      const actionable = await page
        .locator('button:has-text("Open"), button:has-text("Log it"), button:has-text("Book it"), button:has-text("Add interest")')
        .count();
      check("outstanding rules are clickable", actionable > 0, `${actionable} found`);

      // Click one and confirm something actually opened.
      const first = page
        .locator("button")
        .filter({ hasText: /Open\s*$|Log it|Book it|Add interest/ })
        .first();
      if (await first.count()) {
        await first.click();
        await page.waitForTimeout(2500);
        const opened =
          (await page.locator('[role="dialog"]').count()) > 0 ||
          (await page.getByRole("button", { name: /^Cancel$/ }).count()) > 0;
        check("clicking one opens its editor", opened);
        await page.keyboard.press("Escape");
      }
    } else {
      check("it offers the move when nothing is outstanding",
        (await page.locator('button:has-text("Move to")').count()) > 0);
    }

    // React #418 was fixed on this page in PR #111; a regression here would
    // show up as a hydration error rather than a visible fault.
    const hydration = pageErrors.filter((e) => /418|hydrat/i.test(e));
    check("no hydration errors on the student page", hydration.length === 0,
      hydration.slice(0, 1).join(""));
  }

  const real = pageErrors.filter((e) => !/ResizeObserver/i.test(e));
  check("no uncaught client errors", real.length === 0, real.slice(0, 2).join(" | "));
} catch (e) {
  fail++;
  console.log(`  FAIL suite threw — ${e.message}`);
} finally {
  await browser.close().catch(() => {});
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
