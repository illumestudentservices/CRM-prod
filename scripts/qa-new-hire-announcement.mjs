/**
 * Hiring somebody announces them, in-app and by email.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-new-hire-announcement.mjs
 *
 * ★ THIS SUITE CAN SEND REAL EMAIL TO REAL PEOPLE, SO IT CHECKS FIRST.
 *
 * The thing under test broadcasts to EVERY active user in whatever database it
 * is pointed at. The test database is a copy of production's shape, and a copy
 * that still held real addresses plus a live BREVO_API_KEY would mail the
 * whole company a welcome for somebody who does not exist — from a QA run, at
 * whatever hour it happened to go.
 *
 * So two independent guards, asserted before anything is created:
 *
 *   1. BREVO_API_KEY must be absent. safeSend then logs and returns false, and
 *      nothing can leave the building.
 *   2. No address in the database may belong to a real Illume domain.
 *
 * Either one alone would do. Both, because the cost of being wrong is a
 * hundred people receiving a fictional announcement, and that cannot be
 * recalled.
 */
import {
  db, createAndLogin, destroyUser, api,
  startSection, expect, summary, TAG, BASE,
} from "./qa-lib.mjs";

const ctxs = [];
const announcements = [];
const madeEmployees = [];

/** Live domains. An address at one of these is a real colleague. */
const REAL_DOMAINS = ["illumestudentservices.ca", "illumestudentservices.cloud"];

async function guardOrDie() {
  startSection("Safety guards (nothing is created until these pass)");

  const keyed = !!process.env.BREVO_API_KEY;
  expect(!keyed,
    "*** BREVO_API_KEY is NOT set, so no mail can leave ***",
    keyed ? "a key IS set — refusing to broadcast from a test run" : "unset");

  const reals = await db.user.count({
    where: {
      deletedAt: null,
      OR: REAL_DOMAINS.map((d) => ({ email: { endsWith: `@${d}` } })),
    },
  });
  expect(reals === 0,
    "*** no real Illume addresses in this database ***",
    reals ? `${reals} real address(es) — this is not a safe database to broadcast in` : "none");

  const prodish = /illumestudentservices/i.test(BASE);
  expect(!prodish, "and BASE is not production", BASE);

  if (keyed || reals > 0 || prodish) {
    throw new Error("Refusing to run: this would send real announcements to real people.");
  }
  console.log("     guards passed — a broadcast here reaches nobody outside this database\n");
}

async function main() {
  console.log(`BASE = ${BASE}\n`);
  await guardOrDie();

  const hr = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(hr);

  // Somebody to receive the announcement.
  const colleague = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(colleague);

  const dept = await db.department.findFirst({ select: { id: true, name: true } });
  const region = await db.region.findFirst({ select: { id: true, name: true } });

  // ── Hiring through the form ───────────────────────────────────────────────
  startSection("Creating an employee announces them");

  const hireEmail = `${TAG.toLowerCase()}-joiner@illume.local`;
  const before = await db.announcement.count();

  const created = await api(hr.jar, "POST", "/api/hr/employees", {
    firstName: "Newjoiner",
    lastName: TAG,
    email: hireEmail,
    jobTitle: "Student Advisor",
    startDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    employmentType: "FULL_TIME",
    role: "EMPLOYEE",
    // The schema requires a manager for every role except SUPER_ADMIN, and
    // the announcement names them, so this is the line that proves it does.
    managerId: hr.employee.id,
    ...(dept ? { departmentId: dept.id } : {}),
    ...(region ? { regionId: region.id } : {}),
    phone: "+1 555 0100",
  });
  expect(created.status === 201 || created.status === 200,
    "the new-hire form accepts the record", `status ${created.status} ${JSON.stringify(created.payload?.error ?? "")}`);

  const newUser = await db.user.findFirst({
    where: { email: hireEmail },
    select: { id: true, employee: { select: { id: true, employeeId: true } } },
  });
  expect(!!newUser, "and the account exists", newUser ? "created" : "missing");
  if (newUser?.employee) madeEmployees.push(newUser.employee.id);

  // The announcement is fire-and-forget, so give it a moment to land.
  let ann = null;
  for (let i = 0; i < 40 && !ann; i++) {
    await new Promise((r) => setTimeout(r, 250));
    ann = await db.announcement.findFirst({
      where: { title: { startsWith: "Welcome to Illume, Newjoiner" } },
      orderBy: { createdAt: "desc" },
    });
  }
  if (ann) announcements.push(ann.id);
  expect(!!ann,
    "*** an announcement is posted automatically ***",
    ann ? "posted" : `none appeared; announcements went ${before} -> ${await db.announcement.count()}`);

  if (!ann) return;

  // ── What it says ──────────────────────────────────────────────────────────
  startSection("What the announcement says");

  expect(ann.isGlobal === true && ann.regionId === null,
    "it goes to everyone, not one region", `global=${ann.isGlobal} region=${ann.regionId}`);
  expect(ann.authorId === hr.user.id,
    "the person who did the hiring is the author", `authorId=${ann.authorId}`);
  expect(ann.content.includes("Student Advisor"),
    "it names the job title", ann.content.slice(0, 80));
  if (dept) {
    expect(ann.content.includes(dept.name), "and the team", `missing ${dept.name}`);
  }
  expect(/Reporting to:/.test(ann.content),
    "and who they report to", ann.content.slice(0, 120));

  const days = ann.expiresAt
    ? Math.round((ann.expiresAt.getTime() - Date.now()) / 86_400_000)
    : null;
  expect(days !== null && days >= 29 && days <= 31,
    "*** it expires, rather than sitting in the feed for ever ***",
    `expires in ${days} day(s)`);

  startSection("It does not broadcast personal details");
  const body = `${ann.title}\n${ann.content}`;
  expect(!body.includes(hireEmail),
    "*** the email address is NOT in the announcement ***", "the address was broadcast");
  expect(!body.includes("555 0100"),
    "*** nor the phone number ***", "the phone number was broadcast");

  // ── Who hears about it ────────────────────────────────────────────────────
  startSection("Who is told");

  // The row is created BEFORE its notifications, so finding the announcement
  // is not the same as the work being done. Poll, or the test races the
  // fire-and-forget it is testing and reports a feature bug that is its own.
  let notifs = [];
  for (let i = 0; i < 40; i++) {
    notifs = await db.notification.findMany({
      where: { title: ann.title },
      select: { userId: true },
    });
    if (notifs.length) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const told = new Set(notifs.map((n) => n.userId));
  expect(told.size > 0, "notifications went out", `${told.size} recipient(s)`);
  expect(told.has(colleague.user.id),
    "*** a colleague is told ***", "the colleague heard nothing");
  expect(!told.has(newUser.id),
    "*** the new joiner is NOT told to welcome themselves ***", "they were notified about themselves");
  expect(!told.has(hr.user.id),
    "nor is the person who typed it in", "the author was notified");

  startSection("And it shows up in the feed");
  const feed = await api(colleague.jar, "GET", "/api/hr/announcements");
  const seen = (feed.payload?.announcements ?? []).find((a) => a.id === ann.id);
  expect(!!seen, "the colleague sees it on their dashboard", "missing from the feed");
  expect(seen?.isRead === false, "and it is marked unread for them", `isRead=${seen?.isRead}`);

  // ── The email half ────────────────────────────────────────────────────────
  startSection("The email half, called directly so the counts can be checked");

  const second = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(second);

  const { postNewHireAnnouncement } = await import("../lib/new-hire-announcement.ts");

  const quiet = await postNewHireAnnouncement({
    employeeId: second.employee.id,
    actorUserId: hr.user.id,
    skipEmail: true,
  });
  if (quiet) announcements.push(quiet.announcementId);
  expect(!!quiet, "it reports what it did", quiet ? "returned a result" : "returned null");
  expect(quiet?.emailed === 0 && quiet?.emailFailed === 0,
    "skipEmail really does skip the email", `emailed=${quiet?.emailed} failed=${quiet?.emailFailed}`);
  expect((quiet?.notified ?? 0) > 0,
    "but the in-app announcement still goes out", `notified=${quiet?.notified}`);

  const third = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(third);
  const loud = await postNewHireAnnouncement({
    employeeId: third.employee.id,
    actorUserId: hr.user.id,
  });
  if (loud) announcements.push(loud.announcementId);
  // With no API key safeSend returns false, so every send is counted as
  // failed. That is the correct reading: nothing was accepted by a provider.
  expect((loud?.emailed ?? 0) + (loud?.emailFailed ?? 0) === (loud?.notified ?? 0),
    "*** it tries to email exactly the people it notified ***",
    `notified=${loud?.notified} emailed=${loud?.emailed} failed=${loud?.emailFailed}`);
  expect(loud?.emailed === 0,
    "and with no provider key nothing was actually accepted for delivery",
    `emailed=${loud?.emailed} — mail may have left the building`);

  startSection("A missing employee is survivable");
  const nothing = await postNewHireAnnouncement({
    employeeId: "00000000-0000-0000-0000-000000000000",
    actorUserId: hr.user.id,
  });
  expect(nothing === null, "an unknown employee returns null rather than throwing", `${nothing}`);
}

let code = 1;
try { await main(); code = summary(); }
catch (e) {
  console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n"));
}
finally {
  startSection("Teardown");
  const ids = [...new Set(announcements)];
  for (const id of ids) {
    const a = await db.announcement.findUnique({ where: { id }, select: { title: true } });
    if (a) await db.notification.deleteMany({ where: { title: a.title } }).catch(() => {});
    await db.announcement.delete({ where: { id } }).catch(() => {});
  }
  if (ids.length) console.log(`     removed ${ids.length} announcement(s) and their notifications`);

  const strays = await db.announcement.deleteMany({
    where: { title: { contains: TAG } },
  });
  if (strays.count) console.log(`     removed ${strays.count} stray announcement(s)`);
  await db.notification.deleteMany({ where: { title: { contains: TAG } } }).catch(() => {});

  // The employee created through the route has no ctx, so it is removed by hand.
  for (const empId of madeEmployees) {
    const emp = await db.employee.findUnique({ where: { id: empId }, select: { userId: true } });
    await db.employee.delete({ where: { id: empId } }).catch(() => {});
    if (emp) {
      await db.notification.deleteMany({ where: { userId: emp.userId } }).catch(() => {});
      await db.passwordResetToken.deleteMany({ where: { userId: emp.userId } }).catch(() => {});
      await db.passwordHistory.deleteMany({ where: { userId: emp.userId } }).catch(() => {});
      await db.auditLog.deleteMany({ where: { userId: emp.userId } }).catch(() => {});
      await db.user.delete({ where: { id: emp.userId } }).catch(() => {});
    }
  }
  for (const c of ctxs) await destroyUser(c);

  const left = await db.announcement.count({ where: { title: { contains: "Newjoiner" } } });
  expect(left === 0, "no test announcement left behind", `${left} remaining`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
