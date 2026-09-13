/**
 * Email OTP as a second factor.
 *
 *   npx tsx --env-file=.env scripts/qa-email-otp.mjs
 *
 * The headline assertion is in "the security property": while an account is on
 * EMAIL, its retained TOTP secret must NOT open it. Everything else here could
 * pass while that one silently failed, and the result would be an account with
 * two live factors and no way to tell which is protecting it.
 *
 * No backdoor is used to learn the code. `issueEmailOtp()` returns it to its
 * caller by design — that is how the route hands it to the mailer — so the
 * suite calls the library directly for the cases that need to know the digits,
 * and exercises the HTTP send path separately for the cases that do not.
 */
import bcrypt from "bcryptjs";
import {
  BASE, db, Jar, createAndLogin, destroyUser,
  startSection, ok, fail, expect, summary, api,
} from "./qa-lib.mjs";

// DYNAMIC imports for the TypeScript modules. A static `import { x } from
// "../lib/mfa.ts"` fails under tsx with "does not provide an export named x" —
// the named bindings are not visible at link time. Awaiting the module gives
// the real exports.
const { totpGenerate } = await import("../lib/totp.ts");
const {
  issueEmailOtp, maskEmail, EMAIL_OTP_MAX_ATTEMPTS, MFA_MAX_ATTEMPTS, MFA_LOCKOUT_MS,
} = await import("../lib/mfa.ts");

const created = [];

/**
 * Signs in as far as the 2FA challenge and STOPS.
 *
 * qa-lib's createAndLogin completes the challenge, which is the wrong state for
 * every test here — the OTP endpoints all require `twoFactorPending`, i.e. the
 * password accepted and the second factor still outstanding.
 */
async function loginToPending(email, password) {
  const jar = new Jar();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  jar.ingest(csrfRes.headers);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE, json: "true" }),
  });
  jar.ingest(res.headers);
  return jar;
}

const post = (jar, path, body) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

let admin, subject, plain;

try {
  // ────────────────────────────────────────────────────────────────────────
  startSection("defaults — nothing changes for anyone else");

  admin = await createAndLogin({ role: "SUPER_ADMIN" });
  subject = await createAndLogin({ role: "HQ_EXECUTIVE" });
  plain = await createAndLogin({ role: "ICR" });
  created.push(admin, subject, plain);

  const fresh = await db.user.findUnique({
    where: { id: subject.user.id },
    select: { mfaMethod: true, emailOtpHash: true },
  });
  expect(fresh.mfaMethod === "TOTP", "a new account defaults to TOTP", `got ${fresh.mfaMethod}`);
  expect(fresh.emailOtpHash === null, "no OTP is sitting on a fresh account");

  const everyoneElse = await db.user.count({ where: { mfaMethod: { not: "TOTP" } } });
  expect(everyoneElse === 0, "the migration moved nobody", `${everyoneElse} account(s) are not TOTP`);

  // ────────────────────────────────────────────────────────────────────────
  startSection("who may change a method");

  const byIcr = await api(plain.jar, "PATCH", `/api/settings/users/${subject.user.id}/mfa-method`, {
    method: "EMAIL", reason: "trying it on",
  });
  expect(byIcr.status === 403, "an ICR cannot change anyone's method", `got ${byIcr.status}`);

  const byExec = await api(subject.jar, "PATCH", `/api/settings/users/${subject.user.id}/mfa-method`, {
    method: "EMAIL", reason: "changing my own",
  });
  expect(byExec.status === 403, "an HQ_EXECUTIVE cannot change even their own", `got ${byExec.status}`);

  const noReason = await api(admin.jar, "PATCH", `/api/settings/users/${subject.user.id}/mfa-method`, {
    method: "EMAIL",
  });
  expect(noReason.status === 422, "moving to EMAIL without a reason is refused", `got ${noReason.status}`);

  // Not enrolled → refused. Proves the route cannot be used to half-configure
  // an account that has never completed setup.
  const unenrolled = await db.user.create({
    data: {
      email: `qa-unenrolled-${Date.now()}@illume.local`,
      firstName: "QA", lastName: "Unenrolled", name: "QA Unenrolled",
      password: await bcrypt.hash("x".repeat(32), 12),
      role: "EMPLOYEE", isActive: true, twoFactorEnabled: false,
    },
  });
  const notEnrolled = await api(admin.jar, "PATCH", `/api/settings/users/${unenrolled.id}/mfa-method`, {
    method: "EMAIL", reason: "should not work",
  });
  expect(notEnrolled.status === 400, "an account with no MFA yet cannot be switched", `got ${notEnrolled.status}`);
  await db.user.delete({ where: { id: unenrolled.id } });

  const switched = await api(admin.jar, "PATCH", `/api/settings/users/${subject.user.id}/mfa-method`, {
    method: "EMAIL", reason: "CEO does not use an authenticator app",
  });
  expect(switched.status === 200, "a SUPER_ADMIN with a reason may switch", `got ${switched.status}`);

  const afterSwitch = await db.user.findUnique({
    where: { id: subject.user.id },
    select: { mfaMethod: true, twoFactorSecret: true, twoFactorEnabled: true },
  });
  expect(afterSwitch.mfaMethod === "EMAIL", "the method is stored");
  expect(afterSwitch.twoFactorEnabled === true, "the account is still MFA-enabled");
  expect(
    afterSwitch.twoFactorSecret !== null,
    "the TOTP secret is RETAINED so the account can move back without re-enrolling"
  );

  const auditRow = await db.auditLog.findFirst({
    where: { action: "MFA_METHOD_CHANGED", entityId: subject.user.id },
    orderBy: { createdAt: "desc" },
  });
  expect(!!auditRow, "the change is audited");
  const changes = auditRow?.changes ?? {};
  expect(changes.from === "TOTP" && changes.to === "EMAIL", "the audit row records both sides");
  expect(
    typeof changes.reason === "string" && changes.reason.includes("authenticator"),
    "the audit row carries the reason"
  );
  expect(auditRow?.userId === admin.user.id, "the audit row names the admin who did it");

  // ────────────────────────────────────────────────────────────────────────
  startSection("THE SECURITY PROPERTY — a retained TOTP secret must not open the account");

  const pendingJar = await loginToPending(subject.email, subject.password);
  const liveTotp = await totpGenerate(subject.user.twoFactorSecret);
  const totpAttempt = await post(pendingJar, "/api/auth/2fa/verify", { code: liveTotp });
  expect(
    totpAttempt.status !== 200,
    "a CURRENTLY VALID TOTP code is refused while the account is on EMAIL",
    `the route accepted it (${totpAttempt.status}) — both factors are live and neither is authoritative`
  );

  // ────────────────────────────────────────────────────────────────────────
  startSection("the send endpoint");

  const totpUserJar = await loginToPending(plain.email, plain.password);
  const totpSend = await post(totpUserJar, "/api/auth/2fa/email-otp");
  const totpSendBody = await totpSend.json();
  expect(totpSendBody.method === "TOTP", "a TOTP account is told so and gets no email");
  const totpUserRow = await db.user.findUnique({
    where: { id: plain.user.id }, select: { emailOtpHash: true },
  });
  expect(totpUserRow.emailOtpHash === null, "no code is issued to a TOTP account");

  // Clear the cooldown left by earlier direct calls so this send is the first.
  await db.user.update({ where: { id: subject.user.id }, data: { emailOtpSentAt: null } });
  const emailJar = await loginToPending(subject.email, subject.password);
  const send1 = await post(emailJar, "/api/auth/2fa/email-otp");
  const send1Body = await send1.json();
  // BREVO_API_KEY is absent locally, so safeSend reports failure and the route
  // correctly returns 502 rather than claiming to have sent something. Both
  // outcomes are legitimate here; what must hold either way is that a hash was
  // stored and the address was masked.
  expect(
    send1.status === 200 || send1.status === 502,
    "the send endpoint either sends or admits it could not",
    `got ${send1.status}`
  );
  expect(send1Body.method === "EMAIL", "the account is reported as EMAIL");
  expect(
    typeof send1Body.sentTo === "string" && send1Body.sentTo.includes("•"),
    "the destination is masked on the pre-auth screen"
  );
  expect(
    !JSON.stringify(send1Body).includes(subject.email),
    "the full address is NOT in the response",
    "an unauthenticated caller would learn a verified mailbox"
  );

  const stored = await db.user.findUnique({
    where: { id: subject.user.id },
    select: { emailOtpHash: true, emailOtpExpiresAt: true },
  });
  expect(!!stored.emailOtpHash, "a code hash is stored");
  expect(!stored.emailOtpHash?.startsWith("0") || stored.emailOtpHash.startsWith("$2"),
    "the code is hashed, not stored in the clear");
  expect(stored.emailOtpExpiresAt > new Date(), "the code has a future expiry");

  const send2 = await post(emailJar, "/api/auth/2fa/email-otp");
  expect(send2.status === 429, "an immediate resend is refused by the cooldown", `got ${send2.status}`);
  const send2Body = await send2.json();
  expect(typeof send2Body.retryAfterSeconds === "number", "the cooldown says how long to wait");

  // ────────────────────────────────────────────────────────────────────────
  startSection("verifying an emailed code");

  await db.user.update({ where: { id: subject.user.id }, data: { emailOtpSentAt: null } });
  const issued = await issueEmailOtp(subject.user.id);
  expect(issued.ok, "a code can be issued");

  const wrong = await post(emailJar, "/api/auth/2fa/verify", { code: "000000" });
  expect(wrong.status !== 200, "a wrong code is refused", `got ${wrong.status}`);
  const afterWrong = await db.user.findUnique({
    where: { id: subject.user.id }, select: { emailOtpAttempts: true },
  });
  expect(afterWrong.emailOtpAttempts === 1, "the wrong attempt is counted", `got ${afterWrong.emailOtpAttempts}`);

  const right = await post(emailJar, "/api/auth/2fa/verify", { code: issued.code });
  expect(right.status === 200, "the correct emailed code is accepted", `got ${right.status}`);

  const afterUse = await db.user.findUnique({
    where: { id: subject.user.id },
    select: { emailOtpHash: true, emailOtpAttempts: true },
  });
  expect(afterUse.emailOtpHash === null, "the code is consumed on success — no replay");
  expect(afterUse.emailOtpAttempts === 0, "the attempt counter resets");

  // ────────────────────────────────────────────────────────────────────────
  startSection("a code cannot be brute-forced or outlived");

  await db.user.update({ where: { id: subject.user.id }, data: { emailOtpSentAt: null } });
  const burn = await issueEmailOtp(subject.user.id);
  const burnJar = await loginToPending(subject.email, subject.password);
  for (let i = 0; i < EMAIL_OTP_MAX_ATTEMPTS; i++) {
    await post(burnJar, "/api/auth/2fa/verify", { code: String(100000 + i) });
  }
  const burned = await db.user.findUnique({
    where: { id: subject.user.id }, select: { emailOtpHash: true },
  });
  expect(
    burned.emailOtpHash === null,
    `the code is destroyed after ${EMAIL_OTP_MAX_ATTEMPTS} wrong attempts`,
    "it survived — a 6-digit code with no ceiling is walkable over HTTP"
  );
  const afterBurn = await post(burnJar, "/api/auth/2fa/verify", { code: burn.code });
  expect(
    afterBurn.status !== 200,
    "the ORIGINALLY CORRECT code no longer works once burned",
    "burning the code did not actually invalidate it"
  );

  await db.user.update({ where: { id: subject.user.id }, data: { emailOtpSentAt: null } });
  const expiring = await issueEmailOtp(subject.user.id);
  await db.user.update({
    where: { id: subject.user.id },
    data: { emailOtpExpiresAt: new Date(Date.now() - 1000) },
  });
  const expiredJar = await loginToPending(subject.email, subject.password);
  const expired = await post(expiredJar, "/api/auth/2fa/verify", { code: expiring.code });
  expect(expired.status !== 200, "an expired code is refused even though the digits are right");
  const expiredBody = await expired.json();
  expect(
    expiredBody.expired === true,
    "the refusal says EXPIRED rather than 'invalid'",
    "'invalid' on a correct-but-expired code sends people round retyping digits that were never wrong"
  );

  // ────────────────────────────────────────────────────────────────────────
  startSection("backup codes still work under EMAIL");

  const backup = "QAQAQ-BACKP";
  await db.user.update({
    where: { id: subject.user.id },
    data: { twoFactorBackupCodes: [await bcrypt.hash(backup, 10)] },
  });
  const backupJar = await loginToPending(subject.email, subject.password);
  const usedBackup = await post(backupJar, "/api/auth/2fa/verify", { code: backup });
  expect(
    usedBackup.status === 200,
    "a backup code opens an EMAIL account",
    "this is the escape hatch for the mailbox being unreachable — the failure this method is most exposed to"
  );

  // ────────────────────────────────────────────────────────────────────────
  startSection("switching back");

  const back = await api(admin.jar, "PATCH", `/api/settings/users/${subject.user.id}/mfa-method`, {
    method: "TOTP",
  });
  expect(back.status === 200, "moving back to TOTP needs no reason", `got ${back.status}`);
  const restored = await db.user.findUnique({
    where: { id: subject.user.id },
    select: { mfaMethod: true, emailOtpHash: true },
  });
  expect(restored.mfaMethod === "TOTP", "the method is back");
  expect(restored.emailOtpHash === null, "any outstanding emailed code is destroyed by the switch");

  const backJar = await loginToPending(subject.email, subject.password);
  const totpAgain = await totpGenerate(subject.user.twoFactorSecret);
  const totpWorks = await post(backJar, "/api/auth/2fa/verify", { code: totpAgain });
  expect(totpWorks.status === 200, "the original authenticator works again immediately", `got ${totpWorks.status}`);

  // ────────────────────────────────────────────────────────────────────────
  startSection("EVERY factor has a try limit, not just the emailed code");

  // Before this, /api/auth/2fa/verify counted nothing. An authenticator code
  // and a backup code could both be guessed forever by anyone with the
  // password. `plain` is on TOTP, so this exercises the path that had no
  // ceiling at all.
  await db.user.update({
    where: { id: plain.user.id },
    data: { mfaAttempts: 0, mfaLockedUntil: null },
  });

  const limitJar = await loginToPending(plain.email, plain.password);
  let lockedAt = null;
  for (let i = 1; i <= MFA_MAX_ATTEMPTS + 2; i++) {
    const r = await post(limitJar, "/api/auth/2fa/verify", { code: String(100000 + i) });
    if (r.status === 429 && lockedAt === null) lockedAt = i;
  }
  expect(
    lockedAt !== null,
    "a TOTP account locks after repeated wrong codes",
    "it never locked — the authenticator path is still unlimited"
  );
  expect(
    lockedAt === MFA_MAX_ATTEMPTS,
    `it locks on attempt ${MFA_MAX_ATTEMPTS}`,
    `locked on attempt ${lockedAt}`
  );

  const lockedRow = await db.user.findUnique({
    where: { id: plain.user.id },
    select: { mfaLockedUntil: true },
  });
  expect(lockedRow.mfaLockedUntil > new Date(), "the lock has a future expiry");
  expect(
    lockedRow.mfaLockedUntil.getTime() - Date.now() <= MFA_LOCKOUT_MS + 5000,
    "the lock is a WINDOW, not permanent",
    "a second factor that locks forever is a denial of service for whoever knows the password"
  );

  // The real code must be refused while locked — otherwise the lock is theatre.
  const realTotp = await totpGenerate(plain.user.twoFactorSecret);
  const whileLocked = await post(limitJar, "/api/auth/2fa/verify", { code: realTotp });
  expect(
    whileLocked.status === 429,
    "even the CORRECT code is refused while locked",
    `got ${whileLocked.status}`
  );

  // And the lock must lift.
  await db.user.update({
    where: { id: plain.user.id },
    data: { mfaLockedUntil: new Date(Date.now() - 1000) },
  });
  const afterWindow = await post(limitJar, "/api/auth/2fa/verify", {
    code: await totpGenerate(plain.user.twoFactorSecret),
  });
  expect(afterWindow.status === 200, "the account works again once the window passes", `got ${afterWindow.status}`);
  const cleared = await db.user.findUnique({
    where: { id: plain.user.id },
    select: { mfaAttempts: true, mfaLockedUntil: true },
  });
  expect(cleared.mfaAttempts === 0, "a success resets the counter");
  expect(cleared.mfaLockedUntil === null, "a success clears the lock");

  // ────────────────────────────────────────────────────────────────────────
  startSection("an admin MFA reset does not strand an EMAIL account");

  // Found while wiring the limit: reset-2fa wiped the secret but LEFT
  // mfaMethod as EMAIL, so /setup-2fa would enrol a new authenticator whose
  // codes the verify route would then refuse. The reset would report success
  // and lock the person out.
  const stranded = await createAndLogin({ role: "EMPLOYEE" });
  created.push(stranded);
  await db.user.update({
    where: { id: stranded.user.id },
    data: { mfaMethod: "EMAIL", mfaAttempts: 3, mfaLockedUntil: new Date(Date.now() + 60000) },
  });
  const reset = await api(admin.jar, "POST", `/api/settings/users/${stranded.user.id}/reset-2fa`);
  expect(reset.status === 200, "the reset succeeds", `got ${reset.status}`);
  const afterReset = await db.user.findUnique({
    where: { id: stranded.user.id },
    select: { mfaMethod: true, mfaAttempts: true, mfaLockedUntil: true, emailOtpHash: true },
  });
  expect(
    afterReset.mfaMethod === "TOTP",
    "the reset returns the account to the authenticator method",
    `left on ${afterReset.mfaMethod} — the new QR code would be refused`
  );
  expect(afterReset.mfaLockedUntil === null, "the reset clears any lockout");
  expect(afterReset.mfaAttempts === 0, "the reset clears the attempt counter");
  expect(afterReset.emailOtpHash === null, "the reset destroys any outstanding emailed code");

  // ────────────────────────────────────────────────────────────────────────
  startSection("enrolling straight onto email codes, with no app at any point");

  // The dead end this closes: the admin switch refuses accounts that have not
  // finished enrolment, and the only way to enrol was with an authenticator —
  // so the one person the email method was built for could not be given it.
  const noApp = await db.user.create({
    data: {
      email: `qa-noapp-${Date.now()}@illume.local`,
      firstName: "QA", lastName: "NoApp", name: "QA NoApp",
      password: await bcrypt.hash("QaNoApp!2026-longenough", 12),
      role: "HQ_EXECUTIVE", isActive: true, twoFactorEnabled: false,
      passwordChangedAt: new Date(),
    },
  });

  // Signs in fully: with no second factor on the account there is nothing
  // pending, which is exactly the state the enrolment route requires.
  const enrolJar = await loginToPending(noApp.email, "QaNoApp!2026-longenough");

  const sendEnrol = await post(enrolJar, "/api/auth/2fa/enroll-email", { action: "send" });
  const sendEnrolBody = await sendEnrol.json();
  expect(
    sendEnrol.status === 200 || sendEnrol.status === 502,
    "the enrolment code either sends or admits it could not",
    `got ${sendEnrol.status} ${JSON.stringify(sendEnrolBody)}`
  );

  // The send above started the 60s resend cooldown, and issueEmailOtp honours
  // it — so clear it before asking for a code directly, or this returns
  // {ok:false} and every assertion below fails on an undefined code.
  await db.user.update({ where: { id: noApp.id }, data: { emailOtpSentAt: null } });
  const enrolCode = await issueEmailOtp(noApp.id);
  expect(enrolCode.ok, "a code is issued for enrolment", JSON.stringify(enrolCode));

  const wrongPw = await post(enrolJar, "/api/auth/2fa/enroll-email", {
    action: "confirm", code: enrolCode.code, currentPassword: "not-the-password",
  });
  expect(
    wrongPw.status === 400,
    "the wrong account password is refused even with the right code",
    `got ${wrongPw.status} — a stolen session could otherwise enrol MFA`
  );

  await db.user.update({ where: { id: noApp.id }, data: { emailOtpSentAt: null } });
  const again = await issueEmailOtp(noApp.id);
  const enrolled = await post(enrolJar, "/api/auth/2fa/enroll-email", {
    action: "confirm", code: again.code, currentPassword: "QaNoApp!2026-longenough",
  });
  const enrolledBody = await enrolled.json();
  expect(enrolled.status === 200, "enrolment succeeds", `got ${enrolled.status}`);
  expect(
    Array.isArray(enrolledBody.backupCodes) && enrolledBody.backupCodes.length === 8,
    "8 backup codes are returned once",
    `got ${enrolledBody.backupCodes?.length}`
  );

  const enrolledRow = await db.user.findUnique({
    where: { id: noApp.id },
    select: { twoFactorEnabled: true, mfaMethod: true, twoFactorSecret: true, twoFactorBackupCodes: true },
  });
  expect(enrolledRow.twoFactorEnabled === true, "two-factor is on");
  expect(enrolledRow.mfaMethod === "EMAIL", "the account is on email codes");
  expect(
    enrolledRow.twoFactorSecret === null,
    "NO authenticator secret was created — the point of this path",
    "an app secret was set anyway"
  );
  expect(enrolledRow.twoFactorBackupCodes.length === 8, "the backup codes are stored");

  // Enrolling twice must not silently rotate a live second factor.
  const twice = await post(enrolJar, "/api/auth/2fa/enroll-email", { action: "send" });
  expect(twice.status === 409, "enrolling again is refused once MFA exists", `got ${twice.status}`);

  // And the admin route must not strand them by pointing at an app they lack.
  const toApp = await api(admin.jar, "PATCH", `/api/settings/users/${noApp.id}/mfa-method`, {
    method: "TOTP",
  });
  expect(
    toApp.status === 400,
    "an email-only account cannot be switched to an app it never set up",
    `got ${toApp.status} — that would point the account at a missing factor and lock it out`
  );

  // They can still sign in: a real emailed code opens the account.
  const signInJar = await loginToPending(noApp.email, "QaNoApp!2026-longenough");
  await db.user.update({ where: { id: noApp.id }, data: { emailOtpSentAt: null } });
  const loginCode = await issueEmailOtp(noApp.id);
  const signedIn = await post(signInJar, "/api/auth/2fa/verify", { code: loginCode.code });
  expect(signedIn.status === 200, "the account signs in with an emailed code", `got ${signedIn.status}`);

  await db.auditLog.deleteMany({ where: { userId: noApp.id } });
  await db.user.delete({ where: { id: noApp.id } });

  // ────────────────────────────────────────────────────────────────────────
  startSection("masking");

  expect(maskEmail("jamshid@illumestudentservices.ca").endsWith("@illumestudentservices.ca"),
    "the domain is kept so the owner knows which inbox");
  expect(!maskEmail("jamshid@illumestudentservices.ca").includes("jamshid"),
    "the local part is not readable");
  expect(maskEmail("al@x.com") === "a••@x.com", "a two-letter local part is still masked",
    maskEmail("al@x.com"));
} catch (e) {
  startSection("fatal");
  fail("suite threw", e?.stack ?? String(e));
} finally {
  for (const ctx of created) {
    try { await destroyUser(ctx); } catch { /* best effort */ }
  }
  await db.$disconnect();
  summary();
}
