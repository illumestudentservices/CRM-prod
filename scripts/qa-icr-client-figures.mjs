/**
 * Verifies ICR sees the Clients list + a client's details/contacts, but NOT the
 * figures (summary cards, per-client lead/status/health counts, figure tabs).
 * A manager (REGIONAL_MANAGER) still sees everything.
 *
 *   npx tsx --env-file=.env.local scripts/qa-icr-client-figures.mjs
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const B = BASE.replace("127.0.0.1", "localhost");
let browser, icr, rm, inst;

async function ctxFor(login) {
  const bctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  await bctx.addCookies([...login.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  return bctx;
}
async function page(ctx, path) {
  const p = await ctx.newPage();
  await p.goto(`${B}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  return p;
}

try {
  inst = await db.institution.findFirst({ where: { deletedAt: null }, select: { id: true, name: true } });
  if (!inst) throw new Error("no institution in test DB");
  browser = await chromium.launch();

  icr = await createAndLogin({ role: "ICR", withEmployee: true });
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  const icrCtx = await ctxFor(icr);
  const rmCtx = await ctxFor(rm);

  // ── ICR: list has no figures ────────────────────────────────────────
  startSection("ICR — Clients list hides figures");
  let p = await page(icrCtx, "/institutions");
  expect((await p.getByText("Total Clients").count()) === 0, "no summary stat cards");
  expect((await p.locator('[data-testid="health-summary"]').count()) === 0, "no health summary strip");
  expect((await p.locator('[data-testid="health-sentiment"]').count()) === 0, "no per-client health pills");
  expect((await p.locator('[data-testid="client-attention"]').count()) === 0, "no per-client attention/issue pills");
  expect((await p.getByText(inst.name, { exact: false }).count()) >= 1, "ICR still sees the client names");
  await p.close();

  // ── ICR: detail hides figure tabs, keeps people/files ───────────────
  startSection("ICR — client detail hides figure tabs");
  p = await page(icrCtx, `/institutions/${inst.id}`);
  for (const t of ["Governance", "Overview", "KPIs", "Issues"]) {
    expect((await p.getByRole("tab", { name: t }).count()) === 0, `no '${t}' tab`);
  }
  expect((await p.getByRole("tab", { name: /^Contracts/ }).count()) === 0, "no Contracts tab");
  expect((await p.getByRole("tab", { name: "Documents" }).count()) === 0, "no Documents tab");
  expect((await p.getByRole("tab", { name: "Team" }).count()) >= 1, "Team tab present");
  expect((await p.getByRole("tab", { name: /^Contacts/ }).count()) >= 1, "Contacts tab present");
  await p.close();

  // ── REGIONAL_MANAGER control: figures shown ─────────────────────────
  startSection("REGIONAL_MANAGER — figures still shown");
  p = await page(rmCtx, "/institutions");
  expect((await p.getByText("Total Clients").count()) >= 1, "RM sees summary stat cards");
  await p.close();
  p = await page(rmCtx, `/institutions/${inst.id}`);
  expect((await p.getByRole("tab", { name: "Governance" }).count()) >= 1, "RM sees the Governance tab");
  await p.close();
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
