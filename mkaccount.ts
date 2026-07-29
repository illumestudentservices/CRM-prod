/**
 * Creates ONE disposable HR account so the HR and leave screens can be driven
 * in a browser. Deleted by rmaccount.ts when verification finishes.
 *
 * HR_MANAGER rather than SUPER_ADMIN: it is the least privilege that reaches
 * the HR and leave pages, and there is no reason to hold more.
 *
 * MFA is enrolled properly rather than bypassed — the mandate applies to this
 * account like any other.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { totpGenerateSecret } from "@/lib/totp";
import { recordPasswordInHistory } from "@/lib/password-history";

(async () => {
  const stamp = Date.now();
  const email = `hr-verify-${stamp}@illumestudentservices.cloud`;
  // 24 random bytes, then shaped to satisfy the complexity rules.
  const password = `Vf-${randomBytes(9).toString("base64url")}9!aZ`;
  const secret = totpGenerateSecret();

  const region = await db.region.findFirst({ select: { id: true } });
  const dept = await db.department.findFirst({ select: { id: true } });
  const manager = await db.employee.findFirst({ select: { id: true } });

  const hashed = await bcrypt.hash(password, 12);

  const user = await db.user.create({
    data: {
      email,
      name: "HR Verification (disposable)",
      password: hashed,
      role: "HR_MANAGER",
      regionId: region?.id ?? null,
      isActive: true,
      // Already "chosen", so the forced-change screen does not sit in the way
      // of the thing being tested.
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      twoFactorBackupCodes: [],
    },
  });
  await recordPasswordInHistory(user.id, hashed);

  // An Employee row is needed to exercise leave: entitlement is derived from
  // startDate. Joined 10 months ago so vacation has accrued past its 3-month
  // wait, and gender is left null on purpose — that is the state all 8 real
  // employees are in right now.
  const lastEmp = await db.employee.findFirst({
    orderBy: { createdAt: "desc" },
    select: { employeeId: true },
  });
  const nextNum = lastEmp ? (parseInt(lastEmp.employeeId.replace(/^[A-Z]+-/, ""), 10) || 0) + 1 : 1;

  const employee = await db.employee.create({
    data: {
      employeeId: `ILL-${String(nextNum).padStart(4, "0")}`,
      userId: user.id,
      jobTitle: "HR Verification",
      departmentId: dept?.id ?? null,
      employmentType: "FULL_TIME",
      managerId: manager?.id ?? null,
      startDate: new Date(Date.now() - 300 * 86400000),
      gender: null,
      isActive: true,
    },
  });

  console.log("TEST_EMAIL=" + email);
  console.log("TEST_PASSWORD=" + password);
  console.log("TEST_TOTP_SECRET=" + secret);
  console.log("EMPLOYEE_ID=" + employee.id);
  process.exit(0);
})();
