/**
 * Events and Campaigns moved from Recruitment Network to Recruitment Planning.
 *
 *   npx tsx --env-file=.env scripts/qa-events-campaigns-move.mjs
 *
 * THE POINT OF THIS SCRIPT IS THAT THE MOVE CHANGED NOBODY'S ACCESS.
 *
 * proxy.ts gates module pages by URL PREFIX, and neither of these two pages
 * runs a permission check of its own. So relocating them from
 * /recruitment-network/* to /recruitment-planning/* is a permission change
 * unless something stops it.
 *
 * NOTE THE SOURCE OF TRUTH: the proxy reads NAV_PERMISSIONS (role lists), NOT
 * PERMISSION_MATRIX. The two disagree, and reading the wrong one gives the
 * wrong answer about who is affected. By NAV_PERMISSIONS the lists differ in
 * exactly three places:
 *
 *   HQ_ANALYTICS      network only  → would have LOST events and campaigns
 *   ACCOUNT_MANAGER   planning only → would have GAINED them
 *   VP_GLOBAL_SALES   planning only → would have GAINED them
 *
 * The fix is two more specific entries in PATH_TO_MODULE, which must sit ABOVE
 * "/recruitment-planning" because moduleForPath returns on first match. This
 * script checks the outcome over real HTTP with real sessions, and also pins
 * the ordering in the file, because an innocent-looking tidy-up of that list
 * would silently reopen the hole.
 */
import { readFileSync } from "node:fs";
import {
  BASE, db, createAndLogin, destroyUser,
  startSection, expect, summary,
} from "./qa-lib.mjs";

const OLD = ["/recruitment-network/events", "/recruitment-network/campaigns"];
const NEW = ["/recruitment-planning/events", "/recruitment-planning/campaigns"];
const made = [];

/** Follows nothing: we want to see the proxy's own answer. */
async function visit(ctx, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: [...ctx.jar.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ") },
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

/** True when the proxy bounced the request to the dashboard, i.e. denied it. */
const denied = (r) => r.status >= 300 && r.status < 400 && /\/dashboard/.test(r.location);

try {
  // ── 1. The ordering guard, checked in the file itself ────────────────────
  startSection("the specific rules sit above the general one in proxy.ts");

  const proxy = readFileSync("proxy.ts", "utf8");
  const iEvents = proxy.indexOf('["/recruitment-planning/events"');
  const iCampaigns = proxy.indexOf('["/recruitment-planning/campaigns"');
  const iGeneral = proxy.indexOf('["/recruitment-planning",');

  expect(iEvents > 0, "the events rule exists");
  expect(iCampaigns > 0, "the campaigns rule exists");
  expect(
    iEvents < iGeneral && iCampaigns < iGeneral,
    "both sit ABOVE the general /recruitment-planning rule",
    "moduleForPath returns on first match, so below the general rule these would never run and the access set would silently change"
  );

  // ── 2. The role that would have LOST access ──────────────────────────────
  startSection("HQ Analytics has not lost events or campaigns");

  const analytics = await createAndLogin({ role: "HQ_ANALYTICS" });
  made.push(analytics);

  for (const path of NEW) {
    const r = await visit(analytics, path);
    expect(
      !denied(r),
      `HQ Analytics can reach ${path}`,
      `status ${r.status} → ${r.location} — HQ_ANALYTICS is not on the recruitment_planning list, so without the pinned rules the move would have shut it out`
    );
  }

  // ── 3. The roles that would have GAINED access ───────────────────────────
  startSection("Account Manager and VP have not gained them");

  for (const role of ["ACCOUNT_MANAGER", "VP_GLOBAL_SALES"]) {
    const ctx = await createAndLogin({ role });
    made.push(ctx);

    // They must keep the planning module itself — PR #62 put both on the plan
    // approval chain, and shutting them out here would break that again.
    const planning = await visit(ctx, "/recruitment-planning");
    expect(
      !denied(planning),
      `${role} can still reach Recruitment Planning itself`,
      `status ${planning.status} → ${planning.location}`
    );

    for (const path of NEW) {
      const r = await visit(ctx, path);
      expect(
        denied(r),
        `${role} is still refused ${path}`,
        `status ${r.status} → ${r.location} — it cannot see these under the old address either`
      );
    }
  }

  // ── 3b. A role allowed in both ───────────────────────────────────────────
  startSection("ICR can still reach them at the new address");

  const icr = await createAndLogin({ role: "ICR" });
  made.push(icr);

  for (const path of NEW) {
    const r = await visit(icr, path);
    expect(
      !denied(r),
      `ICR can reach ${path}`,
      `status ${r.status} → ${r.location}`
    );
  }

  // ── 4. The old URLs still work ───────────────────────────────────────────
  startSection("old links and bookmarks still land in the right place");

  for (const [i, path] of OLD.entries()) {
    const r = await visit(icr, path);
    expect(
      r.status >= 300 && r.status < 400 && r.location.includes(NEW[i]),
      `${path} redirects to ${NEW[i]}`,
      `status ${r.status} → ${r.location}`
    );
  }

  const withQuery = await visit(icr, "/recruitment-network/events?status=planned");
  expect(
    withQuery.location.includes("status=planned"),
    "and the query string survives the redirect",
    `redirected to ${withQuery.location} — a saved filter should still land on the same view`
  );

  // ── 5. A role with neither permission ────────────────────────────────────
  startSection("a role with neither permission is still refused");

  const emp = await createAndLogin({ role: "EMPLOYEE" });
  made.push(emp);
  for (const path of [...NEW, ...OLD]) {
    const r = await visit(emp, path);
    expect(denied(r), `Employee is refused ${path}`, `status ${r.status} → ${r.location}`);
  }
} catch (e) {
  console.error("\nSCRIPT ERROR:", e);
  process.exitCode = 1;
} finally {
  for (const ctx of made) {
    try { await destroyUser(ctx); } catch { /* best effort */ }
  }
  await db.$disconnect();
  summary();
}
