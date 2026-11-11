/**
 * QA — when an ICR's lead is captured, the OWNER (ICR) is emailed but the
 * MANAGER is NOT; the manager still gets the in-app bell. 3×.
 *
 * Runs notifyNewLeads() directly with BREVO_API_KEY="" so the mailer logs each
 * intended recipient ("[email] Skipped ... to: X") instead of sending — we read
 * those lines to prove who would have been emailed.
 *
 *   BREVO_API_KEY= npx tsx --env-file=.env.local scripts/qa-lead-notify-no-manager-email.ts
 */
import bcrypt from "bcryptjs";
import { db } from "./qa-lib.mjs";
import { notifyNewLeads } from "@/lib/lead-notifications";

let pass = 0, fail = 0;
function expect(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function mkUser(tag: string, label: string, role: string) {
  return db.user.create({ data: {
    email: `${tag}-${label}@notify.local`.toLowerCase(),
    firstName: label, lastName: tag, name: `${label} ${tag}`,
    password: await bcrypt.hash("x", 4), role: role as never, isActive: true, passwordChangedAt: new Date(),
  } });
}

async function run() {
  // Force the mailer into "skip + log" mode before @/lib/email is first loaded
  // (it reads BREVO_API_KEY once at import, which notifyNewLeads triggers).
  process.env.BREVO_API_KEY = "";

  const tag = `N${Date.now().toString().slice(-6)}`;
  const mgrUser = await mkUser(tag, "Mgr", "REGIONAL_MANAGER");
  const icrUser = await mkUser(tag, "Icr", "ICR");
  const mgrEmp = await db.employee.create({ data: { userId: mgrUser.id, employeeId: `${tag}-MGR`, jobTitle: "RM", startDate: new Date() } });
  await db.employee.create({ data: { userId: icrUser.id, employeeId: `${tag}-ICR`, jobTitle: "ICR", startDate: new Date(), managerId: mgrEmp.id } });

  const leadBase = { nationality: "T", countryOfResidence: "T", interestedProgram: "CS", studyLevel: "UNDERGRADUATE" as const, intakeYear: 2027, intakeMonth: 9, createdById: icrUser.id, assignedICRId: icrUser.id };
  const leadIds: string[] = [];

  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      const lead = await db.lead.create({ data: { ...leadBase, firstName: "Cap", lastName: `${tag}${round}`, stage: "NEW_LEAD" } });
      leadIds.push(lead.id);
      await db.notification.deleteMany({ where: { userId: mgrUser.id } });

      // Capture the mailer's skip log.
      const lines: string[] = [];
      const orig = console.log;
      console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
      try {
        await notifyNewLeads({ leadIds: [lead.id], capturedByUserId: icrUser.id });
      } finally {
        console.log = orig;
      }
      const mailLog = lines.filter((l) => l.includes("[email] Skipped")).join("\n");

      expect("owner (ICR) WOULD be emailed", mailLog.includes(icrUser.email), `(log: ${mailLog || "none"})`);
      expect("manager (RM) would NOT be emailed", !mailLog.includes(mgrUser.email), `(log leaked manager: ${mailLog})`);

      // The manager still gets the in-app bell.
      const bell = await db.notification.findFirst({ where: { userId: mgrUser.id, type: "LEAD_CAPTURED" } });
      expect("manager STILL gets the in-app notification (bell kept)", !!bell);
    }
  } finally {
    await db.notification.deleteMany({ where: { userId: { in: [mgrUser.id, icrUser.id] } } }).catch(() => {});
    await db.lead.deleteMany({ where: { id: { in: leadIds } } }).catch(() => {});
    await db.employee.deleteMany({ where: { userId: { in: [mgrUser.id, icrUser.id] } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: [mgrUser.id, icrUser.id] } } }).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
