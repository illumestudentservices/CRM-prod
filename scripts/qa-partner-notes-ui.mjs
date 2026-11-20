/**
 * Browser check: the agent (partner) detail page shows a Notes section, and a
 * note typed in the box appears in the thread. Throwaway partner, cleaned up.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-partner-notes-ui.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const admin = await createAndLogin({ role: "SUPER_ADMIN" });
let browser, partner;
let fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

try {
  partner = await db.recruitmentPartner.create({
    data: { name: `QA UI Agent ${Date.now()}`, type: "AGENT", country: "India", createdById: admin.user.id },
  });

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()}`); });

  const resp = await page.goto(`${BROWSER_BASE}/recruitment-network/partners/${partner.id}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  ok("partner page loads, no error / 500", (!resp || resp.status() < 400) && errs.length === 0, [...new Set(errs)].join(" | "));
  ok("Notes section heading present", (await page.getByRole("heading", { name: /^Notes$/ }).count()) >= 1);
  ok("note textarea present", (await page.getByPlaceholder(/Add a note/i).count()) >= 1);
  ok("empty state shows 'No notes yet'", (await page.getByText(/No notes yet/i).count()) >= 1);

  // Add a note through the UI — wait for the actual POST to land, not a timer.
  const text = `UI note ${Date.now()}`;
  await page.getByPlaceholder(/Add a note/i).fill(text);
  const [postResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/notes") && r.request().method() === "POST", { timeout: 20000 }),
    page.getByRole("button", { name: /Add Note/i }).click(),
  ]);
  ok("note POST responded 201", postResp.status() === 201, `status ${postResp.status()}`);
  await page.waitForTimeout(400);
  ok("note appears in the thread after adding", (await page.getByText(text).count()) >= 1);

  // Persisted server-side?
  const saved = await db.partnerNote.count({ where: { partnerId: partner.id } });
  ok("note persisted to DB", saved === 1, `count ${saved}`);

  // Reload → still there.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  ok("note survives reload", (await page.getByText(text).count()) >= 1);
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (partner) {
    await db.partnerNote.deleteMany({ where: { partnerId: partner.id } }).catch(() => {});
    await db.recruitmentPartner.delete({ where: { id: partner.id } }).catch(() => {});
  }
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}
