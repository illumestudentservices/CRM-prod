/**
 * New-student emails: the ICR and their manager, and ONE email per batch.
 *
 *   npx tsx --env-file=.env scripts/qa-lead-notifications.mjs
 *
 * ★ THE ASSERTION THAT MATTERS is the COUNT of emails, not that an email was
 * sent. A per-lead loop would satisfy any "did it notify?" check while quietly
 * sending forty messages for a forty-student booth upload.
 *
 * Counting happens in TWO places, because neither alone is enough:
 *
 *   1. In-process — notifyNewLeads is called directly and the provider call is
 *      intercepted. Exact, and it proves the batching rule.
 *   2. Over HTTP — the two real routes are exercised and the DEV SERVER'S OWN
 *      LOG is read. The in-process test cannot see this: safeSend runs inside
 *      the Next process, so a console hook in this script would count nothing
 *      and every HTTP assertion would pass vacuously.
 *
 * Nothing is sent for real. There is no BREVO_API_KEY in .env, so lib/email.ts
 * logs "[email] Skipped" and returns; that line is what gets counted. If a key
 * is ever added locally, this suite must be revisited — it would then send.
 *
 * Footprint: disposable users and leads, all removed in `finally`.
 */
import fs from "node:fs";
import os from "node:os";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

// ★ NOT "/tmp/dev.log". Git Bash's /tmp is a shell-level mapping that Node does
// not resolve — fs.existsSync("/tmp/dev.log") is false while the file plainly
// exists in the shell. Use the real Windows path (os.tmpdir(), forward slashes).
const DEV_LOG = `${os.tmpdir().replace(/\\/g, "/")}/dev.log`;
let icrCtx, mgrCtx, outsiderCtx;
const madeLeadIds = [];
let template;

// ── In-process capture ───────────────────────────────────────────────────────
const sent = [];
const realLog = console.log;
console.log = (...args) => {
  const m = args.join(" ").match(/^\[email\] Skipped \(no BREVO_API_KEY\) — to: (.+?), subject: (.+)$/);
  if (m) sent.push({ to: m[1], subject: m[2] });
  realLog(...args);
};

// ── Server-log capture ───────────────────────────────────────────────────────
/** Byte offset, so each check reads only what the server wrote since. */
let logMark = 0;
function markLog() {
  try { logMark = fs.statSync(DEV_LOG).size; } catch { logMark = 0; }
}
function emailsSinceMark() {
  let text = "";
  try {
    const fd = fs.openSync(DEV_LOG, "r");
    const size = fs.statSync(DEV_LOG).size;
    const buf = Buffer.alloc(Math.max(0, size - logMark));
    fs.readSync(fd, buf, 0, buf.length, logMark);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch { /* log not readable */ }
  return [...text.matchAll(/\[email\] Skipped \(no BREVO_API_KEY\) — to: (.+?), subject: (.+)/g)]
    .map((m) => ({ to: m[1].trim(), subject: m[2].trim() }));
}

const settle = (ms = 3000) => new Promise((r) => setTimeout(r, ms));

async function post(ctx, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ctx.jar.header() },
    body: JSON.stringify(body),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* not json */ }
  return { status: res.status, payload };
}

/**
 * Only the fields createLeadSchema actually accepts.
 *
 * Spreading a whole DB row here returns 422: the row carries dozens of columns
 * the create schema does not list, and several (nullable enums, dates) fail
 * validation. An explicit body is also clearer about what a capture requires.
 */
function apiBody(i) {
  return {
    firstName: "ZZNotify",
    lastName: `Student${i}`,
    email: `zznotify-${i}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@illume.local`,
    phone: "+10000000123",
    nationality: "Indian",
    countryOfResidence: "India",
    interestedProgram: "QA Programme",
    studyLevel: "UNDERGRADUATE",
    intakeYear: 2027,
    intakeMonth: 9,
  };
}

/** The same student, shaped for a direct db.lead.create (needs every required column). */
function dbFields(i) {
  const { id, createdAt, updatedAt, captureId, ...rest } = template;
  return {
    ...rest,
    firstName: "ZZNotify",
    lastName: `Student${i}`,
    email: `zznotify-${i}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@illume.local`,
    phone: "+10000000123",
  };
}

try {
  startSection("Fixtures, and proof the log can be read");
  template = await db.lead.findFirst({ where: { deletedAt: null } });
  expect(!!template, "found a lead to copy the required fields from");
  expect(fs.existsSync(DEV_LOG),
    `dev server log is readable at ${DEV_LOG}`,
    "without it every HTTP assertion below would pass without testing anything");

  mgrCtx = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  icrCtx = await createAndLogin({ role: "ICR", withEmployee: true });
  expect(!!icrCtx.employee && !!mgrCtx.employee, "both have employee records");

  await db.employee.update({
    where: { id: icrCtx.employee.id },
    data: { managerId: mgrCtx.employee.id },
  });
  expect(true, `ICR reports to ${mgrCtx.user.email}`);

  // ── In-process: the batching rule ──────────────────────────────────────────
  startSection("notifyNewLeads sends ONE email each, whatever the batch size");
  {
    const { notifyNewLeads } = await import("@/lib/lead-notifications");

    // Six real leads to announce.
    const ids = [];
    for (let i = 0; i < 6; i++) {
      const l = await db.lead.create({
        data: { ...dbFields(`inproc${i}`), assignedICRId: icrCtx.user.id, createdById: icrCtx.user.id },
      });
      ids.push(l.id);
      madeLeadIds.push(l.id);
    }

    sent.length = 0;
    await notifyNewLeads({ leadIds: [ids[0]], capturedByUserId: icrCtx.user.id });
    expect(sent.length === 2, `1 student -> 2 emails (ICR + manager), saw ${sent.length}`,
      sent.map((s) => s.to).join(", "));

    sent.length = 0;
    await notifyNewLeads({ leadIds: ids, capturedByUserId: icrCtx.user.id });
    expect(sent.length === 2,
      `★ 6 students -> still 2 emails, NOT 12. Saw ${sent.length}`,
      sent.map((s) => s.subject).join(" | "));
    expect(sent.every((s) => s.subject.includes("6")),
      "both subjects state the count", sent.map((s) => s.subject).join(" | "));
    expect(sent.some((s) => s.to === icrCtx.user.email) &&
           sent.some((s) => s.to === mgrCtx.user.email),
      "one to the ICR, one to the manager", sent.map((s) => s.to).join(", "));

    const mgrMail = sent.find((s) => s.to === mgrCtx.user.email);
    const icrMail = sent.find((s) => s.to === icrCtx.user.email);
    expect(mgrMail?.subject.includes("by"),
      "the manager's subject names who captured them", mgrMail?.subject);
    expect(!icrMail?.subject.includes(" by "),
      "the ICR's own copy is not addressed as though about someone else", icrMail?.subject);

    // Empty input must do nothing at all.
    sent.length = 0;
    await notifyNewLeads({ leadIds: [], capturedByUserId: icrCtx.user.id });
    expect(sent.length === 0, "an empty batch sends nothing");
  }

  // ── In-process: manager resolution ─────────────────────────────────────────
  startSection("resolveManager prefers the employee link, falls back to region");
  {
    const { resolveManager } = await import("@/lib/lead-notifications");

    expect((await resolveManager(icrCtx.user.id))?.email === mgrCtx.user.email,
      "found via Employee.managerId");

    const region = await db.region.findFirst({ select: { id: true } });
    await db.employee.update({ where: { id: icrCtx.employee.id }, data: { managerId: null } });
    await db.user.update({ where: { id: icrCtx.user.id }, data: { regionId: region.id } });
    await db.user.update({ where: { id: mgrCtx.user.id }, data: { regionId: region.id } });

    expect((await resolveManager(icrCtx.user.id))?.email === mgrCtx.user.email,
      "falls back to a Regional Manager in the same region");

    const own = await resolveManager(mgrCtx.user.id);
    expect(own?.email !== mgrCtx.user.email,
      "a manager is never their own manager", own?.email ?? "null");

    await db.employee.update({
      where: { id: icrCtx.employee.id }, data: { managerId: mgrCtx.employee.id },
    });
  }

  // ── In-process: nobody is substituted when there is no manager ─────────────
  startSection("With no manager, only the ICR is emailed");
  {
    const { notifyNewLeads } = await import("@/lib/lead-notifications");
    outsiderCtx = await createAndLogin({ role: "ICR", withEmployee: true, extra: { regionId: null } });
    const l = await db.lead.create({
      data: { ...dbFields("nomgr"), assignedICRId: outsiderCtx.user.id, createdById: outsiderCtx.user.id },
    });
    madeLeadIds.push(l.id);

    sent.length = 0;
    await notifyNewLeads({ leadIds: [l.id], capturedByUserId: outsiderCtx.user.id });
    expect(sent.length === 1, `exactly 1 email, saw ${sent.length}`,
      sent.map((s) => s.to).join(", "));
    expect(sent[0]?.to === outsiderCtx.user.email, "and it went to the ICR");

    const admins = await db.user.findMany({
      where: { role: "SUPER_ADMIN", isActive: true }, select: { email: true },
    });
    expect(!sent.some((s) => admins.some((a) => a.email === s.to)),
      "no super admin substituted as a stand-in manager",
      "that would turn every capture into admin inbox noise");
  }

  // ── Over HTTP: the routes are actually wired ───────────────────────────────
  startSection("POST /api/leads triggers it (read from the dev server's own log)");
  {
    markLog();
    const r = await post(icrCtx, "/api/leads", apiBody("http"));
    expect(r.status === 201, "lead created over HTTP", `status ${r.status}`);
    if (r.payload?.data?.id) madeLeadIds.push(r.payload.data.id);
    await settle();

    const mails = emailsSinceMark();
    expect(mails.length === 2,
      `2 emails from the online route, saw ${mails.length}`,
      mails.map((m) => m.to).join(", "));
    expect(mails.some((m) => m.to === icrCtx.user.email) &&
           mails.some((m) => m.to === mgrCtx.user.email),
      "ICR and manager both reached");
  }

  startSection("A booth upload sends ONE email each, over HTTP");
  {
    markLog();
    const BATCH = 5;
    const leads = Array.from({ length: BATCH }, (_, i) => {
      const b = apiBody(`batch${i}`);
      return {
        captureId: crypto.randomUUID(),
        firstName: b.firstName, lastName: `Batch${i}`, email: b.email, phone: b.phone,
        nationality: b.nationality, countryOfResidence: b.countryOfResidence,
        interestedProgram: b.interestedProgram, studyLevel: b.studyLevel,
        intakeYear: b.intakeYear, intakeMonth: b.intakeMonth,
      };
    });
    const r = await post(icrCtx, "/api/leads/offline-sync", { leads });
    expect(r.status === 200, "batch accepted", `status ${r.status}`);
    expect(r.payload?.summary?.created === BATCH, `${BATCH} students created`,
      JSON.stringify(r.payload?.summary));
    for (const row of r.payload?.results ?? []) if (row.leadId) madeLeadIds.push(row.leadId);
    await settle(4000);

    const mails = emailsSinceMark();
    expect(mails.length === 2,
      `★ ${BATCH} students -> 2 emails, NOT ${BATCH * 2}. Saw ${mails.length}`,
      mails.map((m) => m.subject).join(" | "));
    // `[].every()` returns true, so this must require mails to exist first —
    // otherwise it passes loudest exactly when nothing was sent.
    expect(mails.length > 0 && mails.every((m) => m.subject.includes(String(BATCH))),
      `both subjects state ${BATCH}`, mails.map((m) => m.subject).join(" | ") || "no emails at all");

    // ── A retry must not re-announce ─────────────────────────────────────────
    markLog();
    const again = await post(icrCtx, "/api/leads/offline-sync", { leads: [leads[0]] });
    await settle();
    expect(again.payload?.summary?.alreadySynced === 1,
      "the resend is reported as already synced", JSON.stringify(again.payload?.summary));
    expect(emailsSinceMark().length === 0,
      "NO email for a re-upload — old work must not be announced as new",
      emailsSinceMark().map((m) => m.subject).join(" | "));
  }
} catch (e) {
  console.error("FATAL:", e.code ?? "", e.message);
  process.exitCode = 1;
} finally {
  console.log = realLog;
  for (const id of madeLeadIds) {
    await db.leadActivity.deleteMany({ where: { leadId: id } }).catch(() => {});
    await db.notification.deleteMany({ where: { link: `/students/${id}` } }).catch(() => {});
    await db.lead.delete({ where: { id } }).catch(() => {});
  }
  await db.lead.deleteMany({ where: { firstName: "ZZNotify" } }).catch(() => {});
  for (const c of [icrCtx, mgrCtx, outsiderCtx]) if (c) await destroyUser(c);
  const left = await db.lead.count({ where: { firstName: "ZZNotify" } });
  console.log(`cleanup: ${madeLeadIds.length} leads handled, ${left} ZZNotify rows remain`);
  summary();
  await db.$disconnect();
}
