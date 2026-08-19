/**
 * §8 Monthly KPI on the ICR Monthly Report.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-monthly-kpi.mjs
 *
 * The section rolls the Weekly Activity Planner up over the reporting month.
 * Three things matter and each is asserted separately:
 *
 *   1. It sums the right rows — this ICR, this month, weeks 1-4 — and nobody
 *      else's.
 *   2. An UNFILLED planner reports "not entered", not 0%. A rep who did the
 *      work and skipped the spreadsheet must not be reported as having achieved
 *      none of it, because a manager approves that as fact.
 *   3. A MONTHLY-cadence activity is not multiplied by four. One webinar a
 *      month is the target; asking for four would be a different policy.
 */
import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, summary, TAG,
} from "./qa-lib.mjs";

const { computeAutoFilledSections } = await import("../lib/icr-monthly-report.ts");
const { WEEKLY_ACTIVITY_DEFS } = await import("../lib/weekly-activities.ts");

const ctxs = [];
const now = new Date();
const YEAR = now.getUTCFullYear();
const MONTH = now.getUTCMonth() + 1;
const OTHER_MONTH = MONTH === 1 ? 12 : MONTH - 1;

const kpiOf = (rows, type) => rows.find((r) => r.type === type);

async function main() {
  const icr = await createAndLogin({ role: "ICR" });
  ctxs.push(icr);
  const otherIcr = await createAndLogin({ role: "ICR" });
  ctxs.push(otherIcr);

  // ── 1. Nothing entered ──────────────────────────────────────────────────
  startSection("An empty planner reports 'not entered', not zero per cent");
  {
    const s = await computeAutoFilledSections(icr.user.id, YEAR, MONTH);
    expect(s.monthlyKpi.length === 6, "all six mandatory activities appear",
      `${s.monthlyKpi.length} rows`);

    const every = s.monthlyKpi.every((r) => r.entered === false && r.pct === null);
    expect(every, "*** every row is entered=false and pct=null ***",
      s.monthlyKpi.map((r) => `${r.type}:${r.pct}`).join(" "));

    const zeroPct = s.monthlyKpi.filter((r) => r.pct === 0);
    expect(zeroPct.length === 0,
      "*** nothing is reported as 0% achieved ***",
      zeroPct.map((r) => r.type).join(", "));

    // Targets still stand, so the manager can see what was expected.
    const visits = kpiOf(s.monthlyKpi, "AGENT_TRAINING_VISIT");
    expect(visits.target === WEEKLY_ACTIVITY_DEFS.AGENT_TRAINING_VISIT.defaultTarget * 4,
      "a weekly activity's target is the week target × 4", `target ${visits.target}`);
    const webinar = kpiOf(s.monthlyKpi, "MONTHLY_WEBINAR");
    expect(webinar.target === WEEKLY_ACTIVITY_DEFS.MONTHLY_WEBINAR.defaultTarget,
      "*** a monthly activity is NOT multiplied by four ***", `target ${webinar.target}`);
  }

  // ── 2. Rows that should and should not count ────────────────────────────
  startSection("It sums the right rows");
  const planner = [
    // This ICR, this month — should count. 2+3+4+1 = 10 across four weeks.
    { icrId: icr.user.id, year: YEAR, month: MONTH, weekOfMonth: 1, type: "AGENT_TRAINING_VISIT", target: 3, completed: 2, detail: "Uniserv, Studylink" },
    { icrId: icr.user.id, year: YEAR, month: MONTH, weekOfMonth: 2, type: "AGENT_TRAINING_VISIT", target: 3, completed: 3, detail: "Cupa Ghana" },
    { icrId: icr.user.id, year: YEAR, month: MONTH, weekOfMonth: 3, type: "AGENT_TRAINING_VISIT", target: 3, completed: 4, detail: "" },
    { icrId: icr.user.id, year: YEAR, month: MONTH, weekOfMonth: 4, type: "AGENT_TRAINING_VISIT", target: 3, completed: 1, detail: "3M Kenya" },
    // Same ICR, DIFFERENT month — must not count.
    { icrId: icr.user.id, year: YEAR, month: OTHER_MONTH, weekOfMonth: 1, type: "AGENT_TRAINING_VISIT", target: 3, completed: 99, detail: "wrong month" },
    // DIFFERENT ICR, same month — must not count.
    { icrId: otherIcr.user.id, year: YEAR, month: MONTH, weekOfMonth: 1, type: "AGENT_TRAINING_VISIT", target: 3, completed: 77, detail: "wrong rep" },
    // A monthly-cadence activity, hit exactly.
    { icrId: icr.user.id, year: YEAR, month: MONTH, weekOfMonth: 2, type: "MONTHLY_WEBINAR", target: 1, completed: 1, detail: "35 attendees" },
  ];
  for (const row of planner) await db.weeklyActivity.create({ data: row });

  {
    const s = await computeAutoFilledSections(icr.user.id, YEAR, MONTH);
    const visits = kpiOf(s.monthlyKpi, "AGENT_TRAINING_VISIT");

    expect(visits.completed === 10,
      "*** sums only this rep's rows in this month (2+3+4+1 = 10) ***",
      `got ${visits.completed} — 99 would be the other month, 77 the other rep`);
    expect(visits.target === 12, "target sums the four stored weekly targets", `got ${visits.target}`);
    expect(visits.entered === true, "the row is marked as entered");
    expect(visits.pct === 83, "percentage is completed/target rounded (10/12 = 83%)", `got ${visits.pct}`);

    expect(visits.detail.length === 3,
      "detail carries the rep's notes, blanks dropped",
      JSON.stringify(visits.detail));
    expect(visits.detail[0] === "Uniserv, Studylink",
      "and is ordered by week", JSON.stringify(visits.detail));

    const webinar = kpiOf(s.monthlyKpi, "MONTHLY_WEBINAR");
    expect(webinar.pct === 100, "the monthly webinar reads 100%, not 25%", `got ${webinar.pct}`);

    // Untouched activities stay "not entered" even though siblings have data.
    const calls = kpiOf(s.monthlyKpi, "PIPELINE_CALLS");
    expect(calls.entered === false && calls.pct === null,
      "*** an activity with no rows stays 'not entered' ***", `pct ${calls.pct}`);
  }

  // ── 3. It reaches the report and survives a refresh ─────────────────────
  startSection("The snapshot is stored on the report");
  {
    const created = await api(icr.jar, "POST", "/api/icr-reports", {
      reportingMonth: MONTH, reportingYear: YEAR,
    });
    if (created.status !== 201 && created.status !== 200) {
      expect(false, "report created", `status ${created.status} ${JSON.stringify(created.payload).slice(0, 160)}`);
    } else {
      const id = created.payload?.id ?? created.payload?.data?.id;
      expect(!!id, "report created", JSON.stringify(created.payload).slice(0, 120));

      const stored = await db.icrMonthlyReport.findUnique({
        where: { id }, select: { monthlyKpi: true },
      });
      const rows = stored?.monthlyKpi;
      expect(Array.isArray(rows) && rows.length === 6,
        "*** monthlyKpi was persisted with the report ***",
        Array.isArray(rows) ? `${rows.length} rows` : String(rows));

      const v = (rows ?? []).find((r) => r.type === "AGENT_TRAINING_VISIT");
      expect(v?.completed === 10, "and holds the rolled-up figure", `completed ${v?.completed}`);

      // Refresh must not lose it.
      const refreshed = await api(icr.jar, "POST", `/api/icr-reports/${id}/refresh`);
      expect(refreshed.status === 200, "refresh succeeds", `status ${refreshed.status}`);
      const after = await db.icrMonthlyReport.findUnique({
        where: { id }, select: { monthlyKpi: true },
      });
      const v2 = (after?.monthlyKpi ?? []).find((r) => r.type === "AGENT_TRAINING_VISIT");
      expect(v2?.completed === 10, "*** and survives a refresh ***", `completed ${v2?.completed}`);
    }
  }
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally {
  startSection("Teardown");
  for (const c of ctxs) {
    await db.weeklyActivity.deleteMany({ where: { icrId: c.user.id } }).catch(() => {});
    await destroyUser(c);
  }
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
