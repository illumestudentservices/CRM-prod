/**
 * QA — region-scoped weekly activity report for Regional Managers.
 *
 * Verifies:
 *   1. buildActivityReport({ regionId }) includes ONLY that region's staff and
 *      excludes other regions', with the right per-person state.
 *   2. sendRegionalActivityReports (dry run) groups recipients by region, lists
 *      each region's managers, and skips a manager who has no region assigned.
 *
 * No email is sent (dryRun), so it is safe against the test DB.
 *
 *   npx tsx --env-file=.env.local scripts/qa-regional-activity-report.ts
 */
import { db } from "@/lib/db";
import {
  buildActivityReport,
  sendRegionalActivityReports,
  sendOwnerRegionReports,
} from "@/lib/activity-report";

const AFRICA = "d46440e9-6cc3-4ab8-be49-8eac11f59e81";
const CHINA = "4b339de8-84fb-4a12-9ee0-09dc4a0b3a0e";
const LATAM = "ab39b516-f012-4aef-a427-3973bd6b86f9";

let pass = 0, fail = 0;
function expect(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function run() {
  const tag = "QARA" + Date.now();
  const mkUser = (suffix: string, over: Record<string, unknown>) =>
    db.user.create({
      data: {
        email: `${tag}-${suffix}@ex.local`,
        firstName: suffix,
        lastName: tag,
        name: `${suffix} ${tag}`,
        password: "x",
        role: "ICR",
        isActive: true,
        ...over,
      },
    });

  const rm = await mkUser("rm", { role: "REGIONAL_MANAGER", regionId: AFRICA });
  const worked = await mkUser("worked", { regionId: AFRICA });
  const idle = await mkUser("idle", { regionId: AFRICA });
  const china = await mkUser("china", { regionId: CHINA });
  const latam = await mkUser("latam", { regionId: LATAM });
  const rmNoRegion = await mkUser("rm-noregion", { role: "REGIONAL_MANAGER", regionId: null });
  const userIds = [rm.id, worked.id, idle.id, china.id, latam.id, rmNoRegion.id];

  try {
    // Audit rows inside the 7-day window.
    await db.auditLog.createMany({
      data: [
        { userId: worked.id, action: "LEAD_CREATED", entity: "Lead", entityId: "x" }, // work
        { userId: worked.id, action: "LOGIN", entity: "Auth", entityId: "x" },
        { userId: idle.id, action: "LOGIN", entity: "Auth", entityId: "x" },          // login only
        { userId: china.id, action: "LEAD_CREATED", entity: "Lead", entityId: "x" },  // work, other region
      ],
    });

    // ── 1. Region-scoped build ───────────────────────────────────────────
    const rep = await buildActivityReport(7, new Date(), { regionId: AFRICA, scopeLabel: "Africa" });
    const byId = new Map(rep.people.map((p) => [p.userId, p]));

    expect("scopeLabel is carried through", rep.scopeLabel === "Africa");
    expect("Africa 'worked' user is included", byId.has(worked.id));
    expect("Africa 'idle' user is included", byId.has(idle.id));
    expect("Africa RM is included", byId.has(rm.id));
    expect("China user is EXCLUDED from the Africa report", !byId.has(china.id));
    expect("no-region RM is EXCLUDED from the Africa report", !byId.has(rmNoRegion.id));
    expect("worked user state is WORKED", byId.get(worked.id)?.state === "WORKED",
      `(got ${byId.get(worked.id)?.state})`);
    expect("idle user state is LOGGED_IN", byId.get(idle.id)?.state === "LOGGED_IN",
      `(got ${byId.get(idle.id)?.state})`);
    expect("every person in the report is in Africa",
      rep.people.every((p) => p.userId !== china.id));

    // ── 2. Regional grouping (dry run, no email) ─────────────────────────
    const { results, skippedNoRegion } = await sendRegionalActivityReports({ dryRun: true });
    const africa = results.find((r) => r.regionId === AFRICA);
    expect("Africa appears in the regional results", !!africa);
    expect("our Africa RM is a recipient of the Africa copy",
      !!africa && africa.recipients.includes(rm.email), `(recipients: ${africa?.recipients.join(",")})`);
    expect("Africa report counts at least our 3 seeded Africa staff",
      !!africa && africa.total >= 3, `(total ${africa?.total})`);
    expect("dry run sent nothing", results.every((r) => r.sent === false));
    expect("no-region RM is reported as skipped", skippedNoRegion.includes(rmNoRegion.email));
    expect("no-region RM is NOT a recipient of any region",
      results.every((r) => !r.recipients.includes(rmNoRegion.email)));

    // ── 3. HQ owner spanning several regions (Annie — LATAM + China) ──────
    const owners = await sendOwnerRegionReports({ dryRun: true });
    const annie = owners.find((o) => o.email === "annie@illumestudentservices.ca");
    expect("Annie's owner report is configured", !!annie);
    expect("Annie's report is labelled Latin America & China",
      annie?.label === "Latin America & China");
    expect("Annie's regions both resolve (none missing)",
      !!annie && annie.missingRegions.length === 0, `(missing: ${annie?.missingRegions.join(",")})`);
    expect("Annie's report counts our LATAM + China seed users",
      !!annie && annie.total >= 2, `(total ${annie?.total})`);
    expect("owner dry run sent nothing", owners.every((o) => o.sent === false));

    // Cross-check the span directly: a LATAM+China report includes both and not Africa.
    const span = await buildActivityReport(7, new Date(), {
      regionIds: [LATAM, CHINA],
      scopeLabel: "Latin America & China",
    });
    const spanIds = new Set(span.people.map((p) => p.userId));
    expect("LATAM+China report includes the China user", spanIds.has(china.id));
    expect("LATAM+China report includes the LATAM user", spanIds.has(latam.id));
    expect("LATAM+China report EXCLUDES the Africa 'worked' user", !spanIds.has(worked.id));
  } finally {
    await db.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => {
  console.error("qa-regional-activity-report crashed", e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
