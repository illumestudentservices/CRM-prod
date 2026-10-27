/**
 * Verifies field-operations activity visibility:
 *   - ICR sees ONLY the activities they logged (not another user's).
 *   - A supervisor (REGIONAL_MANAGER) sees everyone's.
 * Checks both the page and the /api/activities endpoint.
 *
 *   npx tsx --env-file=.env.local scripts/qa-field-ops-visibility.mjs
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const B = BASE.replace("127.0.0.1", "localhost");
let browser, icr, rm, aIcr, aRm;

async function ctxFor(login) {
  const bctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await bctx.addCookies([...login.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  return bctx;
}
async function pageHasText(ctx, path, text) {
  const page = await ctx.newPage();
  await page.goto(`${B}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  const n = await page.getByText(text, { exact: false }).count();
  await page.close();
  return n > 0;
}
async function apiIds(ctx) {
  const res = await ctx.request.get(`${B}/api/activities`, { maxRedirects: 0 });
  const body = await res.json().catch(() => ({}));
  return (body.data ?? []).map((a) => a.id);
}

try {
  browser = await chromium.launch();
  const region = await db.region.findFirst({ select: { id: true } });

  icr = await createAndLogin({ role: "ICR", withEmployee: true, extra: { regionId: region?.id ?? null } });
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: region?.id ?? null } });

  const titleIcr = `QA ICR Visit ${TAG}`;
  const titleRm = `QA RM Visit ${TAG}`;
  aIcr = await db.activity.create({ data: { type: "AGENT_MEETING", title: titleIcr, date: new Date(), status: "PLANNED", userId: icr.user.id } });
  aRm = await db.activity.create({ data: { type: "AGENT_MEETING", title: titleRm, date: new Date(), status: "PLANNED", userId: rm.user.id } });

  const icrCtx = await ctxFor(icr);
  const rmCtx = await ctxFor(rm);

  // ── ICR: own only ───────────────────────────────────────────────────
  startSection("ICR sees only their own field ops");
  expect(await pageHasText(icrCtx, "/field-operations", titleIcr), "ICR page shows their OWN activity");
  expect(!(await pageHasText(icrCtx, "/field-operations", titleRm)), "ICR page does NOT show another user's activity");
  const icrApi = await apiIds(icrCtx);
  expect(icrApi.includes(aIcr.id), "ICR API returns their own activity");
  expect(!icrApi.includes(aRm.id), "ICR API does NOT return another user's activity");

  // ── REGIONAL_MANAGER: everyone's ────────────────────────────────────
  startSection("REGIONAL_MANAGER sees everyone's field ops");
  expect(await pageHasText(rmCtx, "/field-operations", titleIcr), "RM page shows the ICR's activity");
  expect(await pageHasText(rmCtx, "/field-operations", titleRm), "RM page shows their own activity");
  const rmApi = await apiIds(rmCtx);
  expect(rmApi.includes(aIcr.id) && rmApi.includes(aRm.id), "RM API returns both activities");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  try {
    const ids = [aIcr?.id, aRm?.id].filter(Boolean);
    if (ids.length) await db.activity.deleteMany({ where: { id: { in: ids } } });
  } catch (e) { console.error("[cleanup]", e?.message); }
  if (icr) await destroyUser(icr);
  if (rm) await destroyUser(rm);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
