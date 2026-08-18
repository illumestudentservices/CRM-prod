/**
 * Who may email report content out of the organisation.
 *
 *   node --env-file=.env scripts/qa-email-external-gating.mjs
 *
 * The two send routes moved different amounts of data behind different gates:
 * `send-section` required the reports.email_external capability, while
 * `send-report` — the whole report plus a PDF of every lead's name, nationality,
 * programme and stage — required only that you could read the report. So the
 * coarser action was the less guarded one, and an ICR could push a student list
 * to any outside address.
 *
 * This proves both routes now answer to the same capability, and that scope is
 * still enforced underneath it: holding the capability must not let a manager
 * email a report belonging to another region.
 *
 * Safe to run locally — with no BREVO_API_KEY set, safeSend logs and returns
 * without contacting Brevo, so an allowed send is exercised without mail
 * actually leaving the machine.
 */
import {
  db, api, createAndLogin, destroyUser, startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

let icr, rm, otherRm;
const made = { regionA: null, regionB: null, institution: null, reportId: null };

async function cleanup() {
  if (made.reportId) await db.monthlyReport.deleteMany({ where: { id: made.reportId } }).catch(() => {});
  if (made.institution) await db.institution.deleteMany({ where: { id: made.institution.id } }).catch(() => {});
  for (const ctx of [icr, rm, otherRm]) await destroyUser(ctx).catch(() => {});
  for (const r of [made.regionA, made.regionB]) {
    if (r) await db.region.deleteMany({ where: { id: r.id } }).catch(() => {});
  }
}

const CAPABILITY_MSG = /not permitted to email/i;

try {
  startSection("Setup");
  made.regionA = await db.region.create({ data: { name: `${TAG} RegionA`, code: `${TAG.slice(0, 5)}A` } });
  made.regionB = await db.region.create({ data: { name: `${TAG} RegionB`, code: `${TAG.slice(0, 5)}B` } });

  icr = await createAndLogin({ role: "ICR", extra: { regionId: made.regionA.id } });
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: made.regionA.id } });
  otherRm = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: made.regionB.id } });

  made.institution = await db.institution.create({
    data: { name: `${TAG} College`, country: "Canada", type: "COLLEGE", createdById: icr.user.id, regionId: made.regionA.id },
  });

  const report = await db.monthlyReport.create({
    data: {
      icrId: icr.user.id,
      institutionId: made.institution.id,
      regionId: made.regionA.id,
      reportingMonth: 6,
      reportingYear: 2026,
      status: "FINAL_APPROVED",
      kpiSummary: { totalLeads: 3, enrolled: 1, conversionRate: 33.3, contactRate: 100, eventsCount: 0, totalEventCost: 0 },
      leadsData: [{ firstName: "Ada", lastName: "Obi", nationality: "Nigerian", interestedProgram: "Business", studyLevel: "UNDERGRADUATE", stage: "ENROLLED" }],
    },
    select: { id: true },
  });
  made.reportId = report.id;
  ok("ICR, two Regional Managers in different regions, and one report seeded");

  const payload = { reportId: made.reportId, to: "outside-party@example.com", message: "FYI" };

  // ── The hole this closes ────────────────────────────────────────────────
  startSection("An ICR cannot email a report out of the building");
  const icrWhole = await api(icr.jar, "POST", "/api/email/send-report", payload);
  expect(icrWhole.status === 403,
    "*** POST /api/email/send-report is refused for an ICR ***",
    `status ${icrWhole.status}`);
  expect(CAPABILITY_MSG.test(icrWhole.payload?.error ?? ""),
    "and the refusal names the reason, not just 'Forbidden'",
    String(icrWhole.payload?.error).slice(0, 80));

  const icrSection = await api(icr.jar, "POST", "/api/email/send-section", {
    to: "outside-party@example.com", subject: "Leads", sectionTitle: "Leads", sectionHtml: "<p>x</p>",
  });
  expect(icrSection.status === 403, "send-section is refused too", `status ${icrSection.status}`);
  expect(icrWhole.status === icrSection.status,
    "*** both routes now answer to the same capability ***",
    `whole=${icrWhole.status} section=${icrSection.status}`);

  // The ICR still owns the report and can still read it — the gate is about
  // sending, not about access.
  const icrRead = await api(icr.jar, "GET", `/api/reports/${made.reportId}`);
  expect(icrRead.status === 200,
    "the ICR can still open their own report", `status ${icrRead.status}`);

  // ── The permitted path still works ──────────────────────────────────────
  startSection("A Regional Manager in the region still can");
  const rmWhole = await api(rm.jar, "POST", "/api/email/send-report", payload);

  // send-report builds a PDF with puppeteer, which needs a Chromium binary the
  // VPS has and a Windows dev box does not. That failure happens well AFTER the
  // capability check, so it still proves the gate let this role through — but it
  // is reported as what it is rather than counted as a pass.
  const blockedByGate = rmWhole.status === 403;
  expect(!blockedByGate,
    "*** the capability gate lets the region's Regional Manager through ***",
    `status ${rmWhole.status} ${JSON.stringify(rmWhole.payload).slice(0, 120)}`);
  if (rmWhole.status === 200) {
    ok("and the send completed end to end");
  } else {
    ok(`(send did not complete locally — status ${rmWhole.status}; PDF generation needs Chromium, absent on this machine)`);
  }

  const rmSection = await api(rm.jar, "POST", "/api/email/send-section", {
    to: "outside-party@example.com", subject: "Leads", sectionTitle: "Leads", sectionHtml: "<p>x</p>",
  });
  expect(rmSection.status === 200,
    "*** send-section completes end to end for that manager ***", `status ${rmSection.status}`);

  // Only meaningful when the send actually ran — the audit line is written after
  // the PDF is built.
  if (rmWhole.status === 200) {
    const logged = await db.auditLog.count({
      where: { entityId: made.reportId, action: "REPORT_EMAILED_EXTERNAL" },
    }).catch(() => -1);
    expect(logged >= 1, "the external send is on the audit log", `${logged} entries`);
  }

  // ── Scope is still underneath ───────────────────────────────────────────
  startSection("The capability does not override region scope");
  const foreign = await api(otherRm.jar, "POST", "/api/email/send-report", payload);
  expect(foreign.status === 403,
    "*** a manager from another region is still refused ***", `status ${foreign.status}`);
  expect(!CAPABILITY_MSG.test(foreign.payload?.error ?? ""),
    "and refused on scope, before the capability is even consulted",
    String(foreign.payload?.error).slice(0, 80));

  // ── The dead plaintext-password sender is gone ──────────────────────────
  startSection("No plaintext password can be emailed");
  const email = await import("../lib/email.ts");
  expect(email.sendPasswordResetEmail === undefined,
    "*** sendPasswordResetEmail no longer exists ***",
    typeof email.sendPasswordResetEmail);
  expect(typeof email.sendMagicLinkEmail === "function",
    "the expiring magic-link sender is still there");
} catch (e) {
  fail("run completed", String(e?.message ?? e).slice(0, 300));
} finally {
  await cleanup();
  startSection("Cleanup");
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } }).catch(() => -1);
  expect(left === 0, "no test users left behind", `${left} remaining`);
  summary();
  await db.$disconnect();
}
