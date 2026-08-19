/**
 * Does a Regional Manager stay inside their region?
 *
 *   node --env-file=.env.local scripts/qa-rm-region-scope.mjs
 *
 * Two RMs are created: one bound to a region, one with regionId NULL — the
 * state you get by promoting an existing user to Regional Manager without
 * picking a region, which the users PATCH schema permits (`regionId` is
 * `.nullable().optional()`).
 *
 * The scoped RM is the control. The unscoped RM is the question: several
 * routes read
 *
 *     case "REGIONAL_MANAGER": return regionId ? { regionId } : {};
 *
 * and `{}` is not "no access", it is "no filter" — every row in the table.
 * Two other routes in the same codebase spell the same decision
 * `{ regionId: regionId ?? "__no_region__" }`, which matches nothing. Both
 * cannot be right; this measures which one the app actually does.
 */
import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const ctxs = [];
let regionA = null, regionB = null, leadA = null, leadB = null;

/** Rows the RM must never see, and a region to be scoped to. */
async function seed() {
  const regions = await db.region.findMany({ take: 2, orderBy: { name: "asc" } });
  if (regions.length < 2) throw new Error("need >=2 regions on the target DB");
  [regionA, regionB] = regions;

  // Every non-nullable column on Lead, spelled out so the create is not a
  // guessing game against the schema.
  const author = await db.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  const base = {
    nationality: "Testland", countryOfResidence: "Testland",
    interestedProgram: "QA Programme", studyLevel: "UNDERGRADUATE",
    intakeYear: new Date().getUTCFullYear() + 1, intakeMonth: 9,
    stage: "NEW_LEAD", createdById: author.id,
  };

  leadA = await db.lead.create({
    data: {
      ...base,
      firstName: TAG, lastName: "InRegionA", email: `${TAG.toLowerCase()}-a@illume.local`,
      regionId: regionA.id,
    },
  });
  leadB = await db.lead.create({
    data: {
      ...base,
      firstName: TAG, lastName: "InRegionB", email: `${TAG.toLowerCase()}-b@illume.local`,
      regionId: regionB.id,
    },
  });
  console.log(`  seeded: region A=${regionA.name} lead=${leadA.id.slice(0, 8)}`);
  console.log(`          region B=${regionB.name} lead=${leadB.id.slice(0, 8)}`);
}

/** Pull an array of records out of whichever envelope the route uses. */
function rows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const k of ["data", "leads", "reports", "plans", "items", "results"]) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  return null;
}

const ids = (payload) => (rows(payload) ?? []).map((r) => r?.id).filter(Boolean);

async function main() {
  await seed();

  const scoped = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: regionA.id } });
  ctxs.push(scoped);
  const unscoped = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: null } });
  ctxs.push(unscoped);

  // ── Control: the region-bound RM behaves ────────────────────────────────
  startSection("RM bound to region A — sees A, not B");
  {
    const r = await api(scoped.jar, "GET", "/api/leads?limit=100");
    expect(r.status === 200, "GET /api/leads answers", `status ${r.status}`);
    const got = ids(r.payload);
    expect(got.includes(leadA.id), "sees the student in its own region");
    expect(!got.includes(leadB.id), "does NOT see the student in region B",
      got.includes(leadB.id) ? "cross-region leak" : "");
  }

  // ── The question: an RM with no region ──────────────────────────────────
  startSection("RM with regionId NULL — must NOT see the whole org");
  const routes = [
    ["/api/leads?limit=100", "students"],
    ["/api/reports?limit=50", "monthly reports"],
    ["/api/recruitment-planning/plans", "recruitment plans"],
    ["/api/institution-interests", "institution interests"],
  ];
  for (const [path, label] of routes) {
    const r = await api(unscoped.jar, "GET", path);
    if (r.status !== 200) { ok(`${label}: ${r.status} (not readable, fine)`); continue; }
    const list = rows(r.payload);
    if (list === null) { ok(`${label}: no array envelope, skipped`); continue; }
    const got = list.map((x) => x?.id).filter(Boolean);

    // A regionless RM owns no region, so the honest answer is an empty list.
    // Seeing rows from BOTH seeded regions is proof the filter collapsed to {}.
    const sawA = got.includes(leadA.id), sawB = got.includes(leadB.id);
    if (path.startsWith("/api/leads")) {
      expect(!(sawA && sawB), `${label}: does not return both regions at once`,
        sawA && sawB ? `returned ${list.length} rows spanning every region — filter collapsed to {}` : "");
    } else {
      expect(list.length === 0, `${label}: returns nothing rather than everything`,
        list.length ? `returned ${list.length} rows org-wide` : "");
    }
  }

  // Aggregates leak counts even when they return no ids. Rather than guess
  // which field holds the total, compare the numbers in the whole payload
  // against a SUPER_ADMIN's: identical figures mean the regionless RM is being
  // served the unscoped, organisation-wide view.
  startSection("RM with regionId NULL — aggregates vs SUPER_ADMIN");
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  ctxs.push(admin);
  const numbersOf = (o) => (JSON.stringify(o).match(/:-?\d+(\.\d+)?/g) ?? []).join(",");
  for (const [path, label] of [
    ["/api/analytics/overview", "analytics overview"],
    ["/api/dashboard/stats", "dashboard stats"],
  ]) {
    const mine = await api(unscoped.jar, "GET", path);
    const theirs = await api(admin.jar, "GET", path);
    if (mine.status !== 200 || theirs.status !== 200) {
      ok(`${label}: ${mine.status}/${theirs.status}, not comparable`);
      continue;
    }
    const same = numbersOf(mine.payload) === numbersOf(theirs.payload);
    expect(!same, `${label}: figures differ from a SUPER_ADMIN's`,
      same ? "identical numbers — the regionless RM is served org-wide totals" : "");
  }

  // ── Direct object read, which uses a different expression again ─────────
  startSection("RM with regionId NULL — direct student read");
  {
    const r = await api(unscoped.jar, "GET", `/api/leads/${leadB.id}`);
    expect(r.status === 403 || r.status === 404,
      "GET /api/leads/<other region> is refused",
      `status ${r.status} — app/api/leads/[id]/route.ts allows when !regionId`);
  }
}

let code = 1;
try {
  await main();
  code = summary();
} catch (err) {
  console.error("\nFATAL:", err.message);
} finally {
  startSection("teardown");
  for (const id of [leadA?.id, leadB?.id]) {
    if (id) await db.lead.delete({ where: { id } }).catch(() => {});
  }
  for (const c of ctxs) await destroyUser(c);
  const leftover = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(leftover === 0, "disposable users removed", `${leftover} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
