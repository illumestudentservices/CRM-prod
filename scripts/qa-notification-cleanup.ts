/**
 * Unit test for cleanupNewHireNotifications(): new-hire notifications older than
 * 7 days are removed; recent ones and non-new-hire notifications are kept.
 * Dry-run counts without deleting. 3 rounds.
 *
 *   npx tsx --env-file=.env.local scripts/qa-notification-cleanup.ts
 */
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { cleanupNewHireNotifications } from "@/lib/notification-cleanup";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${x}`); } };

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

async function main() {
  const tag = Date.now().toString().slice(-6);
  const u = await db.user.create({
    data: { email: `notifclean-${tag}@qa.local`, firstName: "NC", lastName: tag, name: `NC ${tag}`, password: await bcrypt.hash("x", 4), role: "EMPLOYEE", isActive: true },
  });
  const mk = (title: string, type: string, created: Date) =>
    db.notification.create({ data: { userId: u.id, title, message: "m", type, isRead: false, createdAt: created } });

  try {
    for (let r = 1; r <= 3; r++) {
      console.log(`\n── round ${r} ──`);
      await db.notification.deleteMany({ where: { userId: u.id } });

      const oldNewHire = await mk("Welcome to Illume, Alice", "NEW_HIRE", daysAgo(10));   // delete
      const recentNewHire = await mk("Welcome to Illume, Bob", "NEW_HIRE", daysAgo(2));    // keep
      const legacy = await mk("Welcome to Illume, Carol", "ANNOUNCEMENT", daysAgo(10));    // delete (legacy)
      const otherAnn = await mk("Quarterly all-hands", "ANNOUNCEMENT", daysAgo(10));       // keep (not new-hire)
      const otherType = await mk("Task due today", "TASK_DUE_TODAY", daysAgo(10));         // keep

      // Dry run counts the 2 that would go, deletes nothing.
      const dry = await cleanupNewHireNotifications({ dryRun: true });
      ok("dry run reports 2 removable, deletes nothing", dry.deleted === 2 && (await db.notification.count({ where: { userId: u.id } })) === 5, `dry ${dry.deleted}`);

      const res = await cleanupNewHireNotifications({});
      ok("removes exactly 2 (old new-hire + legacy)", res.deleted === 2, `deleted ${res.deleted}`);

      const exists = async (id: string) => (await db.notification.count({ where: { id } })) === 1;
      ok("old NEW_HIRE deleted", !(await exists(oldNewHire.id)));
      ok("legacy Welcome ANNOUNCEMENT deleted", !(await exists(legacy.id)));
      ok("recent NEW_HIRE kept", await exists(recentNewHire.id));
      ok("other ANNOUNCEMENT kept", await exists(otherAnn.id));
      ok("other type kept", await exists(otherType.id));
    }
  } catch (e) {
    fail++; console.error("CRASH:", (e as Error)?.stack || e);
  } finally {
    await db.notification.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await db.user.delete({ where: { id: u.id } }).catch(() => {});
    await db.$disconnect().catch(() => {});
    console.log(`\n  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
}
main();
