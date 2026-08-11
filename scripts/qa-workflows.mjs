#!/usr/bin/env node
/**
 * Workflow / state-machine suite.
 *
 * Approval chains are where "it returned 200" is least informative: the
 * interesting question is whether the *illegal* move is refused, and whether
 * the refusal is by role as well as by state. A workflow that lets an ICR
 * approve their own plan is broken even though every request succeeds.
 *
 * Per workflow:
 *   • walk the happy path and assert the persisted status after each hop
 *   • attempt every skip-ahead (DRAFT → APPROVED) and assert 4xx
 *   • attempt each hop as a role that shouldn't own it and assert 4xx
 *   • assert the DB was not mutated by any refused attempt
 */

import {
  db, TAG, api, idOf, createAndLogin, destroyUser,
  startSection, ok, fail, expect, summary,
} from "./qa-lib.mjs";

const created = [];
function track(model, id) { if (id) created.push({ model, id }); }

/** Assert a call is refused AND that the row didn't move. */
async function refuse(label, call, readStatus, expectedStatus) {
  const r = await call();
  if (r.status >= 500) { fail(label, `500`); return; }
  if (r.ok) { fail(label, `ALLOWED — got ${r.status}`); }
  else ok(`${label} → ${r.status}`);
  const actual = await readStatus();
  expect(actual === expectedStatus, `${label}: status unchanged (${expectedStatus})`, `now ${actual}`);
}

async function main() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const icr = await createAndLogin({ role: "ICR", withEmployee: true });
  const rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  const hq = await createAndLogin({ role: "HQ_EXECUTIVE", withEmployee: true });
  const employee = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  process.stdout.write(`[setup] 5 role sessions\n`);

  const inst = await db.institution.findFirst({ where: { deletedAt: null }, select: { id: true } });

  try {
    // ══════════════════════════════════════════════════════════════════
    startSection("Recruitment plan approval chain");
    {
      const plan = await db.quarterlyRecruitmentPlan.create({
        data: {
          icrId: icr.user.id, institutionId: inst?.id ?? null,
          quarter: 1, year: 2030, reportingCurrency: "USD", status: "DRAFT",
        },
      });
      track("quarterlyRecruitmentPlan", plan.id);
      const readStatus = async () =>
        (await db.quarterlyRecruitmentPlan.findUnique({ where: { id: plan.id }, select: { status: true } }))?.status;

      const transition = (session, toStatus) => () =>
        api(session.jar, "POST", `/api/recruitment-planning/plans/${plan.id}/transition`, { toStatus });

      // — illegal skip-ahead from DRAFT —
      await refuse("DRAFT → APPROVED (skips whole chain)", transition(admin, "APPROVED"), readStatus, "DRAFT");
      await refuse("DRAFT → COMPLETED (skips whole chain)", transition(admin, "COMPLETED"), readStatus, "DRAFT");
      await refuse("DRAFT → CLIENT_REVIEW (skips review)", transition(admin, "CLIENT_REVIEW"), readStatus, "DRAFT");

      // — wrong role for the legal first hop —
      await refuse("EMPLOYEE cannot submit a plan", transition(employee, "SUBMITTED"), readStatus, "DRAFT");

      // — happy path —
      const hops = [
        [icr, "SUBMITTED", "ICR submits"],
        [rm, "REGIONAL_MANAGER_REVIEW", "RM takes for review"],
        [hq, "ACCOUNT_MANAGER_REVIEW", "HQ sends to AM review"],
        [hq, "INTERNAL_FINAL_REVIEW", "HQ sends to internal final"],
        [hq, "APPROVED", "HQ approves"],
      ];
      for (const [session, toStatus, label] of hops) {
        const r = await api(session.jar, "POST", `/api/recruitment-planning/plans/${plan.id}/transition`, { toStatus });
        if (!expect(r.ok, `${label} → ${toStatus}`, `got ${r.status} ${JSON.stringify(r.payload)?.slice(0, 120)}`)) break;
        const now = await readStatus();
        expect(now === toStatus, `persisted status = ${toStatus}`, `got ${now}`);
      }

      // — once APPROVED, the plan is locked for scope edits —
      await refuse("APPROVED → SUBMITTED (cannot reopen)", transition(icr, "SUBMITTED"), readStatus, "APPROVED");

      // — spec §7: approval generates planned field activities —
      const pfa = await db.plannedFieldActivity.count({ where: { planId: plan.id } });
      expect(pfa > 0, "APPROVED generated PlannedFieldActivity rows (spec §7)", `count=${pfa}`);

      // — variation request is the sanctioned way to change a locked plan —
      const vr = await api(icr.jar, "POST", `/api/recruitment-planning/plans/${plan.id}/variations`, {
        type: "INCREASE_BUDGET", reason: `${TAG} needs more budget`, incrementalCost: 500,
      });
      if (expect(vr.ok || vr.status === 201, "ICR can raise a variation on a locked plan", `got ${vr.status}`)) {
        const vid = idOf(vr.payload);
        track("variationRequest", vid);
        // ICR must not approve their own variation
        const selfApprove = await api(icr.jar, "POST", `/api/recruitment-planning/variations/${vid}/approve`, {
          decision: "APPROVED",
        });
        if (selfApprove.ok) fail("ICR approved their own variation", "should be HQ/admin only");
        else ok(`ICR cannot approve own variation → ${selfApprove.status}`);

        const hqApprove = await api(hq.jar, "POST", `/api/recruitment-planning/variations/${vid}/approve`, {
          decision: "APPROVED",
        });
        expect(hqApprove.ok, "HQ_EXECUTIVE can approve the variation", `got ${hqApprove.status}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Monthly report approval chain");
    {
      if (!inst) { fail("report setup", "no institution"); }
      else {
        const report = await db.monthlyReport.create({
          data: {
            icrId: icr.user.id, institutionId: inst.id,
            reportingMonth: 6, reportingYear: 2030, status: "DRAFT",
          },
        });
        track("monthlyReport", report.id);
        const readStatus = async () =>
          (await db.monthlyReport.findUnique({ where: { id: report.id }, select: { status: true } }))?.status;

        // The route is PATCH, matching what the report editor sends.
        const act = (session, action) => () =>
          api(session.jar, "PATCH", `/api/reports/${report.id}/approve`, { action });

        // — cannot approve a DRAFT: it hasn't been submitted —
        await refuse("APPROVE while DRAFT", act(rm, "APPROVE"), readStatus, "DRAFT");
        // — only the owning ICR may submit —
        await refuse("non-owner submits", act(rm, "SUBMIT"), readStatus, "DRAFT");
        await refuse("EMPLOYEE submits", act(employee, "SUBMIT"), readStatus, "DRAFT");

        // — owner submits —
        const sub = await api(icr.jar, "PATCH", `/api/reports/${report.id}/approve`, { action: "SUBMIT" });
        expect(sub.ok, "owning ICR submits", `got ${sub.status} ${JSON.stringify(sub.payload)?.slice(0,120)}`);
        expect(await readStatus() === "PENDING_REVIEW", "status → PENDING_REVIEW");

        // — ICR must not approve their own report —
        await refuse("ICR approves own report", act(icr, "APPROVE"), readStatus, "PENDING_REVIEW");
        await refuse("EMPLOYEE approves report", act(employee, "APPROVE"), readStatus, "PENDING_REVIEW");

        // — RM approves (SUPER_ADMIN stands in if region mismatch blocks the RM) —
        let appr = await api(rm.jar, "PATCH", `/api/reports/${report.id}/approve`, { action: "APPROVE" });
        if (!appr.ok) {
          // RM is region-scoped; the disposable RM has no region, so fall back
          // to SUPER_ADMIN which the route also permits.
          appr = await api(admin.jar, "PATCH", `/api/reports/${report.id}/approve`, { action: "APPROVE" });
        }
        expect(appr.ok, "approver moves report to approved", `got ${appr.status}`);
        expect(await readStatus() === "FINAL_APPROVED", "status → FINAL_APPROVED", `got ${await readStatus()}`);

        // — cannot re-submit an approved report —
        await refuse("SUBMIT an approved report", act(icr, "SUBMIT"), readStatus, "FINAL_APPROVED");
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Lead stage gates");
    {
      const lead = await api(admin.jar, "POST", "/api/leads", {
        firstName: `${TAG}W`, lastName: "Flow",
        email: `${TAG.toLowerCase()}.flow@example.test`, phone: "+15550009999",
        nationality: "T", countryOfResidence: "T",
        interestedProgram: "P", studyLevel: "UNDERGRADUATE",
        intakeYear: 2030, intakeMonth: 9,
        assignedICRId: icr.user.id,
      });
      const leadId = idOf(lead.payload);
      track("lead", leadId);

      if (leadId) {
        const readStage = async () =>
          (await db.lead.findUnique({ where: { id: leadId }, select: { stage: true } }))?.stage;

        expect(await readStage() === "NEW_LEAD", "new lead starts at NEW_LEAD");

        // Jumping straight to ENROLLED must be gated — a lead cannot enrol
        // without an application, offer and deposit behind it.
        const jump = await api(admin.jar, "PATCH", `/api/leads/${leadId}/stage`, { stage: "ENROLLED" });
        if (jump.ok) {
          fail("NEW_LEAD → ENROLLED allowed", "stage gates not enforced");
        } else {
          ok(`NEW_LEAD → ENROLLED gated → ${jump.status}`);
          expect(await readStage() === "NEW_LEAD", "stage unchanged after gated attempt");
        }

        // A one-step advance should either pass or report specific blockers —
        // never a 500.
        const step = await api(admin.jar, "PATCH", `/api/leads/${leadId}/stage`, { stage: "CONTACTED" });
        if (step.status >= 500) fail("NEW_LEAD → CONTACTED", "500");
        else ok(`NEW_LEAD → CONTACTED → ${step.status}`);

        // An unrelated ICR must not move someone else's lead.
        const other = await createAndLogin({ role: "ICR", withEmployee: true });
        try {
          const stolen = await api(other.jar, "PATCH", `/api/leads/${leadId}/stage`, { stage: "QUALIFIED" });
          if (stolen.ok) fail("unrelated ICR moved another ICR's lead", "ownership not enforced");
          else ok(`unrelated ICR cannot move the lead → ${stolen.status}`);
        } finally {
          await destroyUser(other);
        }

        // Bogus stage value must be 4xx, not 500.
        const bogus = await api(admin.jar, "PATCH", `/api/leads/${leadId}/stage`, { stage: "NOT_A_STAGE" });
        if (bogus.status >= 500) fail("bogus stage value", "500");
        else ok(`bogus stage value → ${bogus.status}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Client issue lifecycle");
    {
      if (inst) {
        const issue = await api(admin.jar, "POST", `/api/institutions/${inst.id}/issues`, {
          title: `${TAG} Issue`, category: "SERVICE_DELIVERY",
          severity: "HIGH", ownerId: admin.user.id,
        });
        if (expect(issue.ok || issue.status === 201, "create issue", `got ${issue.status}`)) {
          const iid = idOf(issue.payload);
          track("clientIssue", iid);
          const row = await db.clientIssue.findUnique({ where: { id: iid } });
          expect(row?.status === "OPEN", "issue opens in OPEN", `got ${row?.status}`);

          const upd = await api(admin.jar, "PATCH", `/api/institutions/${inst.id}/issues/${iid}`, {
            status: "RESOLVED", resolutionNotes: `${TAG} resolved`,
          });
          expect(upd.ok, "resolve issue → 2xx", `got ${upd.status}`);
          const after = await db.clientIssue.findUnique({ where: { id: iid } });
          expect(after?.status === "RESOLVED", "status persisted as RESOLVED", `got ${after?.status}`);
          expect(after?.resolvedAt != null, "resolvedAt stamped on resolve");

          // Bogus status must not 500
          const bogus = await api(admin.jar, "PATCH", `/api/institutions/${inst.id}/issues/${iid}`, {
            status: "NOT_A_STATUS",
          });
          if (bogus.status >= 500) fail("bogus issue status", "500");
          else ok(`bogus issue status → ${bogus.status}`);
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Market suggestion review");
    {
      const market = await db.market.findFirst({ select: { id: true } })
        ?? await db.market.create({
          data: {
            name: `${TAG}_Market`, code: `${TAG.slice(0, 6)}`,
            politicalRiskLevel: "LOW", isActive: true, createdById: admin.user.id,
          },
        }).then((m) => { track("market", m.id); return m; });

      const sug = await api(icr.jar, "POST", "/api/market-intelligence/suggestions", {
        marketId: market.id, kind: "VISA_CHANGE",
        originalText: `${TAG} visa rules changed`,
      });
      if (expect(sug.ok || sug.status === 201, "ICR submits a suggestion", `got ${sug.status}`)) {
        const sid = idOf(sug.payload);
        track("marketUpdateSuggestion", sid);
        const row = await db.marketUpdateSuggestion.findUnique({ where: { id: sid } });
        expect(row?.status === "PENDING", "suggestion starts PENDING", `got ${row?.status}`);

        // The submitter must not review their own suggestion.
        const self = await api(icr.jar, "POST", `/api/market-intelligence/suggestions/${sid}/review`, {
          decision: "APPROVED",
        });
        if (self.ok) {
          const after = await db.marketUpdateSuggestion.findUnique({ where: { id: sid } });
          if (after?.status === "APPROVED") fail("ICR approved their own suggestion", "no separation of duties");
          else ok("self-review had no effect");
        } else {
          ok(`ICR cannot review own suggestion → ${self.status}`);
        }

        // RM reviews it.
        const review = await api(rm.jar, "POST", `/api/market-intelligence/suggestions/${sid}/review`, {
          decision: "APPROVED", reviewNotes: `${TAG} ok`,
        });
        expect(review.ok, "RM reviews the suggestion", `got ${review.status}`);
        const reviewed = await db.marketUpdateSuggestion.findUnique({ where: { id: sid } });
        expect(reviewed?.status === "APPROVED", "status → APPROVED", `got ${reviewed?.status}`);

        // Re-reviewing an already-decided suggestion should be refused.
        const again = await api(rm.jar, "POST", `/api/market-intelligence/suggestions/${sid}/review`, {
          decision: "REJECTED",
        });
        if (again.status >= 500) fail("re-review", "500");
        else ok(`re-review of a decided suggestion → ${again.status}`);
      }
    }

  } finally {
    process.stdout.write(`\n[cleanup]\n`);
    const order = [
      "marketUpdateSuggestion", "clientIssue", "variationRequest",
      "monthlyReport", "quarterlyRecruitmentPlan", "lead", "market",
    ];
    for (const model of order) {
      for (const c of created.filter((x) => x.model === model)) {
        try { await db[model].delete({ where: { id: c.id } }); } catch { /* cascaded */ }
      }
    }
    await db.$executeRawUnsafe(`DELETE FROM leads WHERE "firstName" LIKE '${TAG}%'`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM client_issues WHERE title LIKE '${TAG}%'`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM markets WHERE name LIKE '${TAG}%'`).catch(() => {});
    for (const s of [admin, icr, rm, hq, employee]) await destroyUser(s);
    process.stdout.write(`[cleanup] done\n`);
  }

  const f = summary();
  process.exit(f > 0 ? 1 : 0);
}

main().catch((e) => { console.error("\nHARNESS ERROR:", e); process.exit(2); })
  .finally(() => db.$disconnect());
