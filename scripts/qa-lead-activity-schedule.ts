/**
 * Lead follow-up scheduling — TODAY must be allowed to "schedule for later".
 * Regression guard: the API used to reject scheduledFor <= now, so booking a
 * follow-up for today was refused. Now only a date BEFORE the start of today is
 * refused. Covers POST (create) and PATCH (reschedule). (test DB)
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-lead-activity-schedule.ts
 */
import { createAndLogin, destroyUser, api, db } from "./qa-lib.mjs";

// scheduledFor is sent as the form sends it: a date-only value → midnight UTC.
const dayIso = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`).toISOString();
};

let pass = 0, fail = 0;
const expect = (n: string, c: boolean, extra = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${extra}`); }
};

async function main() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  const tag = `las${Date.now().toString().slice(-6)}`;
  const lead = await db.lead.create({
    data: {
      firstName: "Sched", lastName: tag, email: `sched.${tag}@qa.local`, phone: "+1",
      nationality: "QA", countryOfResidence: "QA", interestedProgram: "P", intakeYear: 2027, intakeMonth: 9,
      studyLevel: "UNDERGRADUATE", createdById: admin.user.id, stage: "NEW_LEAD",
    },
  });
  const made: string[] = [];
  const schedule = (scheduledFor: string) =>
    api(admin.jar, "POST", `/api/leads/${lead.id}/activities`, {
      engagementType: "CALL", description: "Follow-up call", scheduledFor,
    });

  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);

      const today = await schedule(dayIso(0));
      expect("TODAY can be scheduled (201)", today.ok && today.status === 201, `HTTP ${today.status} ${JSON.stringify(today.payload)?.slice(0, 140)}`);
      if (today.payload?.activity?.id) made.push(today.payload.activity.id);

      const future = await schedule(dayIso(3));
      expect("future can be scheduled (201)", future.ok, `HTTP ${future.status}`);
      if (future.payload?.activity?.id) made.push(future.payload.activity.id);

      const past = await schedule(dayIso(-1));
      expect("yesterday is refused (422)", past.status === 422, `HTTP ${past.status}`);

      // Reschedule an existing one to TODAY → allowed.
      const target = made[0];
      if (target) {
        const resched = await api(admin.jar, "PATCH", `/api/leads/${lead.id}/activities`, {
          activityId: target, action: "RESCHEDULE", scheduledFor: dayIso(0),
        });
        expect("reschedule to TODAY allowed", resched.ok, `HTTP ${resched.status} ${JSON.stringify(resched.payload)?.slice(0, 120)}`);
        const reschedPast = await api(admin.jar, "PATCH", `/api/leads/${lead.id}/activities`, {
          activityId: target, action: "RESCHEDULE", scheduledFor: dayIso(-2),
        });
        expect("reschedule to a past date refused (422)", reschedPast.status === 422, `HTTP ${reschedPast.status}`);
      }
    }
  } finally {
    await db.leadActivity.deleteMany({ where: { leadId: lead.id } }).catch(() => {});
    await db.lead.delete({ where: { id: lead.id } }).catch(() => {});
    await destroyUser(admin).catch(() => {});
    console.log(`\n  ${pass} passed, ${fail} failed`);
    await db.$disconnect().catch(() => {});
    process.exit(fail === 0 ? 0 : 1);
  }
}
main();
