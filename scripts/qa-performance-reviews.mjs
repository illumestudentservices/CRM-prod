/**
 * Does the performance review feature work?
 *
 *   node --import tsx --env-file=.env.local scripts/qa-performance-reviews.mjs
 *
 * Written to find out, not to pass. Several assertions below are expected to
 * FAIL on the current code; each names something found by reading the routes:
 *
 *   1. erp_hr is held only by SUPER_ADMIN, HR_MANAGER and HQ_EXECUTIVE (read).
 *      No HR_MANAGER account exists at Illume, so in practice one person can
 *      write reviews and nobody being reviewed can ever read their own.
 *   2. A manager cannot review their own direct reports.
 *   3. GET is unscoped: whoever can read, reads every review in the company.
 *   4. No validation worth the name — score is parseFloat'd with no range, so
 *      a 97-point or negative score stores happily, and NaN may too.
 *   5. Nothing stops reviewing the same person twice for the same period, or
 *      reviewing yourself.
 *   6. reviewerId is a bare String with no foreign key, resolved by a second
 *      query, so a deleted reviewer becomes "Unknown".
 *   7. The payload uses `include` rather than `select`, so it ships the
 *      employee's home address, phone and emergency contact with every review.
 *
 * A failure here is a finding, not a broken test.
 */
import {
  db, createAndLogin, destroyUser, api,
  startSection, expect, summary, TAG, BASE,
} from "./qa-lib.mjs";

const ctxs = [];
const made = [];
const track = (res) => {
  const id = res?.payload?.review?.id;
  if (id) made.push(id);
  return id;
};

async function main() {
  console.log(`BASE = ${BASE}\n`);

  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(admin);

  // A manager and their direct report.
  const manager = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  ctxs.push(manager);
  const report = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(report);
  await db.employee.update({
    where: { id: report.employee.id },
    data: { managerId: manager.employee.id },
  });

  // Somebody with no connection to either.
  const stranger = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(stranger);

  const mk = (extra = {}) => ({
    employeeId: report.employee.id,
    period: `${TAG} Q4 2026`,
    score: 4.2,
    strengths: "Clear written communication.",
    improvements: "Could delegate more.",
    goals: "Lead one partner review next quarter.",
    ...extra,
  });

  // ── Creating ──────────────────────────────────────────────────────────────
  startSection("Who can write a review");

  const byAdmin = await api(admin.jar, "POST", "/api/hr/performance-reviews", mk());
  expect(byAdmin.status === 201, "a super admin can", `status ${byAdmin.status}`);
  const adminReviewId = track(byAdmin);

  const byManager = await api(manager.jar, "POST", "/api/hr/performance-reviews",
    mk({ period: `${TAG} Q4 2026 mgr` }));
  track(byManager);
  expect(byManager.status === 201,
    "*** a manager can review their own direct report ***",
    `status ${byManager.status}`);

  // Somebody else's report is not theirs to review.
  const notMine = await api(manager.jar, "POST", "/api/hr/performance-reviews",
    mk({ employeeId: stranger.employee.id, period: `${TAG} not mine` }));
  track(notMine);
  expect(notMine.status === 403,
    "*** but NOT somebody outside their team ***", `status ${notMine.status}`);

  const byStranger = await api(stranger.jar, "POST", "/api/hr/performance-reviews",
    mk({ period: `${TAG} nope` }));
  track(byStranger);
  expect(byStranger.status === 403,
    "somebody unrelated cannot", `status ${byStranger.status}`);

  // ── Reading ───────────────────────────────────────────────────────────────
  startSection("Who can read one");

  const mine = await api(report.jar, "GET",
    `/api/hr/performance-reviews?employeeId=${report.employee.id}`);
  const mineRows = mine.payload?.reviews ?? [];
  // Still PENDING at this point, so it must NOT be visible yet.
  expect(!mineRows.some((r) => r.id === adminReviewId),
    "*** a draft review is NOT shown to its subject ***",
    `the subject can read a ${mine.status} draft`);

  const mgrRead = await api(manager.jar, "GET", "/api/hr/performance-reviews");
  expect(mgrRead.status === 200,
    "*** a manager can read reviews ***", `status ${mgrRead.status}`);
  const mgrRows = mgrRead.payload?.reviews ?? [];
  expect(mgrRows.some((r) => r.employee?.id === report.employee.id),
    "and sees their own team's", `${mgrRows.length} row(s)`);
  expect(!mgrRows.some((r) => r.employee?.id === stranger.employee.id),
    "*** but not reviews of people outside their team ***", "a stranger's review leaked");

  const strangerRead = await api(stranger.jar, "GET", "/api/hr/performance-reviews");
  const strangerRows = strangerRead.payload?.reviews ?? [];
  expect(!strangerRows.some((r) => r.id === adminReviewId),
    "*** an unrelated employee does NOT see somebody else's review ***",
    `they saw ${strangerRows.length} review(s)`);

  startSection("The admin feed is scoped to something");
  const all = await api(admin.jar, "GET", "/api/hr/performance-reviews");
  const allRows = all.payload?.reviews ?? [];
  console.log(`     a super admin sees ${allRows.length} review(s) in total`);
  expect(allRows.length > 0, "and can see the ones just written", `${allRows.length}`);

  startSection("A review cannot be reached by id either");
  const byId = await api(stranger.jar, "GET", `/api/hr/performance-reviews/${adminReviewId}`);
  expect(byId.status === 404,
    "*** fetching somebody else's review by id gives 404 ***", `status ${byId.status}`);

  // ── What the payload carries ──────────────────────────────────────────────
  startSection("The payload carries only what a review needs");

  await db.employee.update({
    where: { id: report.employee.id },
    data: {
      address: "17 Privacy Lane, Toronto",
      phone: "+1 555 0199",
      emergencyContact: "Next Of Kin",
      emergencyPhone: "+1 555 0200",
    },
  });
  const again = await api(admin.jar, "GET", "/api/hr/performance-reviews");
  const row = (again.payload?.reviews ?? []).find((r) => r.id === adminReviewId);
  const blob = JSON.stringify(row ?? {});
  expect(!blob.includes("Privacy Lane"),
    "*** the employee's home address is NOT in the review payload ***",
    "the address ships with every review");
  expect(!blob.includes("555 0200"),
    "*** nor their emergency contact number ***",
    "the emergency number ships with every review");

  // ── Validation ────────────────────────────────────────────────────────────
  startSection("Validation");

  const noPeriod = await api(admin.jar, "POST", "/api/hr/performance-reviews",
    { employeeId: report.employee.id });
  track(noPeriod);
  expect(noPeriod.status === 422, "a missing period is rejected", `status ${noPeriod.status}`);

  const huge = await api(admin.jar, "POST", "/api/hr/performance-reviews",
    mk({ period: `${TAG} huge`, score: 97 }));
  track(huge);
  expect(huge.status === 422,
    "*** a score of 97 on a 5-point scale is rejected ***", `status ${huge.status}`);

  const negative = await api(admin.jar, "POST", "/api/hr/performance-reviews",
    mk({ period: `${TAG} neg`, score: -3 }));
  track(negative);
  expect(negative.status === 422,
    "*** a negative score is rejected ***", `status ${negative.status}`);

  const notNumber = await api(admin.jar, "POST", "/api/hr/performance-reviews",
    mk({ period: `${TAG} nan`, score: "banana" }));
  track(notNumber);
  expect(notNumber.status === 422,
    "*** a score that is not a number is rejected ***",
    `status ${notNumber.status} — parseFloat("banana") is NaN`);

  const ghost = await api(admin.jar, "POST", "/api/hr/performance-reviews",
    mk({ employeeId: "00000000-0000-0000-0000-000000000000", period: `${TAG} ghost` }));
  track(ghost);
  expect(ghost.status === 404, "an employee who does not exist is rejected", `status ${ghost.status}`);

  const badStatus = await api(admin.jar, "POST", "/api/hr/performance-reviews",
    mk({ period: `${TAG} badstatus`, status: "BANANA" }));
  track(badStatus);
  expect(badStatus.status === 422,
    "*** an unknown status is rejected rather than stored ***", `status ${badStatus.status}`);

  startSection("The same person, twice, for the same period");
  const dupe = await api(admin.jar, "POST", "/api/hr/performance-reviews", mk());
  track(dupe);
  expect(dupe.status === 409 || dupe.status === 422,
    "*** a second review for the same employee and period is refused ***",
    `status ${dupe.status} — duplicates are allowed`);

  startSection("Reviewing yourself");
  const self = await api(admin.jar, "POST", "/api/hr/performance-reviews",
    mk({ employeeId: admin.employee.id, period: `${TAG} self` }));
  track(self);
  expect(self.status === 422 || self.status === 403,
    "*** you cannot write your own performance review ***",
    `status ${self.status}`);

  // ── Completion ────────────────────────────────────────────────────────────
  startSection("Completing one");

  if (adminReviewId) {
    const done = await api(admin.jar, "PATCH", `/api/hr/performance-reviews/${adminReviewId}`,
      { status: "COMPLETED" });
    expect(done.status === 200, "it can be marked complete", `status ${done.status}`);
    const stored = await db.performanceReview.findUnique({
      where: { id: adminReviewId }, select: { status: true, completedAt: true },
    });
    expect(stored?.status === "COMPLETED", "and the status sticks", `${stored?.status}`);
    expect(!!stored?.completedAt,
      "*** and completedAt is stamped ***",
      `completedAt=${stored?.completedAt}`);

    startSection("Does the employee find out?");
    let notified = 0;
    for (let i = 0; i < 40 && !notified; i++) {
      await new Promise((r) => setTimeout(r, 250));
      notified = await db.notification.count({
        where: { userId: report.user.id, type: "PERFORMANCE_REVIEW" },
      });
    }
    expect(notified > 0,
      "*** the person reviewed is told their review is ready ***",
      "nothing was sent");

    startSection("And now they can read it");
    const nowMine = await api(report.jar, "GET", "/api/hr/performance-reviews");
    const nowRows = nowMine.payload?.reviews ?? [];
    expect(nowRows.some((r) => r.id === adminReviewId),
      "*** once completed, the subject can read their own review ***",
      `${nowRows.length} row(s) visible to them`);
    expect(!nowRows.some((r) => r.employee?.id === stranger.employee.id),
      "and still nobody else's", "a colleague's review leaked");

    startSection("The subject cannot edit it");
    const tamper = await api(report.jar, "PATCH", `/api/hr/performance-reviews/${adminReviewId}`,
      { score: 5, strengths: "Actually I am excellent" });
    expect(tamper.status === 403,
      "*** they cannot rewrite their own appraisal ***", `status ${tamper.status}`);

    startSection("Deleting is an administrator's decision");
    const mgrDelete = await api(manager.jar, "DELETE", `/api/hr/performance-reviews/${adminReviewId}`);
    expect(mgrDelete.status === 403,
      "*** a manager who may write cannot delete ***", `status ${mgrDelete.status}`);
  }

  // ── The reviewer ──────────────────────────────────────────────────────────
  startSection("Who wrote it");
  const withReviewer = (again.payload?.reviews ?? []).find((r) => r.id === adminReviewId);
  expect(withReviewer?.reviewerName && withReviewer.reviewerName !== "Unknown",
    "the review names its reviewer", `reviewerName=${withReviewer?.reviewerName}`);

  startSection("The employee picker behind the form");
  const adminFeed = await api(admin.jar, "GET", "/api/hr/performance-reviews");
  const pickerRows = adminFeed.payload?.reviewable ?? [];
  const activeTotal = await db.employee.count({
    where: { isActive: true, user: { deletedAt: null } },
  });
  expect(pickerRows.length === activeTotal - 1,
    "*** an admin can choose any employee, not the first 50 ***",
    `${pickerRows.length} offered, ${activeTotal} active (minus themselves)`);
  expect(!pickerRows.some((e) => e.id === admin.employee.id),
    "and is not offered themselves", "they could pick themselves");

  const mgrFeed = await api(manager.jar, "GET", "/api/hr/performance-reviews");
  const mgrPicker = mgrFeed.payload?.reviewable ?? [];
  expect(mgrPicker.length === 1 && mgrPicker[0].id === report.employee.id,
    "*** a manager is offered exactly their own direct reports ***",
    `${mgrPicker.length} offered`);

  const empFeed = await api(stranger.jar, "GET", "/api/hr/performance-reviews");
  expect((empFeed.payload?.reviewable ?? []).length === 0,
    "and somebody with no reports is offered nobody",
    `${(empFeed.payload?.reviewable ?? []).length} offered`);
}

let code = 1;
try { await main(); code = summary(); }
catch (e) {
  console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n"));
}
finally {
  startSection("Teardown");
  const ids = [...new Set(made)];
  if (ids.length) {
    const { count } = await db.performanceReview.deleteMany({ where: { id: { in: ids } } });
    console.log(`     removed ${count} review(s)`);
  }
  const strays = await db.performanceReview.deleteMany({
    where: { period: { startsWith: TAG } },
  });
  if (strays.count) console.log(`     removed ${strays.count} stray review(s)`);
  for (const c of ctxs) await destroyUser(c);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
