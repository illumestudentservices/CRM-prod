/**
 * Recruitment-plan approval chain — role gate verification.
 *
 * Pure logic, so it needs no server and no database: canTransition() is
 * evaluated directly for every role against every hop. That makes the whole
 * 11-role matrix checkable in one run, which HTTP probing cannot practically do.
 *
 *   node --import tsx scripts/qa-plan-approval-chain.mjs
 */

const { canTransition, PLAN_TRANSITIONS } = await import("../lib/plan-workflow.ts");

const ROLES = [
  "SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR",
  "INSTITUTION_CLIENT", "HR_MANAGER", "EMPLOYEE", "ACCOUNT_MANAGER",
  "ADMISSIONS_SUPPORT", "VP_GLOBAL_SALES",
];

/** The happy path a plan actually walks, as (from -> to) hops. */
const HAPPY_PATH = [
  ["DRAFT", "SUBMITTED"],
  ["SUBMITTED", "REGIONAL_MANAGER_REVIEW"],
  ["REGIONAL_MANAGER_REVIEW", "ACCOUNT_MANAGER_REVIEW"],
  ["ACCOUNT_MANAGER_REVIEW", "INTERNAL_FINAL_REVIEW"],
  ["INTERNAL_FINAL_REVIEW", "CLIENT_REVIEW"],
  ["CLIENT_REVIEW", "APPROVED"],
];

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; failures.push(label + (detail ? ` -> ${detail}` : "")); console.log(`  FAIL ${label}${detail ? "  " + detail : ""}`); }
}

// ── The chain, as a matrix ───────────────────────────────────────────────
console.log("\n=== Who may perform each hop ===");
for (const [from, to] of HAPPY_PATH) {
  const allowed = ROLES.filter((r) => canTransition(r, from, to).ok);
  console.log(`  ${from} -> ${to}`);
  console.log(`      ${allowed.join(", ") || "(nobody)"}`);
}

// ── The specific bugs this change fixes ──────────────────────────────────
console.log("\n=== Spec §3 role routing ===");
check("ACCOUNT_MANAGER can perform Account Manager Review",
  canTransition("ACCOUNT_MANAGER", "REGIONAL_MANAGER_REVIEW", "ACCOUNT_MANAGER_REVIEW").ok);
check("VP_GLOBAL_SALES can perform Internal Final Review",
  canTransition("VP_GLOBAL_SALES", "ACCOUNT_MANAGER_REVIEW", "INTERNAL_FINAL_REVIEW").ok);
check("HQ_EXECUTIVE is still included in Internal Final Review (spec says 'included in')",
  canTransition("HQ_EXECUTIVE", "ACCOUNT_MANAGER_REVIEW", "INTERNAL_FINAL_REVIEW").ok);
check("REGIONAL_MANAGER still performs the first operational review",
  canTransition("REGIONAL_MANAGER", "SUBMITTED", "REGIONAL_MANAGER_REVIEW").ok);
check("ICR still submits",
  canTransition("ICR", "DRAFT", "SUBMITTED").ok);

console.log("\n=== Segregation of duties ===");
check("HQ_EXECUTIVE can NO LONGER perform Account Manager Review",
  !canTransition("HQ_EXECUTIVE", "REGIONAL_MANAGER_REVIEW", "ACCOUNT_MANAGER_REVIEW").ok);

// The property that matters: no ordinary role may walk a plan end to end.
const soloWalkers = ROLES.filter((r) => HAPPY_PATH.every(([f, t]) => canTransition(r, f, t).ok));
check("Only SUPER_ADMIN can walk the whole chain alone",
  soloWalkers.length === 1 && soloWalkers[0] === "SUPER_ADMIN",
  `walkers = [${soloWalkers.join(", ")}]`);

// And specifically that approving a budget needs two different people.
const amThenApprove = ROLES.filter((r) =>
  r !== "SUPER_ADMIN" &&
  canTransition(r, "REGIONAL_MANAGER_REVIEW", "ACCOUNT_MANAGER_REVIEW").ok &&
  canTransition(r, "CLIENT_REVIEW", "APPROVED").ok);
check("No non-admin role holds both Account Manager Review and final APPROVED",
  amThenApprove.length === 0, `both = [${amThenApprove.join(", ")}]`);

console.log("\n=== Reviewers must be able to return, not only advance ===");
for (const r of ["REGIONAL_MANAGER", "ACCOUNT_MANAGER", "VP_GLOBAL_SALES", "HQ_EXECUTIVE"]) {
  // Find a review state this role can move INTO, then confirm it can also
  // return from that same state. A reviewer that can only push forward is a
  // one-way ratchet.
  const entered = HAPPY_PATH.filter(([f, t]) => canTransition(r, f, t).ok).map(([, t]) => t);
  const reviewStates = entered.filter((s) => PLAN_TRANSITIONS.RETURNED.from.includes(s));
  if (reviewStates.length === 0) { check(`${r}: no review state entered (n/a)`, true); continue; }
  for (const s of reviewStates) {
    check(`${r} can RETURN from ${s}`, canTransition(r, s, "RETURNED").ok);
  }
}

console.log("\n=== Roles with no business here are still excluded ===");
for (const r of ["ICR", "HQ_ANALYTICS", "INSTITUTION_CLIENT", "HR_MANAGER", "EMPLOYEE", "ADMISSIONS_SUPPORT"]) {
  check(`${r} cannot approve a plan`, !canTransition(r, "CLIENT_REVIEW", "APPROVED").ok);
}
check("INSTITUTION_CLIENT cannot perform Account Manager Review",
  !canTransition("INSTITUTION_CLIENT", "REGIONAL_MANAGER_REVIEW", "ACCOUNT_MANAGER_REVIEW").ok);

console.log("\n=== Reviewer identity is recorded ===");
for (const [status, field] of [
  ["REGIONAL_MANAGER_REVIEW", "regionalManagerId"],
  ["ACCOUNT_MANAGER_REVIEW", "accountManagerId"],
  ["INTERNAL_FINAL_REVIEW", "vpReviewerId"],
]) {
  check(`${status} stamps ${field}`, PLAN_TRANSITIONS[status].reviewerField === field,
    `got ${PLAN_TRANSITIONS[status].reviewerField}`);
}

console.log("\n=== Illegal hops still refused ===");
check("cannot skip Account Manager Review", !canTransition("SUPER_ADMIN", "REGIONAL_MANAGER_REVIEW", "INTERNAL_FINAL_REVIEW").ok);
check("cannot jump straight from SUBMITTED to APPROVED", !canTransition("SUPER_ADMIN", "SUBMITTED", "APPROVED").ok);
check("cannot reopen a CLOSED plan", !canTransition("SUPER_ADMIN", "CLOSED", "ACTIVE").ok);

console.log(`\n${"=".repeat(50)}\n  ${pass} passed, ${fail} failed`);
if (failures.length) { console.log("\n  FAILURES:"); failures.forEach((f) => console.log("   - " + f)); }
process.exit(fail === 0 ? 0 : 1);
