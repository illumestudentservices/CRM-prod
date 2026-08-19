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
    const joined = new Date("2022-01-01T00:00:00Z");
    const female = deriveLeaveBalances(joined, [], "FEMALE").map((d) => d.leaveType);
    const male = deriveLeaveBalances(joined, [], "MALE").map((d) => d.leaveType);
    const unset = deriveLeaveBalances(joined, [], null).map((d) => d.leaveType);
    ok(`FEMALE: ${female.join(", ")}`);
    ok(`MALE:   ${male.join(", ")}`);
    ok(`unset:  ${unset.join(", ")}`);

    // Asserted in both directions, so the filter cannot pass by dropping
    // everything — which an over-eager fix would do and a one-sided test would
    // not catch.
    expect(female.includes("MATERNITY") && !female.includes("PATERNITY"),
      "*** FEMALE gets Maternity and not Paternity ***", female.join(", "));
    expect(male.includes("PATERNITY") && !male.includes("MATERNITY"),
      "*** MALE gets Paternity and not Maternity ***", male.join(", "));
    expect(!unset.includes("MATERNITY") && !unset.includes("PATERNITY"),
      "an unrecorded gender gets neither, matching checkGenderEligibility",
      unset.join(", "));
    expect(["VACATION_PAID", "SICK"].every((t) => unset.includes(t)),
      "vacation and sick are unaffected by gender", unset.join(", "));

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
      // Only `balances` — NOT the whole body. The response also carries a
      // `policies` catalogue holding all four policy definitions, which is
      // correct (the UI renders the rules from it) but names every leave type.
      // Grepping the raw body matched that and reported a failure the product
      // did not have.
      const rows = (res.payload?.balances ?? []).filter((b) => b.employeeId);
      const types = [...new Set(rows.map((b) => b.leaveType))];
      ok(`balances rows carry: ${types.join(", ") || "(none)"}`);

      const hasMat = types.includes("MATERNITY");
      const hasPat = types.includes("PATERNITY");
      expect(!(hasMat && hasPat),
        "*** the balances do not offer both parental types to one person ***",
        hasMat && hasPat ? "both returned regardless of gender" : "");
      // This fixture employee was set to FEMALE in section 1.
      expect(hasMat && !hasPat,
        "*** and offer Maternity, the one this employee is entitled to ***",
        types.join(", "));
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
