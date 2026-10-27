/**
 * Verifies read-only roles (ICR) no longer see the Add/Edit client controls on
 * the Clients (institutions) pages, while a write role (REGIONAL_MANAGER) does.
 * Also confirms the API already refuses an ICR write (defense in depth).
 *
 *   npx tsx --env-file=.env.local scripts/qa-icr-institution-edit.mjs
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
let browser, icr, rm, inst;

async function ctxPage(login) {
  const bctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await bctx.addCookies(
    [...login.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  return { ctx: bctx, page: await bctx.newPage() };
}
async function visit(page, path) {
  await page.goto(`${BROWSER_BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
}
const addBtns = (page) => page.getByRole("button", { name: "Add Institution" }).count();
const editBtns = (page) => page.getByRole("button", { name: "Edit" }).count();

try {
  inst = await db.institution.findFirst({ where: { deletedAt: null }, select: { id: true, name: true } });
  if (!inst) throw new Error("no institution in test DB to open");

  browser = await chromium.launch();

  // ── ICR: controls hidden ────────────────────────────────────────────
  icr = await createAndLogin({ role: "ICR", withEmployee: true });
  const icrP = await ctxPage(icr);
  startSection("ICR — Add/Edit client controls are hidden");
  await visit(icrP.page, "/institutions");
  expect((await addBtns(icrP.page)) === 0, "ICR does NOT see 'Add Institution' on the list");
  await visit(icrP.page, `/institutions/${inst.id}`);
  expect((await editBtns(icrP.page)) === 0, "ICR does NOT see any 'Edit' control on a client");

  // API still refuses the write regardless of UI (defense in depth).
  const patch = await icrP.ctx.request.patch(`${BROWSER_BASE}/api/institutions/${inst.id}`, {
    data: { name: `${inst.name}` }, headers: { "Content-Type": "application/json" }, maxRedirects: 0,
  });
  expect(patch.status() === 403, `ICR PATCH institution is refused (${patch.status()})`, String(patch.status()));

  // ── REGIONAL_MANAGER: controls present (write role) ─────────────────
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  const rmP = await ctxPage(rm);
  startSection("REGIONAL_MANAGER — Add/Edit client controls still present");
  await visit(rmP.page, "/institutions");
  expect((await addBtns(rmP.page)) >= 1, "RM sees 'Add Institution' on the list");
  await visit(rmP.page, `/institutions/${inst.id}`);
  expect((await editBtns(rmP.page)) >= 1, "RM sees the 'Edit' control on a client");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (icr) await destroyUser(icr);
  if (rm) await destroyUser(rm);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
