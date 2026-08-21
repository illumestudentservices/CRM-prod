/**
 * Screenshots the reworked Clients page, light and dark, list and record.
 *
 *   node --import tsx --env-file=.env.local scripts/shot-clients.mjs
 *
 * Exists because the changes to this page are almost entirely visual — logos on
 * a white tile, a happiness strip, region lines, an account note that had never
 * been rendered anywhere — and a typecheck says nothing about whether any of
 * that actually looks right. The disposable account is created with the least
 * privilege that can open the page, enrols MFA properly rather than bypassing
 * it, and is deleted in the finally block.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import {
  db, createAndLogin, destroyUser, BASE, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");
const OUT = "screenshots/clients";
mkdirSync(OUT, { recursive: true });

async function signIn(page, acct, secret) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
}

/** Flips the theme through the app's own control rather than forcing a class. */
async function setDark(page, dark) {
  await page.evaluate((d) => {
    localStorage.setItem("theme", d ? "dark" : "light");
    document.documentElement.classList.toggle("dark", d);
  }, dark);
  await page.waitForTimeout(400);
}

// A client that has everything worth looking at: a note, a non-grey rating and
// more than one region. Picked from the data rather than hardcoded so this keeps
// working as the fixtures change.
const subject =
  (await db.institution.findFirst({
    where: { deletedAt: null, NOT: [{ notes: null }, { accountHealth: "GREY" }] },
    select: { id: true, name: true },
  })) ??
  (await db.institution.findFirst({ where: { deletedAt: null }, select: { id: true, name: true } }));
if (!subject) throw new Error("no institutions to screenshot");
console.log(`subject: ${subject.name}`);

const acct = await createAndLogin({ role: "HQ_EXECUTIVE" });
const secret = (await db.user.findUnique({
  where: { id: acct.user.id }, select: { twoFactorSecret: true },
})).twoFactorSecret;

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await signIn(page, acct, secret);

  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    await page.goto(`${BASE}/institutions`, { waitUntil: "networkidle", timeout: 60000 });
    await setDark(page, dark);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/list-${mode}.png`, fullPage: true });
    console.log(`  wrote ${OUT}/list-${mode}.png`);

    // One card, close up — this is where the logo tile and the happiness pill
    // either work or do not. Located by the client's name rather than by
    // position: the stat cards above are also `.cursor-pointer`, so an
    // index-based selector screenshots "Total Clients" and looks like a pass.
    const card = page.locator("div.cursor-pointer").filter({ hasText: subject.name }).last();
    if (await card.count()) {
      await card.screenshot({ path: `${OUT}/card-${mode}.png` }).catch(() => {});
      console.log(`  wrote ${OUT}/card-${mode}.png`);
    }

    // …and the client record, for the crest in the header and the account note.
    await page.goto(`${BASE}/institutions/${subject.id}`, { waitUntil: "networkidle", timeout: 60000 });
    await setDark(page, dark);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/record-${mode}.png` });
    console.log(`  wrote ${OUT}/record-${mode}.png`);
  }

  const real = errors.filter((e) => !/favicon|React DevTools|hydrat/i.test(e));
  console.log(real.length ? `CONSOLE ERRORS:\n  ${real.slice(0, 5).join("\n  ")}` : "no console errors");
} finally {
  await browser.close();
  await destroyUser(acct);
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  console.log(`disposable users left behind: ${left}`);
  await db.$disconnect();
}
process.exit(0);
