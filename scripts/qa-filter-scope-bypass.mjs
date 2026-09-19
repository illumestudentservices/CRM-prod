/**
 * Can a FILTER PARAMETER be used to see someone else's rows?
 *
 *   npx tsx --env-file=.env scripts/qa-filter-scope-bypass.mjs
 *
 * ★ THIS IS THE FILTER TEST THAT MATTERS. Checking that a filter narrows a list
 * proves nothing about safety — PR #127 shipped a plans filter written as
 * `{ ...scope, ...filters }` where `icrId` appeared in BOTH, so the later key won
 * and `?icr=<colleague>` REPLACED the row scope instead of narrowing inside it.
 * A "the list got shorter" test passes that happily. The test that catches it
 * signs in as A, asks for B's rows, and demands to see NONE of them.
 *
 * ANY FILTER SHARING A KEY WITH A SCOPE IS A BYPASS WAITING TO HAPPEN.
 *
 * The actor is given real leads of their own on purpose: an account with zero
 * rows returns zero for every request, so the assertion would pass whether the
 * scope worked or not. Fixtures are removed in `finally`.
 */
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

let actor, rm;
const madeLeads = [];

/** Fetches a page's HTML with the actor's session. */
async function getAs(ctx, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: ctx.jar.header() } });
  return { status: res.status, html: await res.text() };
}

try {
  startSection("Fixtures — a victim with rows, and an actor with rows of their own");
  // The victims already exist in the mirror, each in a different region.
  const victims = await db.user.findMany({
    where: { role: "ICR", isActive: true },
    select: { id: true, name: true, regionId: true },
  });
  const victim = victims.find((v) => v.regionId);
  const victimLeads = await db.lead.findMany({
    where: { assignedICRId: victim.id, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  expect(victimLeads.length > 0,
    `victim "${victim.name}" owns ${victimLeads.length} leads to try to steal`);

  // ── The actor: an ICR in the SAME region, with leads of their own ──────────
  // Same region on purpose — if the actor sat in an empty region, a regional
  // scope and a broken scope would be indistinguishable.
  actor = await createAndLogin({ role: "ICR", extra: { regionId: victim.regionId } });

  // Clone an existing row's shape rather than hand-writing one: Lead has a long
  // tail of required scalars (studyLevel, intakeYear, …) and guessing them one
  // failed `create()` at a time is wasted effort. Strip the identity columns and
  // anything unique, then re-own it.
  const template = await db.lead.findFirst({ where: { deletedAt: null } });
  for (let i = 0; i < 2; i++) {
    const { id, createdAt, updatedAt, captureId, ...rest } = template;
    madeLeads.push(await db.lead.create({
      data: {
        ...rest,
        firstName: "ZZScope", lastName: `Actor${i}`,
        email: `zzscope-actor-${i}-${Date.now()}@illume.local`,
        captureId: null,
        assignedICRId: actor.user.id,
      },
    }));
  }

  const ownNames = madeLeads.map((l) => l.firstName + " " + l.lastName);
  const stolen = (html) => victimLeads.filter((l) =>
    html.includes(l.email) || html.includes(`${l.firstName} ${l.lastName}`));

  // ── /students ──────────────────────────────────────────────────────────────
  startSection("/students — an ICR cannot reach a colleague's students");
  {
    const base = await getAs(actor, "/students");
    expect(base.status === 200, "actor can open /students");
    expect(ownNames.every((n) => base.html.includes(n)),
      `actor sees their OWN ${madeLeads.length} leads (so 0 would be meaningful)`);
    expect(stolen(base.html).length === 0,
      `actor sees NONE of the victim's ${victimLeads.length} leads`,
      stolen(base.html).map((l) => l.email).join(", "));

    // The filter param a bypass would ride in on.
    for (const qs of [
      `?icr=${victim.id}`,
      `?assignedICRId=${victim.id}`,
      `?icrId=${victim.id}`,
      `?userId=${victim.id}`,
    ]) {
      const r = await getAs(actor, `/students${qs}`);
      expect(r.status < 500, `/students${qs} does not 500`, `status ${r.status}`);
      expect(stolen(r.html).length === 0,
        `/students${qs} leaks none of the victim's leads`,
        stolen(r.html).map((l) => l.email).join(", "));
    }
  }

  // ── The API behind it ──────────────────────────────────────────────────────
  startSection("/api/leads — the same question at the API layer");
  {
    for (const qs of ["", `?assignedICRId=${victim.id}`, `?icr=${victim.id}`, "?scope=all", "?take=1000"]) {
      const res = await fetch(`${BASE}/api/leads${qs}`, { headers: { Cookie: actor.jar.header() } });
      const status = res.status;
      let payload = null;
      try { payload = await res.json(); } catch { /* not json */ }
      const rows = Array.isArray(payload) ? payload : (payload?.data ?? payload?.leads ?? []);
      const ids = new Set(Array.isArray(rows) ? rows.map((r) => r?.id) : []);
      const leaked = victimLeads.filter((l) => ids.has(l.id));
      expect(status < 500, `GET /api/leads${qs} does not 500`, `status ${status}`);
      expect(leaked.length === 0,
        `GET /api/leads${qs} returns none of the victim's leads`,
        leaked.length ? `${leaked.length} leaked` : `${ids.size} rows, all in scope`);
    }
  }

  // ── An INSTITUTION_CLIENT must not read another client's students ──────────
  startSection("/api/leads — ?institutionId= cannot replace a client's allowlist");
  {
    const client = await createAndLogin({ role: "INSTITUTION_CLIENT" });
    try {
      // The client is linked to NO institution, so its scope is
      // `{ institutionId: { in: [] } }` — matches nothing. A bare
      // `?institutionId=<any>` spread over that would replace the allowlist.
      const inst = await db.institution.findFirst({
        where: { deletedAt: null, leads: { some: { deletedAt: null } } },
        select: { id: true, name: true },
      });
      expect(!!inst, "found an institution that actually has students", inst?.name);
      const res = await fetch(`${BASE}/api/leads?institutionId=${inst.id}&limit=100`,
        { headers: { Cookie: client.jar.header() } });
      let payload = null;
      try { payload = await res.json(); } catch { /* not json */ }
      const rows = payload?.data ?? payload?.leads ?? (Array.isArray(payload) ? payload : []);
      const n = Array.isArray(rows) ? rows.length : 0;
      expect(n === 0,
        "a client linked to no institution gets 0 students despite naming one",
        n ? `${n} students leaked` : `status ${res.status}`);
    } finally {
      await destroyUser(client);
    }
  }

  // ── Transition reports: status is BOTH a scope and a filter ────────────────
  startSection("/api/transition-reports — ?status= cannot widen a FINAL-only scope");
  {
    // VP_GLOBAL_SALES is scoped to { status: { in: ["FINAL","ARCHIVED"] } }.
    const vp = await createAndLogin({ role: "VP_GLOBAL_SALES" });
    try {
      // IN_PROGRESS is a real TransitionStatus and is exactly what the scope
      // withholds. "DRAFT" is NOT in the enum — it looks like a sensible value
      // and is the sort of thing a hand-edited URL would carry, which is why
      // the unvalidated cast used to 500 on it.
      const res = await fetch(`${BASE}/api/transition-reports?status=IN_PROGRESS`,
        { headers: { Cookie: vp.jar.header() } });
      let payload = null;
      try { payload = await res.json(); } catch { /* not json */ }
      const rows = payload?.data ?? payload?.reports ?? (Array.isArray(payload) ? payload : []);
      const leaked = (Array.isArray(rows) ? rows : [])
        .filter((r) => r?.status && !["FINAL", "ARCHIVED"].includes(r.status));
      expect(res.status < 500, "?status=IN_PROGRESS does not 500", `status ${res.status}`);
      expect(leaked.length === 0,
        "a VP asking for in-progress handovers gets none — the scope still applies",
        leaked.length ? `${leaked.length} leaked` : "none");

      // A value outside the enum must be a 400, not a 500.
      const bad = await fetch(`${BASE}/api/transition-reports?status=DRAFT`,
        { headers: { Cookie: vp.jar.header() } });
      expect(bad.status === 400,
        "an invalid ?status= returns 400, not a 500 from Prisma",
        `status ${bad.status}`);
    } finally {
      await destroyUser(vp);
    }
  }

  // ── /recruitment-planning — the exact shape PR #127 fixed ──────────────────
  startSection("/recruitment-planning — the ?icr= bypass that PR #127 fixed");
  {
    const r = await getAs(actor, `/recruitment-planning?icr=${victim.id}`);
    expect(r.status < 500, "plans page with a foreign ?icr= does not 500", `status ${r.status}`);
    // The mirror holds no plans, so this cannot assert on rows. Pin the SOURCE
    // instead: the scope must be merged with AND, never by spreading.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("app/(dashboard)/recruitment-planning/page.tsx", "utf8"));
    expect(/where\s*[:=]\s*\{\s*AND\s*:\s*\[/.test(src),
      "plans query still merges scope with AND: [scope, filters]",
      "a `{ ...scope, ...filters }` spread here is the bypass — icrId is in both");
    expect(!/\{\s*\.\.\.scope\s*,\s*\.\.\./.test(src),
      "plans query does NOT spread scope into the filters");
  }

  // ── A REGIONAL_MANAGER must not cross regions ──────────────────────────────
  startSection("Regional scope — a manager cannot read another region");
  {
    const otherRegion = victims.find((v) => v.regionId && v.regionId !== victim.regionId);
    if (otherRegion) {
      rm = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: victim.regionId } });

      // ★ "Foreign" MUST be defined by `lead.regionId`, which is the column the
      // scope actually filters on — NOT by "owned by an ICR in another region".
      // A lead's region is its own field and does not track its owner's: on the
      // mirror one ICR's 12 leads span three regions. Defining foreign by owner
      // reports a leak when the manager correctly sees the 2 that really are in
      // their region, and the 2-of-12 shape looks alarming while being right.
      const foreign = await db.lead.findMany({
        where: { deletedAt: null, NOT: { regionId: victim.regionId } },
        select: { email: true, firstName: true, lastName: true, regionId: true },
      });
      expect(foreign.length > 0, `${foreign.length} leads sit outside the RM's region`);
      for (const qs of ["", `?region=${otherRegion.regionId}`, `?regionId=${otherRegion.regionId}`,
                        `?icr=${otherRegion.id}`]) {
        const r = await getAs(rm, `/students${qs}`);
        const leaked = foreign.filter((l) =>
          r.html.includes(l.email) || r.html.includes(`${l.firstName} ${l.lastName}`));
        expect(leaked.length === 0,
          `RM sees none of the ${foreign.length} out-of-region leads via "${qs || "no param"}"`,
          leaked.slice(0, 3).map((l) => l.email).join(", "));
      }

      // ── The same collision, at the API layer ────────────────────────────────
      // `regionScope()` returns `{ regionId }` and the route then spreads
      // `...(filterRegionId && { regionId: filterRegionId })` OVER it.
      const res = await fetch(`${BASE}/api/leads?regionId=${otherRegion.regionId}&limit=100`,
        { headers: { Cookie: rm.jar.header() } });
      let payload = null;
      try { payload = await res.json(); } catch { /* not json */ }
      const rows = Array.isArray(payload) ? payload : (payload?.data ?? payload?.leads ?? []);
      const list = Array.isArray(rows) ? rows : [];

      // ★ Two traps here, both the "proves nothing" shape.
      //
      // 1. The route selects `region: { select: { id … } }`, NOT a flat
      //    `regionId`. Reading `l.regionId` is undefined on every row, so a
      //    filter on it matches nothing and the assertion passes vacuously.
      // 2. Now that the scope is ANDed, the foreign request correctly returns
      //    ZERO rows — so "0 out-of-region rows" no longer distinguishes a
      //    working scope from an empty/erroring response.
      //
      // So prove the endpoint really answers for this session FIRST, against
      // the manager's OWN region, and only then demand nothing for the foreign
      // one.
      const ownRes = await fetch(`${BASE}/api/leads?limit=100`,
        { headers: { Cookie: rm.jar.header() } });
      const ownPayload = await ownRes.json().catch(() => null);
      const own = ownPayload?.data ?? ownPayload?.leads ?? [];
      expect(Array.isArray(own) && own.length > 0,
        `RM's own region returns ${own.length ?? 0} rows — the endpoint does answer`);
      expect(own.every((l) => l?.region === null || l?.region?.id !== undefined),
        "rows expose region as `region.id` — asserting on `l.regionId` would prove nothing");
      expect(own.every((l) => !l?.region?.id || l.region.id === victim.regionId),
        "…and every one of them is in the RM's own region");

      const outside = list.filter((l) => l?.region?.id && l.region.id !== victim.regionId);
      expect(outside.length === 0,
        `GET /api/leads?regionId=<other> returns ${list.length} rows, none out of scope`,
        outside.length ? `${outside.length} out-of-region rows returned` : "all in scope");
    } else {
      expect(false, "mirror has a second populated region to test against");
    }
  }
} catch (e) {
  console.error("FATAL:", e.code ?? "", e.message);
  process.exitCode = 1;
} finally {
  for (const l of madeLeads) {
    await db.lead.delete({ where: { id: l.id } }).catch(() => {});
  }
  if (actor) await destroyUser(actor);
  if (rm) await destroyUser(rm);
  const left = await db.lead.count({ where: { firstName: "ZZScope" } });
  console.log(`cleanup: ${madeLeads.length} fixture leads removed, ${left} ZZScope rows remain`);
  summary();
  await db.$disconnect();
}
