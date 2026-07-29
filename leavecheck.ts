import {
  LEAVE_POLICIES,
  computeAccrual,
  checkGenderEligibility,
  leaveTypesForGender,
} from "./lib/leave-policy";

let pass = 0, fail = 0;
const ck = (l: string, c: boolean, d = "") => {
  c ? pass++ : fail++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`);
};
const D = (s: string) => new Date(s + "T00:00:00.000Z");
const acc = (t: keyof typeof LEAVE_POLICIES, doj: string, asOf: string) =>
  computeAccrual(LEAVE_POLICIES[t], D(doj), D(asOf));

console.log("VACATION (PAID) - 3mo wait, 1.75/mo on joining date, cap 21");
ck("nothing during the waiting period", acc("VACATION_PAID", "2026-01-15", "2026-04-14").accruedDays === 0);
ck("first credit lands ON the 3-month date", acc("VACATION_PAID", "2026-01-15", "2026-04-15").accruedDays === 1.75);
ck("three credits by 15 June", acc("VACATION_PAID", "2026-01-15", "2026-06-15").accruedDays === 5.25,
   `${acc("VACATION_PAID", "2026-01-15", "2026-06-15").accruedDays}`);
{
  const r = acc("VACATION_PAID", "2025-01-15", "2026-12-31");
  ck("caps at 21 in a full year", r.accruedDays === 21, `${r.accruedDays}`);
  ck("no next accrual once capped", r.nextAccrualOn === null);
}
// The balance genuinely is zero on 1 January: it resets on 31 December and the
// next credit lands on the joining-day anniversary, not on New Year's Day.
ck("balance is zero on 1 January after the reset",
   acc("VACATION_PAID", "2025-01-15", "2026-01-01").accruedDays === 0);
ck("first credit of the new year lands on the joining day",
   acc("VACATION_PAID", "2025-01-15", "2026-01-15").accruedDays === 1.75,
   `${acc("VACATION_PAID", "2025-01-15", "2026-01-15").accruedDays} on 15 Jan`);
ck("31 Jan joiner accrues on 30 Apr, not 1 May",
   acc("VACATION_PAID", "2026-01-31", "2026-04-30").accruedDays === 1.75);

console.log("\nSICK - 5 DAY wait, 5 days yearly on 1 Jan, prorated first period");
ck("nothing on day 4", acc("SICK", "2026-03-01", "2026-03-05").accruedDays === 0);
ck("available on day 5", acc("SICK", "2026-03-01", "2026-03-06").accruedDays > 0);
{
  const r = acc("SICK", "2026-08-01", "2026-09-01");
  // eligible 6 Aug -> Aug..Dec = 5 of 12 months -> 5 * 5/12 = 2.08 -> 2.0
  ck("Aug joiner prorated to 5/12 of the year", r.accruedDays === 2, `${r.accruedDays} days, prorated=${r.prorated}`);
}
ck("full 5 days in a later full year", acc("SICK", "2026-08-01", "2027-06-01").accruedDays === 5,
   `${acc("SICK", "2026-08-01", "2027-06-01").accruedDays}`);
ck("Jan joiner gets the full grant", acc("SICK", "2026-01-02", "2026-06-01").accruedDays === 5,
   `${acc("SICK", "2026-01-02", "2026-06-01").accruedDays}`);

console.log("\nMATERNITY - 1mo wait, 22 days yearly, NOT prorated");
ck("nothing before 1 month", acc("MATERNITY", "2026-03-01", "2026-03-31").accruedDays === 0);
{
  const r = acc("MATERNITY", "2026-11-01", "2026-12-15");
  ck("Nov joiner still gets the full 22", r.accruedDays === 22, `${r.accruedDays}, prorated=${r.prorated}`);
  ck("flagged as not prorated", r.prorated === false);
}
ck("full 22 in a later year", acc("MATERNITY", "2026-11-01", "2027-06-01").accruedDays === 22);

console.log("\nPATERNITY - 1mo wait, 10 days yearly, prorated first period");
ck("nothing before 1 month", acc("PATERNITY", "2026-03-01", "2026-03-31").accruedDays === 0);
{
  const r = acc("PATERNITY", "2026-08-01", "2026-10-01");
  // eligible 1 Sep -> Sep..Dec = 4 of 12 -> 10 * 4/12 = 3.33 -> 3.5
  ck("Sep-eligible prorated to 4/12", r.accruedDays === 3.5, `${r.accruedDays}, prorated=${r.prorated}`);
}
ck("full 10 in a later year", acc("PATERNITY", "2026-08-01", "2027-06-01").accruedDays === 10);

console.log("\nGENDER GATING");
ck("maternity: female yes", checkGenderEligibility("MATERNITY", "FEMALE").eligible);
ck("maternity: male no", !checkGenderEligibility("MATERNITY", "MALE").eligible);
ck("maternity: other yes", checkGenderEligibility("MATERNITY", "OTHER").eligible);
ck("paternity: male yes", checkGenderEligibility("PATERNITY", "MALE").eligible);
ck("paternity: female no", !checkGenderEligibility("PATERNITY", "FEMALE").eligible);
ck("paternity: other yes", checkGenderEligibility("PATERNITY", "OTHER").eligible);
ck("null gender BLOCKS maternity", !checkGenderEligibility("MATERNITY", null).eligible);
ck("null gender BLOCKS paternity", !checkGenderEligibility("PATERNITY", null).eligible);
ck("null gender still allows sick", checkGenderEligibility("SICK", null).eligible);
ck("null gender still allows vacation", checkGenderEligibility("VACATION_PAID", null).eligible);
ck("blocked message names the fix",
   /ask hr/i.test(checkGenderEligibility("MATERNITY", null).reason ?? ""),
   checkGenderEligibility("MATERNITY", null).reason?.slice(0, 60));

ck("female sees 3 types", leaveTypesForGender("FEMALE").join(",") === "VACATION_PAID,SICK,MATERNITY",
   leaveTypesForGender("FEMALE").join(","));
ck("male sees 3 types", leaveTypesForGender("MALE").join(",") === "VACATION_PAID,SICK,PATERNITY",
   leaveTypesForGender("MALE").join(","));
ck("other sees all 4", leaveTypesForGender("OTHER").length === 4, leaveTypesForGender("OTHER").join(","));
ck("unset gender sees only the 2 open types", leaveTypesForGender(null).join(",") === "VACATION_PAID,SICK",
   leaveTypesForGender(null).join(","));

console.log("\nPOLICY MATCHES THE SUPPLIED SCREENS");
const p = LEAVE_POLICIES;
ck("vacation: 3 months / 1.75 monthly / cap 21",
   p.VACATION_PAID.waitingPeriod.value === 3 && p.VACATION_PAID.waitingPeriod.unit === "months" &&
   p.VACATION_PAID.accrual.mode === "MONTHLY_ON_JOINING" && p.VACATION_PAID.accrual.days === 1.75 &&
   p.VACATION_PAID.maxBalance === 21);
ck("sick: 5 days / 5 yearly 1 Jan / prorated",
   p.SICK.waitingPeriod.value === 5 && p.SICK.waitingPeriod.unit === "days" &&
   p.SICK.accrual.mode === "YEARLY_ON_DATE" && p.SICK.accrual.days === 5 &&
   p.SICK.accrual.prorateFirstPeriod === true);
ck("maternity: 1 month / 22 yearly 1 Jan / NOT prorated",
   p.MATERNITY.waitingPeriod.value === 1 && p.MATERNITY.waitingPeriod.unit === "months" &&
   p.MATERNITY.accrual.mode === "YEARLY_ON_DATE" && p.MATERNITY.accrual.days === 22 &&
   p.MATERNITY.accrual.prorateFirstPeriod === false);
ck("paternity: 1 month / 10 yearly 1 Jan / prorated",
   p.PATERNITY.waitingPeriod.value === 1 && p.PATERNITY.waitingPeriod.unit === "months" &&
   p.PATERNITY.accrual.mode === "YEARLY_ON_DATE" && p.PATERNITY.accrual.days === 10 &&
   p.PATERNITY.accrual.prorateFirstPeriod === true);
ck("all four reset yearly, none carry forward or encash",
   Object.values(p).every((x) => x.resetYearly && !x.carryForward && !x.encash));
ck("exactly four types", Object.keys(p).length === 4, Object.keys(p).join(","));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
