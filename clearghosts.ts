import "dotenv/config";
import { db } from "@/lib/db";

/**
 * Removes employee records belonging to soft-deleted accounts.
 *
 * These are the original demo staff. Their user rows were disabled on
 * 2026-07-27 but the employee rows were left behind, so HR counted seven
 * "employees" who were all disabled seed accounts. The query filter hides them;
 * this clears them for good, before the user purge on 26 August turns their
 * parent accounts into "Deleted user" and leaves the employee rows pointing at
 * tombstones.
 *
 * Scoped strictly to employees whose user is soft-deleted. Anyone live is
 * untouchable by construction, and the script refuses to run if that invariant
 * does not hold.
 */
(async () => {
  const ghosts = await db.employee.findMany({
    where: { user: { deletedAt: { not: null } } },
    select: { id: true, employeeId: true, user: { select: { email: true } } },
    orderBy: { employeeId: "asc" },
  });

  if (ghosts.length === 0) {
    console.log("nothing to clear");
    process.exit(0);
  }

  const ids = ghosts.map((g) => g.id);

  // Safety net: if any employee outside this set names one of these as their
  // manager, deleting would silently blank a live person's reporting line.
  const liveWithGhostManager = await db.employee.count({
    where: { managerId: { in: ids }, user: { deletedAt: null } },
  });
  if (liveWithGhostManager > 0) {
    console.error(
      `REFUSING: ${liveWithGhostManager} live employee(s) report to one of these. ` +
        `Reassign their manager first.`
    );
    process.exit(1);
  }

  const balances = await db.leaveBalance.count({ where: { employeeId: { in: ids } } });
  const requests = await db.leaveRequest.count({ where: { employeeId: { in: ids } } });

  console.log(`clearing ${ghosts.length} orphaned employee record(s):`);
  ghosts.forEach((g) => console.log(`   ${g.employeeId}  ${g.user.email}`));
  console.log(`cascading: ${balances} leave balance(s), ${requests} leave request(s)`);

  const result = await db.$transaction(async (tx) => {
    // Cascades handle the dependent rows; the audit entry is written inside the
    // same transaction so the record cannot outlive a rollback.
    const deleted = await tx.employee.deleteMany({ where: { id: { in: ids } } });
    await tx.auditLog.create({
      data: {
        action: "EMPLOYEE_RECORDS_CLEARED",
        entity: "Employee",
        entityId: ids[0],
        changes: {
          count: deleted.count,
          employeeIds: ghosts.map((g) => g.employeeId),
          emails: ghosts.map((g) => g.user.email),
          cascadedLeaveBalances: balances,
          cascadedLeaveRequests: requests,
          note: "Orphaned records belonging to soft-deleted demo accounts.",
        },
      },
    });
    return deleted.count;
  });

  console.log(`\ndeleted ${result} employee record(s)`);
  console.log("employee rows remaining: " + (await db.employee.count()));
  console.log("HR headcount: " +
    (await db.employee.count({ where: { isActive: true, user: { deletedAt: null } } })));
  console.log("orphans remaining: " +
    (await db.employee.count({ where: { user: { deletedAt: { not: null } } } })));
  console.log("live leads: " + (await db.lead.count({ where: { deletedAt: null } })));
  process.exit(0);
})();
