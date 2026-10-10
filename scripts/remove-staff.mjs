/**
 * Remove staff accounts, the same way the Settings screen does.
 *
 *   node --import tsx scripts/remove-staff.mjs <mailbox,mailbox,...> [--commit]
 *
 * Dry run by default. Takes the local part of the work address, because that
 * is how people refer to colleagues in practice ("remove olumayowa"), and
 * refuses to act on anything that does not resolve to exactly one live
 * account.
 *
 * This is a SOFT delete with a thirty-day recovery window, which is what
 * DELETE /api/settings/users/[id] does and what the recycle bin and the purge
 * cron are built around. Nothing is erased today: after thirty days
 * purge-deleted-users.ts anonymises the row, keeping it only because business
 * records reference it.
 *
 * It mirrors that route step for step so a removal done here is
 * indistinguishable from one done in the app:
 *
 *   - guardUserRemoval first, which refuses to remove your own account or the
 *     last Super Admin who can still sign in
 *   - trashRecord, so it lands in the recycle bin beside everything else
 *   - isActive false as well as deletedAt, so nothing treats them as live if a
 *     query ever forgets the deletedAt filter
 *   - sessionsRevokedAt, which kills every session they hold on next request
 *   - a USER_DELETED audit entry carrying the date it stops being recoverable
 *
 * The one thing it does not do is send the security alert to every Super
 * Admin. That mail exists to tell administrators about a deletion they might
 * not know about; a bulk removal they asked for is not that, and eight copies
 * of it is noise rather than oversight. The audit entries are still written.
 *
 * Before removing anyone it reports what depends on them — direct reports,
 * pending leave, open tasks — because a manager who disappears leaves their
 * reports with no leave approver.
 */
import "dotenv/config";

const { db } = await import("@/lib/db");
const { guardUserRemoval, RECOVERY_WINDOW_DAYS } = await import("@/lib/user-lifecycle");
const { trashRecord } = await import("@/lib/recycle-bin");

const [, , list, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");
const ACTOR_EMAIL = "it@illumestudentservices.ca";

if (!list) {
  console.error("usage: remove-staff.mjs <mailbox,mailbox,...> [--commit]");
  process.exit(2);
}
const wanted = list.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
console.log(`${wanted.length} name(s) requested`);
console.log(COMMIT ? "MODE: COMMIT\n" : "MODE: dry run — nothing will be removed\n");

const actor = await db.user.findFirst({
  where: { email: ACTOR_EMAIL, deletedAt: null }, select: { id: true },
});
if (!actor) {
  console.error(`acting user ${ACTOR_EMAIL} not found`);
  process.exit(1);
}

const live = await db.user.findMany({
  where: { deletedAt: null },
  select: {
    id: true, email: true, name: true, role: true,
    employee: { select: { id: true, employeeId: true } },
  },
});

const resolved = [];
for (const w of wanted) {
  const hits = live.filter((u) => u.email.toLowerCase().split("@")[0] === w);
  if (hits.length === 0) {
    console.log(`  NOT FOUND   ${w} — no live account`);
    continue;
  }
  if (hits.length > 1) {
    // Never guess. Two people can share a local part across domains, and
    // picking one of them would remove the wrong colleague.
    console.log(`  AMBIGUOUS   ${w} — ${hits.length} live accounts: ${hits.map((h) => h.email).join(", ")}`);
    continue;
  }
  resolved.push(hits[0]);
}
console.log(`\n${resolved.length} of ${wanted.length} resolved to exactly one account`);

let blocked = 0;
let removed = 0;

for (const u of resolved) {
  const empId = u.employee?.id;
  const reports = empId
    ? await db.employee.count({ where: { managerId: empId } })
    : 0;
  const pendingLeave = empId
    ? await db.leaveRequest.count({ where: { employeeId: empId, status: "PENDING" } })
    : 0;
  const tasks = empId
    ? await db.task.count({
        where: { deletedAt: null, OR: [{ assigneeId: empId }, { createdById: empId }] },
      })
    : 0;

  const guard = await guardUserRemoval(u.id, actor.id, "DELETE");
  const tag = `${u.employee?.employeeId ?? "(no employee record)"}  ${u.email}`;

  if (!guard.ok) {
    console.log(`  REFUSED  ${tag} — ${guard.reason}`);
    blocked++;
    continue;
  }

  const deps = [];
  if (reports) deps.push(`${reports} direct report(s) would be left without a manager`);
  if (pendingLeave) deps.push(`${pendingLeave} leave request(s) still pending`);
  if (tasks) deps.push(`${tasks} open task(s)`);

  if (!COMMIT) {
    console.log(`  WOULD REMOVE  ${tag}  (${u.role})${deps.length ? "  !! " + deps.join("; ") : ""}`);
    continue;
  }

  const now = new Date();
  try {
    await trashRecord({ entityType: "User", entityId: u.id, userId: actor.id });
    await db.user.update({
      where: { id: u.id },
      data: { isActive: false, sessionsRevokedAt: now },
    });
    await db.auditLog.create({
      data: {
        userId: actor.id,
        action: "USER_DELETED",
        entity: "User",
        entityId: u.id,
        changes: {
          email: u.email,
          role: u.role,
          employeeId: u.employee?.employeeId ?? null,
          reason: "Removed in bulk: no Microsoft 365 licence on the 10 Oct 2026 roll.",
          via: "scripts/remove-staff.mjs",
          recoverableUntil: new Date(now.getTime() + RECOVERY_WINDOW_DAYS * 86_400_000).toISOString(),
        },
      },
    });
    console.log(`  removed  ${tag}${deps.length ? "  !! " + deps.join("; ") : ""}`);
    removed++;
  } catch (err) {
    console.error(`  FAILED   ${tag} — ${err.message}`);
    blocked++;
  }
}

console.log("\n" + "=".repeat(60));
console.log(`  removed    ${COMMIT ? removed : resolved.length - blocked}${COMMIT ? "" : " (would be)"}`);
console.log(`  refused    ${blocked}`);
console.log(`  unresolved ${wanted.length - resolved.length}`);
if (COMMIT) {
  console.log(`\n  Recoverable for ${RECOVERY_WINDOW_DAYS} days, then anonymised by the purge cron.`);
  console.log("  No security-alert emails were sent; the audit entries are written.");
}
console.log("=".repeat(60));

await db.$disconnect();
process.exit(blocked ? 1 : 0);
