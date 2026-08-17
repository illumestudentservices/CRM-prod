/**
 * Forecasting through the real API: workflow, permissions, and above all that
 * an RM adjustment never destroys the ICR submission (spec section 13).
 *
 *   node --import tsx --env-file=.env scripts/qa-forecasting-api.mjs
 *
 * Three passes, real logged-in users, everything destroyed afterwards.
 */
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG, sleep,
} from "./qa-lib.mjs";
const { FORECAST_SEGMENTS } = await import("../lib/forecasting.ts");

const PASSES = 3;
const allCreated = [];
const made = { forecasts: [], institutions: [] };

async function api(jar, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: jar.header(), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  await sleep(40);
  return { status: res.status, payload };
}

async function runPass(pass) {
  startSection(`PASS ${pass} — forecast lifecycle`);

  const icr = await createAndLogin({ role: "ICR" });
  const rm = await createAndLogin({ role: "REGIONAL_MANAGER" });
  const vp = await createAndLogin({ role: "VP_GLOBAL_SALES" });
  const emp = await createAndLogin({ role: "EMPLOYEE" });
  allCreated.push(icr, rm, vp, emp);

  const inst = await db.institution.create({
    data: {
      name: `${TAG}-p${pass}-Forecast Uni`, country: "Malaysia",
      type: "UNIVERSITY", createdById: rm.user.id,
    },
  });
  made.institutions.push(inst.id);

  const base = {
    periodYear: 2026, periodMonth: 9, institutionId: inst.id, icrId: icr.user.id,
    intakeYear: 2027, intakeMonth: 9, regionalManagerId: rm.user.id,
  };

  expect((await api(emp.jar, "GET", "/api/forecasts")).status === 403,
    "*** a role without the permission is refused ***");

  const created = await api(rm.jar, "POST", "/api/forecasts", base);
  const fid = created.payload?.data?.id;
  expect(created.status === 201 && !!fid, "RM opens a forecast", `status=${created.status}`);
  if (!fid) return teardown(pass, [icr, rm, vp, emp]);
  made.forecasts.push(fid);

  expect(await db.forecastSegment.count({ where: { forecastId: fid } }) === 4,
    "*** all four segments are created up front ***");

  const dup = await api(rm.jar, "POST", "/api/forecasts", base);
  expect(dup.status === 409, "*** a duplicate forecast is refused ***", `status=${dup.status}`);

  // ── ICR enters figures ────────────────────────────────────────────────
  const early = await api(icr.jar, "POST", `/api/forecasts/${fid}/status`, { to: "SUBMITTED_TO_RM" });
  expect(early.status === 422, "*** an empty forecast cannot be submitted ***", `status=${early.status}`);
  expect((early.payload?.reasons ?? []).length > 0, "and the refusal says why");

  const funnel = await api(icr.jar, "PATCH", `/api/forecasts/${fid}/segments`, {
    segment: "DIRECT_UG", applications: 5, deposits: 9, enrolments: 2,
  });
  expect(funnel.status === 422, "*** deposits cannot exceed applications ***", `status=${funnel.status}`);

  for (const s of FORECAST_SEGMENTS) {
    const r = await api(icr.jar, "PATCH", `/api/forecasts/${fid}/segments`, {
      segment: s, applications: 30, deposits: 25, enrolments: 20,
    });
    expect(r.status === 200 && r.payload?.wroteAs === "icr",
      `${s} saved as ICR figures`, String(r.payload?.wroteAs));
  }

  await db.forecast.update({
    where: { id: fid },
    data: { confidenceScore: 4, rationale: `${TAG} strong agent pipeline` },
  });

  const rmEarly = await api(rm.jar, "PATCH", `/api/forecasts/${fid}/segments`, {
    segment: "DIRECT_UG", applications: 1, deposits: 1, enrolments: 1,
  });
  expect(rmEarly.status === 403,
    "*** the RM cannot edit while the ICR still holds it ***", `status=${rmEarly.status}`);

  const sub = await api(icr.jar, "POST", `/api/forecasts/${fid}/status`, { to: "SUBMITTED_TO_RM" });
  expect(sub.status === 200, "ICR submits", `status=${sub.status}`);

  const row = await db.forecast.findUnique({
    where: { id: fid }, select: { pipelineMaturity: true },
  });
  expect(!!row?.pipelineMaturity,
    "*** pipeline maturity is frozen at submission ***", String(row?.pipelineMaturity));

  const icrLate = await api(icr.jar, "PATCH", `/api/forecasts/${fid}/segments`, {
    segment: "DIRECT_UG", applications: 99, deposits: 99, enrolments: 99,
  });
  expect(icrLate.status === 403,
    "*** the ICR cannot edit after submitting ***", `status=${icrLate.status}`);

  // ── The heart of it: RM adjusts, ICR figures survive ───────────────────
  startSection(`PASS ${pass} — spec 13: both judgements are kept`);
  const adj = await api(rm.jar, "PATCH", `/api/forecasts/${fid}/segments`, {
    segment: "DIRECT_UG", applications: 30, deposits: 25, enrolments: 16,
  });
  expect(adj.status === 200 && adj.payload?.wroteAs === "rm", "RM adjusts", String(adj.payload?.wroteAs));

  const seg = await db.forecastSegment.findFirst({
    where: { forecastId: fid, segment: "DIRECT_UG" },
    select: { icrEnrolments: true, rmEnrolments: true },
  });
  expect(seg?.icrEnrolments === 20,
    "*** the ICR 20 is still there after the RM said 16 ***", String(seg?.icrEnrolments));
  expect(seg?.rmEnrolments === 16,
    "*** and the RM 16 is recorded separately ***", String(seg?.rmEnrolments));

  const noWhy = await api(rm.jar, "POST", `/api/forecasts/${fid}/status`, { to: "RM_REVIEWED" });
  expect(noWhy.status === 422,
    "*** adjusting without a reason is refused ***", `status=${noWhy.status}`);

  const rev = await api(rm.jar, "POST", `/api/forecasts/${fid}/status`, {
    to: "RM_REVIEWED", comments: "Four students have outstanding financial documentation.",
  });
  expect(rev.status === 200, "RM reviews with a reason", `status=${rev.status}`);

  // ── VP ────────────────────────────────────────────────────────────────
  const vpEarly = await api(vp.jar, "POST", `/api/forecasts/${fid}/status`, { to: "ACCEPTED" });
  expect(vpEarly.status === 409,
    "*** the VP cannot accept before regional submission ***", `status=${vpEarly.status}`);

  expect(
    (await api(rm.jar, "POST", `/api/forecasts/${fid}/status`, { to: "REGIONAL_SUBMITTED" })).status === 200,
    "RM submits regionally"
  );

  const rmAccept = await api(rm.jar, "POST", `/api/forecasts/${fid}/status`, { to: "ACCEPTED" });
  expect(rmAccept.status === 403,
    "*** an RM cannot accept their own submission ***", `status=${rmAccept.status}`);

  expect(
    (await api(vp.jar, "POST", `/api/forecasts/${fid}/status`, { to: "ACCEPTED" })).status === 200,
    "*** the VP accepts ***"
  );

  const locked = await api(rm.jar, "PATCH", `/api/forecasts/${fid}/segments`, {
    segment: "DIRECT_UG", applications: 1, deposits: 1, enrolments: 1,
  });
  expect(locked.status === 409,
    "*** an accepted forecast cannot be changed ***", `status=${locked.status}`);

  const after = await db.forecastSegment.findFirst({
    where: { forecastId: fid, segment: "DIRECT_UG" },
    select: { icrEnrolments: true, rmEnrolments: true },
  });
  expect(after?.icrEnrolments === 20 && after?.rmEnrolments === 16,
    "*** both judgements survive to the accepted record ***",
    `icr=${after?.icrEnrolments} rm=${after?.rmEnrolments}`);

  expect(await db.forecastEvent.count({ where: { forecastId: fid } }) >= 5,
    "*** the workflow history is retained ***");

  await teardown(pass, [icr, rm, vp, emp]);
}

async function teardown(pass, users) {
  if (made.forecasts.length) {
    await db.forecast.deleteMany({ where: { id: { in: made.forecasts } } }).catch(() => {});
    made.forecasts.length = 0;
  }
  if (made.institutions.length) {
    await db.auditLog.deleteMany({ where: { entityId: { in: made.institutions } } }).catch(() => {});
    await db.institution.deleteMany({ where: { id: { in: made.institutions } } }).catch(() => {});
    made.institutions.length = 0;
  }
  for (const u of users) {
    await destroyUser(u);
    const left = await db.user.count({ where: { id: u.user.id } });
    expect(left === 0, `pass ${pass}: ${u.user.role} deleted`, `${left} remaining`);
    if (left === 0) {
      const i = allCreated.indexOf(u);
      if (i >= 0) allCreated.splice(i, 1);
    }
  }
}

async function main() {
  startSection("Baseline");
  const before = await db.user.count();
  ok(`users=${before}`);
  for (let p = 1; p <= PASSES; p++) await runPass(p);
  startSection("Footprint");
  expect(await db.user.count() === before, "*** user count back to baseline ***");
  expect(await db.forecast.count() === 0, "*** no forecast survived ***");
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.message, "\n", e);
  fail("harness crashed", String(e?.message).slice(0, 140));
} finally {
  await db.forecast.deleteMany({ where: { id: { in: made.forecasts } } }).catch(() => {});
  await db.institution.deleteMany({ where: { id: { in: made.institutions } } }).catch(() => {});
  for (const c of allCreated) await destroyUser(c);
  const leaked = await db.user.count({
    where: { email: { contains: TAG.toLowerCase() } },
  }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leaked}\n`);
  await db.$disconnect();
}
summary();
