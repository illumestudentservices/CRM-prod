/**
 * Does an INSTITUTION_CLIENT see only ITS OWN students, or everyone's?
 *
 *   node --import tsx --env-file=.env scripts/qa-breakin-client-scope.mjs
 *
 * INSTITUTION_CLIENT is the only externally-held role in the system: it belongs
 * to a partner university, not to Illume. PERMISSION_MATRIX deliberately grants
 * it leads:["read"], which is fine in itself — a client is meant to see the
 * students being sent to it.
 *
 * The question this answers is which students. buildScopeFilter() in
 * app/api/leads/route.ts returns {} for this role with the comment "handled at
 * route level", and the route only checks whether the caller may read at all.
 * If nothing narrows the query, one client can read every other client's
 * applicants, with contact details.
 *
 * Three passes, real logins, accounts destroyed and confirmed gone after each.
 */

import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG, sleep,
} from "./qa-lib.mjs";

const PASSES = 3;
const allCreated = [];

async function get(jar, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: jar.header() } });
  let payload = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  await sleep(40);
  return { status: res.status, payload };
}

async function runPass(pass) {
  startSection(`PASS ${pass} — INSTITUTION_CLIENT lead visibility`);

  const totalLeads = await db.lead.count({ where: { deletedAt: null } });
  ok(`students in the database: ${totalLeads}`);

  // ── Case A: a client with no institution assigned ─────────────────────
  const client = await createAndLogin({ role: "INSTITUTION_CLIENT" });
  allCreated.push(client);

  // Pull a page big enough to expose the whole table if nothing is scoping it.
  const r = await get(client.jar, "/api/leads?limit=100");
  expect(r.status === 200, "the client role can call the students endpoint",
    `status=${r.status}`);

  const rows = r.payload?.data ?? [];
  ok(`unassigned client received ${rows.length} rows`);

  expect(rows.length === 0,
    "*** an unassigned client sees NO students at all ***",
    `got ${rows.length} of ${totalLeads}`);

  const institutions = new Set(rows.map((l) => l.institutionId ?? l.institution?.id ?? null));
  institutions.delete(null);
  expect(institutions.size === 0,
    "*** no other client's students are visible ***",
    `${institutions.size} distinct institutions in the response`);

  await destroyUser(client);
  {
    const gone = await db.user.count({ where: { id: client.user.id } });
    expect(gone === 0, "unassigned client account deleted", `${gone} remaining`);
    if (gone === 0) {
      const i = allCreated.indexOf(client); if (i >= 0) allCreated.splice(i, 1);
    }
  }

  // ── Case B: a client assigned to ONE institution ──────────────────────
  // A fix that returns nothing to everyone is not a fix. This proves the
  // legitimate case still works, and that it stops at the boundary.
  const target = await db.lead.groupBy({
    by: ["institutionId"],
    where: { institutionId: { not: null }, deletedAt: null },
    _count: { _all: true },
    orderBy: { _count: { institutionId: "desc" } },
    take: 1,
  });
  const targetInstitutionId = target[0]?.institutionId ?? null;
  const expectedOwn = target[0]?._count?._all ?? 0;

  if (!targetInstitutionId) {
    ok("no institution in the mirror owns any student — positive case skipped");
    return;
  }

  const assigned = await createAndLogin({ role: "INSTITUTION_CLIENT" });
  allCreated.push(assigned);
  await db.institutionUser.create({
    data: {
      institutionId: targetInstitutionId,
      userId: assigned.user.id,
      assignmentStatus: "ACTIVE",
    },
  });

  const r2 = await get(assigned.jar, "/api/leads?limit=100");
  const rows2 = r2.payload?.data ?? [];
  ok(`assigned client received ${rows2.length} rows (its institution owns ${expectedOwn})`);

  expect(rows2.length === expectedOwn,
    "*** an assigned client sees exactly its own institution's students ***",
    `got ${rows2.length}, expected ${expectedOwn}`);

  const foreign = rows2.filter(
    (l) => (l.institutionId ?? l.institution?.id) !== targetInstitutionId
  );
  expect(foreign.length === 0,
    "*** an assigned client sees no student from another institution ***",
    `${foreign.length} foreign students`);

  expect(rows2.length < totalLeads,
    "*** an assigned client still does not see the whole table ***",
    `${rows2.length} of ${totalLeads}`);

  // Contact details stay redacted even for the client's own students.
  const withEmail = rows2.filter((l) => l.email).length;
  const withPhone = rows2.filter((l) => l.phone).length;
  expect(withEmail === 0 && withPhone === 0,
    "*** no student contact details reach the external client role ***",
    `${withEmail} emails, ${withPhone} phone numbers`);

  await db.institutionUser.deleteMany({ where: { userId: assigned.user.id } }).catch(() => {});
  await destroyUser(assigned);
  {
    const gone = await db.user.count({ where: { id: assigned.user.id } });
    expect(gone === 0, "assigned client account deleted", `${gone} remaining`);
    if (gone === 0) {
      const i = allCreated.indexOf(assigned); if (i >= 0) allCreated.splice(i, 1);
    }
  }
}

async function main() {
  startSection("Baseline");
  const before = await db.user.count();
  const leadsBefore = await db.lead.count();
  ok(`users=${before} leads=${leadsBefore}`);

  for (let p = 1; p <= PASSES; p++) await runPass(p);

  startSection("Footprint");
  expect(await db.user.count() === before, "*** user count back to baseline ***");
  expect(await db.lead.count() === leadsBefore,
    "*** student records untouched — read-only probe ***");
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", String(e?.message));
} finally {
  for (const c of allCreated) await destroyUser(c);
  const leaked = await db.user.count({
    where: { email: { contains: TAG.toLowerCase() } },
  }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leaked}\n`);
  await db.$disconnect();
}
summary();
