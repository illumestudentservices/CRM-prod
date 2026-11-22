/**
 * IDOR / BOLA regression for /api/activities/[id].
 *
 * The LIST route scopes a non-supervisor (ICR etc.) to the activities they
 * logged themselves (activityVisibilityWhere). This proves the single-activity
 * route enforces the SAME object scope, so it can't be used to read, edit or
 * delete another contributor's activity by guessing its id — while the owner and
 * a supervisor (SUPER_ADMIN) can still reach it.
 *
 *   npx tsx --env-file=.env.local scripts/qa-activity-idor.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary } from "./qa-lib.mjs";

let owner, outsider, supervisor;
const activityIds = [];
let overrideSet = false;

async function seedActivity(userId, extra = {}) {
  const a = await db.activity.create({
    data: {
      type: "SCHOOL_VISIT",
      title: "QA field visit",
      date: new Date(),
      status: "COMPLETED",
      userId,
      cost: 100,
      studentsEngaged: 10,
      outcomes: "original outcome",
      attendees: { create: [{ name: "QA Counsellor", email: "qa.counsellor@example.com", organization: "QA School" }] },
      ...extra,
    },
    select: { id: true },
  });
  activityIds.push(a.id);
  return a.id;
}

try {
  owner = await createAndLogin({ role: "ICR", withEmployee: true });
  outsider = await createAndLogin({ role: "ICR", withEmployee: true });
  supervisor = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });

  const bId = await seedActivity(owner.user.id);          // owned by `owner`
  const aOwnId = await seedActivity(outsider.user.id);    // owned by `outsider`

  // ── Outsider (non-supervisor, NOT the owner) must be walled off ────────────
  startSection("Outsider ICR cannot reach another ICR's activity");
  {
    const g = await api(outsider.jar, "GET", `/api/activities/${bId}`);
    expect(g.status === 404, "GET another's activity → 404 (no PII/attendee leak)", `got ${g.status}`);

    const p = await api(outsider.jar, "PATCH", `/api/activities/${bId}`, { cost: 99999, outcomes: "tampered" });
    expect(p.status === 404, "PATCH another's activity → 404", `got ${p.status}`);
    const after = await db.activity.findUnique({ where: { id: bId }, select: { cost: true, outcomes: true } });
    expect(Number(after?.cost) === 100 && after?.outcomes === "original outcome", "victim activity UNCHANGED after blocked PATCH", JSON.stringify(after));
  }

  // DELETE is gated by activities:delete; grant it to the ICR role so we test the
  // OBJECT guard itself, not just the permission gate.
  startSection("Outsider cannot delete another's activity even WITH activities:delete");
  {
    await db.permissionOverride.upsert({
      where: { role_resource_action: { role: "ICR", resource: "activities", action: "delete" } },
      update: { granted: true, updatedById: owner.user.id },
      create: { role: "ICR", resource: "activities", action: "delete", granted: true, updatedById: owner.user.id },
    });
    overrideSet = true;

    const d = await api(outsider.jar, "DELETE", `/api/activities/${bId}`);
    expect(d.status === 404, "DELETE another's activity → 404", `got ${d.status}`);
    const row = await db.activity.findUnique({ where: { id: bId }, select: { deletedAt: true } });
    expect(row && row.deletedAt === null, "victim activity NOT trashed", JSON.stringify(row));
  }

  // ── Owner can still reach their own ────────────────────────────────────────
  startSection("Owner reaches their own activity");
  {
    const g = await api(owner.jar, "GET", `/api/activities/${bId}`);
    expect(g.status === 200, "owner GET own → 200", `got ${g.status}`);
    const p = await api(owner.jar, "PATCH", `/api/activities/${bId}`, { outcomes: "owner edit" });
    expect(p.status === 200, "owner PATCH own → 200", `got ${p.status}`);
    const after = await db.activity.findUnique({ where: { id: bId }, select: { outcomes: true } });
    expect(after?.outcomes === "owner edit", "owner edit applied", JSON.stringify(after));
  }

  // ── Outsider reaches THEIR OWN (guard not over-blocking) ───────────────────
  startSection("Guard does not over-block the owner's own record");
  {
    const g = await api(outsider.jar, "GET", `/api/activities/${aOwnId}`);
    expect(g.status === 200, "outsider GET own activity → 200", `got ${g.status}`);
  }

  // ── Supervisor (SUPER_ADMIN) reaches any ──────────────────────────────────
  startSection("Supervisor reaches any activity (matches the list scope)");
  {
    const g = await api(supervisor.jar, "GET", `/api/activities/${bId}`);
    expect(g.status === 200, "supervisor GET another's → 200", `got ${g.status}`);
    const p = await api(supervisor.jar, "PATCH", `/api/activities/${bId}`, { outcomes: "supervisor edit" });
    expect(p.status === 200, "supervisor PATCH another's → 200", `got ${p.status}`);
  }
} finally {
  if (overrideSet) await db.permissionOverride.deleteMany({ where: { role: "ICR", resource: "activities", action: "delete" } }).catch(() => {});
  for (const id of activityIds) {
    await db.activityAttendee.deleteMany({ where: { activityId: id } }).catch(() => {});
    await db.activity.delete({ where: { id } }).catch(() => {});
  }
  for (const u of [owner, outsider, supervisor]) { if (u) await destroyUser(u).catch(() => {}); }
  await db.$disconnect().catch(() => {});
  summary();
}
