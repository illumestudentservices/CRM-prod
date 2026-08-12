/**
 * Verifies the route-audit findings over real HTTP, one role at a time.
 *
 * Mutating endpoints are probed with a deliberately INVALID body: a 400 proves
 * the authorisation gate was passed (we reached schema validation) without
 * actually performing the side effect. A 401/403 proves it blocked us. This is
 * how /api/email/send-section is tested without sending mail.
 */
import { createAndLogin, destroyUser, api, db, startSection, expect, summary, failures } from "./qa-lib.mjs";

const ids = {};
async function fixtures() {
  const [lead, report, qbr, interest, otherEmp, task] = await Promise.all([
    db.lead.findFirst({ where: { deletedAt: null }, select: { id: true, firstName: true } }),
    db.monthlyReport.findFirst({ where: { deletedAt: null }, select: { id: true } }),
    db.quarterlyBusinessReview.findFirst({ select: { id: true } }).catch(() => null),
    db.institutionInterest.findFirst({ select: { id: true } }).catch(() => null),
    db.employee.findFirst({ select: { id: true, employeeId: true } }),
    db.task.findFirst({ where: { deletedAt: null }, select: { id: true } }).catch(() => null),
  ]);
  Object.assign(ids, {
    lead: lead?.id, report: report?.id, qbr: qbr?.id,
    interest: interest?.id, otherEmp: otherEmp?.id, task: task?.id,
  });
  console.log("fixtures:", Object.entries(ids).map(([k, v]) => `${k}=${v ? "ok" : "MISSING"}`).join(" "));
}

/** A probe: 'blocked' means 401/403. Anything else means the guard let us in. */
function verdict(status) {
  if (status === 401 || status === 403) return "BLOCKED";
  if (status === 404) return "404 (not found — inconclusive)";
  if (status === 400) return "PASSED GUARD (400 = reached validation)";
  return `PASSED GUARD (${status})`;
}

const results = [];
async function probe({ label, role, jar, method, path, body, shouldBe }) {
  const r = await api(jar, method, path, body);
  const v = verdict(r.status);
  const isHole = shouldBe === "BLOCKED" && !v.startsWith("BLOCKED") && !v.startsWith("404");
  results.push({ label, role, method, path, status: r.status, verdict: v, isHole });
  console.log(`${isHole ? "  ✗ HOLE " : "  · ok   "} [${role}] ${method} ${path} -> ${r.status} ${v}`);
  return r;
}

const ctxs = {};
try {
  await fixtures();
  for (const role of ["EMPLOYEE", "INSTITUTION_CLIENT", "ICR", "HR_MANAGER"]) {
    ctxs[role] = await createAndLogin({ role, withEmployee: true });
    console.log(`logged in: ${role}`);
  }

  startSection("A. POST /api/email/send-section — outbound email, auth-only");
  for (const role of ["EMPLOYEE", "INSTITUTION_CLIENT"])
    await probe({ label: "send-section", role, jar: ctxs[role].jar, method: "POST", path: "/api/email/send-section", body: {}, shouldBe: "BLOCKED" });

  startSection("B. GET /api/hr/assets — auth-only, POST requires HR");
  for (const role of ["EMPLOYEE", "INSTITUTION_CLIENT"])
    await probe({ label: "hr/assets list", role, jar: ctxs[role].jar, method: "GET", path: "/api/hr/assets", shouldBe: "BLOCKED" });

  startSection("C. GET /api/reports/qbr — auth-only, POST requires HQ");
  for (const role of ["EMPLOYEE", "INSTITUTION_CLIENT"])
    await probe({ label: "qbr list", role, jar: ctxs[role].jar, method: "GET", path: "/api/reports/qbr", shouldBe: "BLOCKED" });
  if (ids.qbr) for (const role of ["EMPLOYEE"])
    await probe({ label: "qbr by id", role, jar: ctxs[role].jar, method: "GET", path: `/api/reports/qbr/${ids.qbr}`, shouldBe: "BLOCKED" });

  startSection("D. GET /api/reports/[id]/pdf — INSTITUTION_CLIENT, no tenancy check");
  if (ids.report)
    await probe({ label: "report pdf", role: "INSTITUTION_CLIENT", jar: ctxs.INSTITUTION_CLIENT.jar, method: "GET", path: `/api/reports/${ids.report}/pdf`, shouldBe: "BLOCKED" });

  startSection("E. GET /api/leads/[id]/stage — no permission check (PATCH has one)");
  if (ids.lead) for (const role of ["EMPLOYEE", "INSTITUTION_CLIENT"])
    await probe({ label: "lead stage", role, jar: ctxs[role].jar, method: "GET", path: `/api/leads/${ids.lead}/stage`, shouldBe: "BLOCKED" });

  startSection("F. GET /api/leads/[id]/notes — no canAccessLead");
  if (ids.lead) for (const role of ["INSTITUTION_CLIENT", "ICR"])
    await probe({ label: "lead notes", role, jar: ctxs[role].jar, method: "GET", path: `/api/leads/${ids.lead}/notes`, shouldBe: "BLOCKED" });

  startSection("G. GET /api/institution-interests/[id] — no canAccessLead");
  if (ids.interest)
    await probe({ label: "interest by id", role: "INSTITUTION_CLIENT", jar: ctxs.INSTITUTION_CLIENT.jar, method: "GET", path: `/api/institution-interests/${ids.interest}`, shouldBe: "BLOCKED" });

  startSection("H. ?employeeId= defeats self-scoping on HR reads");
  if (ids.otherEmp) {
    await probe({ label: "attendance of another employee", role: "EMPLOYEE", jar: ctxs.EMPLOYEE.jar, method: "GET", path: `/api/hr/attendance?employeeId=${ids.otherEmp}`, shouldBe: "BLOCKED" });
    await probe({ label: "leave of another employee", role: "EMPLOYEE", jar: ctxs.EMPLOYEE.jar, method: "GET", path: `/api/hr/leave?employeeId=${ids.otherEmp}`, shouldBe: "BLOCKED" });
  }

  startSection("I. GET /api/tasks?scope=all — self-scoping is opt-out");
  {
    const mine = await api(ctxs.EMPLOYEE.jar, "GET", "/api/tasks?scope=mine");
    const all  = await api(ctxs.EMPLOYEE.jar, "GET", "/api/tasks?scope=all");
    const n = (p) => Array.isArray(p) ? p.length : Array.isArray(p?.data) ? p.data.length : "?";
    console.log(`  · EMPLOYEE tasks: scope=mine -> ${mine.status} n=${n(mine.payload)} | scope=all -> ${all.status} n=${n(all.payload)}`);
    results.push({ label: "tasks scope=all widens", role: "EMPLOYEE", method: "GET", path: "/api/tasks?scope=all", status: all.status, verdict: `mine=${n(mine.payload)} all=${n(all.payload)}`, isHole: n(all.payload) !== "?" && n(mine.payload) !== "?" && n(all.payload) > n(mine.payload) });
  }

  startSection("J. POST /api/travel — employeeId from body, no self-check");
  await probe({ label: "travel create", role: "EMPLOYEE", jar: ctxs.EMPLOYEE.jar, method: "POST", path: "/api/travel", body: {}, shouldBe: "PASSED GUARD" });
} catch (e) {
  console.error("HARNESS ERROR:", e.message);
} finally {
  for (const [role, c] of Object.entries(ctxs)) { await destroyUser(c); console.log(`destroyed ${role}`); }
  console.log("\n════ SUMMARY ════");
  const holes = results.filter(r => r.isHole);
  console.log(`probes: ${results.length} | CONFIRMED HOLES: ${holes.length}`);
  for (const h of holes) console.log(`  ✗ [${h.role}] ${h.method} ${h.path} -> ${h.status}`);
  await db.$disconnect(); process.exit(0);
}
