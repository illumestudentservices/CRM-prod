/**
 * The three fixes that came out of the live pipeline walkthrough.
 *
 *   npx tsx --env-file=.env scripts/qa-lead-form-fixes.mjs
 *
 * 1. The New Lead gate hard-requires Intended Destination and Source, and the
 *    form gave no sign of either. Both now say so.
 * 2. The Source field was hidden entirely when no sources existed, so the
 *    requirement was invisible AND impossible to satisfy.
 * 3. Relative timestamps ("3 minutes ago") are computed from the clock, so the
 *    server and the browser disagreed and React logged hydration error #418 on
 *    every visit to a student page.
 */
import { chromium } from "playwright";
import {
  BASE, db, createAndLogin, destroyUser,
  startSection, ok, fail, expect, summary,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
let browser, ctx, leadId;

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  const page = await bctx.newPage();

  // React downgrades hydration mismatches to a console error in dev rather than
  // the minified #418 seen in production, so both are collected.
  const hydrationErrors = [];
  page.on("pageerror", (e) => {
    if (/hydrat|#418|#423|#425/i.test(String(e))) hydrationErrors.push(String(e));
  });
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat|did not match|#418/i.test(m.text())) {
      hydrationErrors.push(m.text());
    }
  });

  // ── 1 + 2: the create form tells you what the gate will want ─────────────
  startSection("the form no longer hides what the gate requires");

  await page.goto(`${BROWSER_BASE}/students`, { waitUntil: "networkidle", timeout: 60000 });
  await page.getByRole("button", { name: /add student|new student|add lead/i }).first().click();
  await page.waitForTimeout(2000);

  const dialog = page.locator('[role="dialog"]').first();
  const text = await dialog.innerText();

  const hints = (text.match(/Needed before this student can move past New Lead/g) ?? []).length;
  expect(
    hints >= 2,
    "both gate-only fields carry the warning",
    `found ${hints} — Intended Destination and Source should each have one`
  );

  const destIdx = text.indexOf("Intended Destination");
  expect(
    destIdx >= 0 && /Needed before this student/.test(text.slice(destIdx, destIdx + 160)),
    "Intended Destination says it is needed to progress",
    "this is the field that silently stranded a student at New Lead on production"
  );

  // Anchored on the section heading, and matched case-insensitively: the
  // heading is uppercased in CSS and `innerText` returns the TRANSFORMED text,
  // so searching for "Assignment & Source" finds nothing at all.
  //
  // The warning also lands far below the field in the text — the dropdown
  // renders every source option inline between the two — so this looks at the
  // whole remainder rather than a fixed window.
  const srcIdx = text.search(/assignment & source/i);
  expect(
    srcIdx >= 0 && /Needed before this student/.test(text.slice(srcIdx)),
    "Source says it is needed to progress",
    "no warning anywhere under the Assignment & Source section"
  );

  // The Source field must be present whether or not any sources exist.
  expect(text.includes("Source"), "the Source field is on the form");

  const sourceCount = await db.recruitmentPartner.count({ where: { deletedAt: null, isActive: true } });
  ok(`(this database has ${sourceCount} sources, so the dropdown renders)`);

  // ── 3: no hydration error on a student page with fresh activity ──────────
  startSection("no hydration error on a student page");

  const anyLead = await db.lead.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (!anyLead) {
    fail("no lead to open", "seed the mirror first");
  } else {
    leadId = anyLead.id;
    // A just-created activity is what triggers it: "less than a minute ago" on
    // the server becomes "1 minute ago" in the browser a moment later.
    await db.leadActivity.create({
      data: {
        leadId: anyLead.id,
        userId: ctx.user.id,
        type: "NOTE",
        description: "QA hydration probe",
      },
    }).catch(() => null);

    hydrationErrors.length = 0;
    await page.goto(`${BROWSER_BASE}/students/${anyLead.id}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(5000);

    const body = await page.locator("body").innerText();
    expect(/ago|—/.test(body), "the History panel rendered timestamps");
    expect(
      hydrationErrors.length === 0,
      "no hydration mismatch on the student page",
      hydrationErrors.slice(0, 3).join(" | ")
    );

    await db.leadActivity.deleteMany({
      where: { leadId: anyLead.id, description: "QA hydration probe" },
    });
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
