/**
 * Attaching files to a knowledge base article WHILE CREATING IT.
 *
 *   npx tsx --env-file=.env scripts/qa-kb-create-attachments.mjs
 *
 * Distinct from qa-kb-attachments.mjs, which covers the API and who is allowed
 * to attach to what. This one is about the create form.
 *
 * WHAT WAS MISSING
 *
 * All four KB types could already hold attachments, but only after the fact:
 * you saved the article, found it again in the list, opened it, and added the
 * file there. The create form asked for Title, Category, Content and Tags and
 * nothing else — while the HR module's own KB form has had an Attachments field
 * all along. The two disagreed, and the longer route was the one most people
 * were on.
 *
 * WHAT THIS CHECKS
 *
 * Each of the four types gets an article created THROUGH THE FORM with a file
 * chosen before saving, and the attachment is then read back OUT OF THE
 * DATABASE rather than off the screen. A file input that appears to accept a
 * file and quietly drops it would sail through a screen-only check — and the
 * upload happens after the article POST returns, so it is exactly the kind of
 * step that can fail silently.
 */
import { chromium } from "playwright";
import {
  BASE, db, createAndLogin, destroyUser,
  startSection, expect, summary,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const stamp = Date.now().toString().slice(-6);
const titles = [];
let ctx, browser;

const TABS = [
  ["general", undefined],
  ["institution", /University College London/i],
  ["market", /India/i],
  ["proposal", undefined],
];

/** Picks an option from the tab's institution/market selector. */
async function chooseFromCombo(page, preferred) {
  const combo = page.locator('[role="combobox"]').first();
  if (!(await combo.count())) return null;
  await combo.click();
  await page.waitForTimeout(700);
  const opts = page.locator('[role="option"]');
  const texts = (await opts.allInnerTexts()).map((t) => t.trim());
  let idx = preferred ? texts.findIndex((t) => preferred.test(t)) : 0;
  if (idx < 0) idx = 0;
  await opts.nth(idx).click();
  await page.waitForTimeout(2000);
  return texts[idx];
}

function openCreateButton(page) {
  return page
    .getByRole("button", { name: /create article|add entry|add proposal section|new article/i })
    .first();
}

async function createWithFile(page, tab, title, preferred) {
  await page.getByRole("tab", { name: new RegExp(tab, "i") }).click();
  await page.waitForTimeout(1800);
  if (preferred !== undefined) await chooseFromCombo(page, preferred);

  const open = openCreateButton(page);
  await open.waitFor({ state: "visible", timeout: 10000 });
  await open.click();
  await page.waitForTimeout(1200);

  const dlg = page.locator('[role="dialog"]').first();
  await dlg.locator("#article-title").fill(title);
  await dlg.locator("#article-content").fill("Created by qa-kb-create-attachments.");

  // Category is a Radix select; whatever this tab offers first will do.
  await dlg.locator('[role="combobox"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(400);

  await dlg.locator("#article-files").setInputFiles({
    name: `kb-${stamp}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(`attachment for ${title}`),
  });
  await page.waitForTimeout(500);

  await dlg.getByRole("button", { name: /^(create|save|add)/i }).last().click();
  await page.waitForTimeout(3000);
}

/**
 * Polls for the attachment.
 *
 * The file is uploaded AFTER the article POST returns, so reading once races
 * the second request — the mistake that has produced false "it does not
 * persist" reports elsewhere in this suite.
 */
async function waitForArticle(title, timeoutMs = 25000) {
  const started = Date.now();
  let row = null;
  for (;;) {
    row = await db.knowledgeBase.findFirst({
      where: { title },
      select: { id: true, attachments: { select: { id: true, name: true } } },
    });
    if (row?.attachments.length || Date.now() - started > timeoutMs) return row;
    await new Promise((r) => setTimeout(r, 500));
  }
}

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1600, height: 1300 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );
  const page = await bctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));

  await page.goto(`${BROWSER_BASE}/knowledge`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  // ── 1. The field is on every tab's create form ───────────────────────────
  startSection("every KB type offers attachments while creating");

  for (const [tab, preferred] of TABS) {
    await page.getByRole("tab", { name: new RegExp(tab, "i") }).click();
    await page.waitForTimeout(1500);
    if (preferred !== undefined) await chooseFromCombo(page, preferred);

    const open = openCreateButton(page);
    expect(await open.count() > 0, `${tab}: the create button is there`);
    if (!(await open.count())) continue;

    await open.click();
    await page.waitForTimeout(1200);
    const dlg = page.locator('[role="dialog"]').first();
    expect(
      await dlg.locator("#article-files").count() === 1,
      `${tab}: the create form has an attachment field`,
      "you previously had to save, find the article again and reopen it to attach anything"
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }

  // ── 2. The file really reaches the database ──────────────────────────────
  startSection("a file chosen before saving is really attached");

  for (const [tab, preferred] of TABS) {
    const title = `ZZKB ${tab} ${stamp}`;
    titles.push(title);
    await createWithFile(page, tab, title, preferred);

    const row = await waitForArticle(title);
    expect(!!row, `${tab}: the article was created`);
    if (!row) continue;
    expect(
      row.attachments.length === 1,
      `${tab}: the file is attached to it`,
      `article exists with ${row.attachments.length} attachments — the form took a file and dropped it`
    );
    if (row.attachments.length) {
      expect(
        row.attachments[0].name === `kb-${stamp}.txt`,
        `${tab}: the attachment kept its filename`,
        `stored as ${row.attachments[0].name}`
      );
    }
  }

  startSection("no page errors");
  expect(errs.length === 0, "no client-side errors", errs.slice(0, 3).join(" | "));
} catch (e) {
  console.error("\nSCRIPT ERROR:", e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const title of titles) {
    const rows = await db.knowledgeBase
      .findMany({ where: { title }, select: { id: true } })
      .catch(() => []);
    for (const r of rows) {
      try { await db.knowledgeBaseAttachment.deleteMany({ where: { articleId: r.id } }); } catch { /* best effort */ }
      try { await db.knowledgeBase.delete({ where: { id: r.id } }); } catch { /* best effort */ }
    }
  }
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
  summary();
}
