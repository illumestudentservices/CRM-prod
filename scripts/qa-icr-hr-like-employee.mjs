/**
 * Verifies ICR gets the same HR & ERP experience as an EMPLOYEE: redirected
 * from /hr to their OWN profile (self-service), never the company-wide HR
 * dashboard. A manager role (REGIONAL_MANAGER) still lands on the dashboard.
 *
 *   npx tsx --env-file=.env.local scripts/qa-icr-hr-like-employee.mjs
 *
 * Disposable users with employee records, torn down in `finally`.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");

let browser, icr, emp, rm;

async function ctxFor(login) {
  const bctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await bctx.addCookies(
    [...login.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  return bctx;
}
async function head(reqCtx, path) {
  const res = await reqCtx.get(`${BROWSER_BASE}${path}`, { maxRedirects: 0 });
  return { status: res.status(), location: res.headers()["location"] ?? "" };
}

try {
  browser = await chromium.launch();

  // ── ICR behaves like EMPLOYEE ───────────────────────────────────────
  icr = await createAndLogin({ role: "ICR", withEmployee: true });
  const icrReq = (await ctxFor(icr)).request;
  startSection("ICR — HR & ERP = self-service (same as EMPLOYEE)");
  const icrHr = await head(icrReq, "/hr");
  expect(icrHr.status === 307 || icrHr.status === 302, `ICR /hr redirects (${icrHr.status})`, String(icrHr.status));
  expect(
    icrHr.location.includes(`/hr/employees/${icr.employee.id}`),
    "ICR redirected to their OWN profile",
    icrHr.location
  );
  const icrProfile = await head(icrReq, `/hr/employees/${icr.employee.id}`);
  expect(icrProfile.status === 200, `ICR can open own profile (${icrProfile.status})`, String(icrProfile.status));

  // The company-wide dashboard must NOT be reachable: /hr never renders it for
  // ICR (it redirects), and an ICR opening another employee's profile is bounced.
  const other = await db.employee.findFirst({
    where: { userId: { not: icr.user.id }, user: { deletedAt: null } },
    select: { id: true },
  });
  if (other) {
    const peek = await head(icrReq, `/hr/employees/${other.id}`);
    expect(
      (peek.status === 307 || peek.status === 302) && /\/hr(\b|\/|$)/.test(peek.location),
      "ICR cannot open another employee's record (bounced)",
      `${peek.status} ${peek.location}`
    );
  }

  // ── EMPLOYEE control (unchanged) ────────────────────────────────────
  emp = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  const empReq = (await ctxFor(emp)).request;
  startSection("EMPLOYEE — unchanged self-service redirect");
  const empHr = await head(empReq, "/hr");
  expect(
    (empHr.status === 307 || empHr.status === 302) && empHr.location.includes(`/hr/employees/${emp.employee.id}`),
    "EMPLOYEE still redirected to own profile",
    `${empHr.status} ${empHr.location}`
  );

  // ── REGIONAL_MANAGER control — keeps the dashboard ──────────────────
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  const rmCtx = await ctxFor(rm);
  startSection("REGIONAL_MANAGER — still sees the HR dashboard");
  const rmHr = await head(rmCtx.request, "/hr");
  expect(rmHr.status === 200, `RM lands on /hr dashboard (not redirected) (${rmHr.status})`, String(rmHr.status));
  const rmPage = await rmCtx.newPage();
  await rmPage.goto(`${BROWSER_BASE}/hr`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await rmPage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  expect((await rmPage.getByText("HR & ERP", { exact: false }).count()) >= 1, "RM sees HR & ERP dashboard header");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (icr) await destroyUser(icr);
  if (emp) await destroyUser(emp);
  if (rm) await destroyUser(rm);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
