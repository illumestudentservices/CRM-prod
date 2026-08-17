/**
 * Forecasting rules: segments, workflow, the ICR/RM split, and derived figures.
 *
 *   node --import tsx --env-file=.env scripts/qa-forecasting.mjs
 *
 * lib/forecasting.ts has no database access, so these are pure assertions about
 * the rules. The one that matters most is spec §13: an RM adjustment must never
 * destroy what the ICR submitted.
 */
import { startSection, expect, ok, fail, summary } from "./qa-lib.mjs";
const F = await import("../lib/forecasting.ts");

const seg = (k, a, d, e, ra = null, rd = null, re_ = null) => ({
  segment: k, icrApplications: a, icrDeposits: d, icrEnrolments: e,
  rmApplications: ra, rmDeposits: rd, rmEnrolments: re_,
});

async function main() {
  startSection("Segments");
  expect(F.FORECAST_SEGMENTS.length === 4, "four segments", String(F.FORECAST_SEGMENTS.length));
  expect(F.FORECAST_SEGMENTS.every((s) => F.SEGMENT_LABELS[s]), "every segment has a label");

  startSection("The RM does not overwrite the ICR (spec 13)");
  {
    const s = seg("DIRECT_UG", 30, 25, 20, null, null, 16);
    const e = F.effectiveValues(s);
    expect(e.enrolments === 16, "*** the RM figure supersedes for planning ***", String(e.enrolments));
    expect(s.icrEnrolments === 20, "*** the ICR figure is still there ***", String(s.icrEnrolments));
    expect(e.applications === 30, "unadjusted fields fall back to the ICR", String(e.applications));
    expect(F.wasAdjusted(s) === true, "the record knows it was adjusted");
  }
  {
    // The case a truthiness check would break: an RM who deliberately says zero.
    const s = seg("DIRECT_PG", 10, 8, 6, null, null, 0);
    expect(F.effectiveValues(s).enrolments === 0,
      "*** an RM adjustment to zero is honoured, not treated as absent ***",
      String(F.effectiveValues(s).enrolments));
  }
  {
    const s = seg("INDIRECT_UG", 5, 4, 3);
    expect(F.wasAdjusted(s) === false, "an untouched segment is not marked adjusted");
    expect(F.effectiveValues(s).enrolments === 3, "and uses the ICR figure");
  }

  startSection("Totals");
  {
    const segs = [seg("DIRECT_UG", 10, 8, 6, null, null, 4), seg("DIRECT_PG", 5, 4, 3)];
    const t = F.totals(segs);
    expect(t.icr.enrolments === 9, "*** the ICR total is preserved ***", String(t.icr.enrolments));
    expect(t.effective.enrolments === 7, "*** the effective total uses the adjustment ***",
      String(t.effective.enrolments));
    expect(t.adjusted === true, "the total records that an adjustment happened");
  }

  startSection("Workflow");
  {
    expect(F.canMove("DRAFT", "SUBMITTED_TO_RM"), "a draft can be submitted");
    expect(!F.canMove("DRAFT", "ACCEPTED"), "*** a draft cannot jump to accepted ***");
    expect(F.canMove("SUBMITTED_TO_RM", "RETURNED_TO_ICR"), "an RM can return it");
    expect(F.canMove("REGIONAL_SUBMITTED", "ACCEPTED"), "a VP can accept a regional submission");
    expect(!F.canMove("ACCEPTED", "DRAFT"), "*** an accepted forecast cannot be reopened ***");
    expect(F.isLocked("ACCEPTED") && F.isLocked("ARCHIVED"), "accepted and archived are locked");
  }

  startSection("Who may act");
  {
    const f = { icrId: "icr-1", regionalManagerId: "rm-1", status: "SUBMITTED_TO_RM" };
    expect(!F.canEditIcrValues(f, "icr-1", "ICR"),
      "*** the ICR cannot edit once submitted ***");
    expect(F.canReview(f, "rm-1", "REGIONAL_MANAGER"), "the RM can review");
    expect(!F.canReview({ ...f, icrId: "rm-1" }, "rm-1", "REGIONAL_MANAGER"),
      "*** an RM cannot review their own forecast ***");
    expect(!F.canAccept(f, "vp-1", "VP_GLOBAL_SALES"),
      "a VP cannot accept before regional submission");
    expect(F.canAccept({ ...f, status: "REGIONAL_SUBMITTED" }, "vp-1", "VP_GLOBAL_SALES"),
      "*** a VP accepts a regional submission ***");
    expect(!F.canAccept({ ...f, status: "REGIONAL_SUBMITTED" }, "rm-1", "REGIONAL_MANAGER"),
      "*** an RM cannot accept ***");
  }

  startSection("Submission gate");
  {
    const good = F.FORECAST_SEGMENTS.map((k) => seg(k, 10, 6, 4));
    expect(F.canSubmit(good, 4, "Strong agent pipeline").ok, "a complete forecast submits");
    expect(!F.canSubmit(good, null, "why").ok, "*** no confidence score blocks submission ***");
    expect(!F.canSubmit(good, 4, "").ok, "*** no rationale blocks submission ***");
    expect(!F.canSubmit(good, 9, "why").ok, "*** a score outside 1-5 is refused ***");
    expect(F.canSubmit(F.FORECAST_SEGMENTS.map((k) => seg(k, 0, 0, 0)), 2, "Nothing viable").ok,
      "*** forecasting zero is a legitimate forecast ***");
    const bad = [seg("DIRECT_UG", 5, 9, 2), ...F.FORECAST_SEGMENTS.slice(1).map((k) => seg(k, 1, 1, 1))];
    expect(!F.canSubmit(bad, 3, "why").ok,
      "*** deposits cannot exceed applications ***");
  }

  startSection("Direction (spec 8)");
  {
    expect(F.direction(21, 25).label === "down", "a drop reads as down");
    expect(F.direction(21, 25).percent === -16, "and reports the percentage", String(F.direction(21, 25).percent));
    expect(F.direction(30, 25).label === "up", "a rise reads as up");
    expect(F.direction(25, 25).label === "flat", "no change reads as flat");
    expect(F.direction(5, null).label === "first", "the first forecast has no direction");
    expect(F.direction(5, 0).percent === null,
      "*** a zero baseline reports no percentage rather than infinity ***",
      String(F.direction(5, 0).percent));
  }

  startSection("Pipeline maturity is not the confidence score (spec 10)");
  {
    const early = F.pipelineMaturity({ activeLeads: 100, qualified: 0, applications: 0, offers: 0, deposits: 0 });
    const mature = F.pipelineMaturity({ activeLeads: 0, qualified: 0, applications: 0, offers: 10, deposits: 90 });
    expect(early === "EARLY_STAGE", "*** raw enquiries are early stage ***", early);
    expect(mature === "HIGH_MATURITY", "*** deposits are high maturity ***", mature);
    expect(F.pipelineMaturity({ activeLeads: 0, qualified: 0, applications: 0, offers: 0, deposits: 0 })
      === "EARLY_STAGE", "an empty pipeline is early stage, not a crash");
  }

  startSection("Accuracy (spec 31)");
  {
    const a = F.accuracy(25, 21);
    expect(a.variance === -4, "variance is actual minus accepted", String(a.variance));
    expect(a.percent === -16, "and a percentage", String(a.percent));
    expect(F.accuracy(0, 3).percent === null, "a zero forecast reports no percentage");
    expect(F.accuracy(10, 10).text.includes("Exactly"), "an exact hit says so");
  }
}

try { await main(); } catch (e) {
  console.error("\n[harness crashed]", e?.message, "\n", e);
  fail("harness crashed", String(e?.message).slice(0, 140));
}
summary();
