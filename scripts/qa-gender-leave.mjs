/**
 * Does gender save, and does it filter the parental leave types?
 *
 *   node --env-file=.env.local scripts/qa-gender-leave.mjs
 *
 * Two separate claims, measured separately:
 *
 *   1. STORAGE. PATCH /api/hr/employees/[id] with a gender, read it back from
 *      the database, and confirm it survived. The route validates gender and
 *      lists it among the HR-writable fields, so on paper it should — but the
 *      column is null for every employee on the mirror.
 *
 *   2. DISPLAY. deriveLeaveBalances() in lib/leave-policy.ts maps over all four
 *      LEAVE_TYPES and never consults gender, so every screen built on it
 *      offers Maternity AND Paternity to the same person. The policy table
 *      itself is right (MATERNITY is FEMALE/OTHER, PATERNITY is MALE/OTHER) and
 *      the apply route does call checkGenderEligibility — so the request would
 *      be refused after the employee had already chosen it. Offering a choice
 *      that is then rejected is the bug.
 */
import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, summary, TAG,
} from "./qa-lib.mjs";
// Dynamic import: a static named import from this .ts module does not resolve
// under tsx, which is why the other leave scripts do it this way too.
const { deriveLeaveBalances, checkGenderEligibility, leaveTypesForGender } =
  await import("../lib/leave-policy.ts");

const ctxs = [];

async function main() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  ctxs.push(admin);
  const staff = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(staff);
  const empId = staff.employee.id;

  // ── 1. Storage ──────────────────────────────────────────────────────────
  startSection("Gender is stored");
  {
    const before = await db.employee.findUnique({ where: { id: empId }, select: { gender: true } });
    ok(`starts as ${before.gender ?? "null"}`);

    const res = await api(admin.jar, "PATCH", `/api/hr/employees/${empId}`, {
      gender: "FEMALE",
      // jobTitle is sent alongside because a real save from the edit form sends
      // the whole HR block, not one field — testing gender in isolation would
      // not reproduce what the screen actually does.
      jobTitle: "QA Bot",
    });
    expect(res.status === 200, "PATCH accepts a gender", `status ${res.status} ${JSON.stringify(res.payload).slice(0, 160)}`);

    const after = await db.employee.findUnique({ where: { id: empId }, select: { gender: true } });
    expect(after.gender === "FEMALE",
      "*** the gender is still there when read back from the database ***",
      `stored: ${after.gender ?? "null"}`);
  }

  // ── 2. Does it survive a later save that doesn't mention it? ────────────
  startSection("Gender survives an unrelated edit");
  {
    const res = await api(admin.jar, "PATCH", `/api/hr/employees/${empId}`, { phone: "+15550100" });
    expect(res.status === 200, "PATCH with only a self-field succeeds", `status ${res.status}`);
    const after = await db.employee.findUnique({ where: { id: empId }, select: { gender: true } });
    expect(after.gender === "FEMALE",
      "*** gender is NOT wiped by an edit that never mentioned it ***",
      `stored: ${after.gender ?? "null"}`);
  }

  // ── 3. Display: which leave types is she offered? ───────────────────────
  startSection("Leave types offered match the gender");
  {
    const derived = deriveLeaveBalances(new Date("2022-01-01T00:00:00Z"), []);
    const offered = derived.map((d) => d.leaveType);
    ok(`deriveLeaveBalances returns: ${offered.join(", ")}`);

    expect(!offered.includes("PATERNITY"),
      "*** a FEMALE employee is not offered Paternity ***",
      offered.includes("PATERNITY")
        ? "deriveLeaveBalances takes no gender argument, so every screen shows all four types"
        : "");

    // The policy and the apply route already disagree with the panel.
    const p = checkGenderEligibility("PATERNITY", "FEMALE");
    expect(!p.eligible, "the policy itself refuses Paternity for FEMALE", p.reason ?? "");
    const m = checkGenderEligibility("MATERNITY", "FEMALE");
    expect(m.eligible, "and allows Maternity");
  }

  // ── 4. The live balances endpoint, which is what the panel renders ──────
  startSection("The balances endpoint");
  {
    const res = await api(staff.jar, "GET", "/api/hr/leave/balances");
    if (res.status !== 200) {
      ok(`balances endpoint returned ${res.status}, not comparable`);
    } else {
      const body = JSON.stringify(res.payload);
      const hasMat = /MATERNITY/.test(body), hasPat = /PATERNITY/.test(body);
      ok(`endpoint mentions maternity=${hasMat} paternity=${hasPat}`);
      expect(!(hasMat && hasPat),
        "*** the panel does not offer both parental types at once ***",
        hasMat && hasPat ? "both returned regardless of gender" : "");
    }
  }

  // ── 5. Applying for the wrong one is still refused ──────────────────────
  startSection("Applying is still gated");
  {
    const start = new Date(Date.UTC(new Date().getUTCFullYear(), 11, 1));
    const end = new Date(Date.UTC(new Date().getUTCFullYear(), 11, 5));
    const res = await api(staff.jar, "POST", "/api/hr/leave", {
      leaveType: "PATERNITY",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      reason: `${TAG} gender eligibility probe`,
    });
    expect(res.status >= 400,
      "the server refuses Paternity for a FEMALE employee",
      `status ${res.status} — ${JSON.stringify(res.payload).slice(0, 120)}`);
  }
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message); }
finally {
  startSection("Teardown");
  for (const c of ctxs) await destroyUser(c);
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
