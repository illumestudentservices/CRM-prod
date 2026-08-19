/**
 * Shared QA harness. Handles disposable-admin creation, the full MFA login
 * dance, an HTTP helper with rate-limit spacing, and result bookkeeping.
 *
 * Every test script imports from here so login logic lives in one place.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { generateSecret, generate as totpGenerate } from "otplib";
import crypto from "node:crypto";

/**
 * Target host.
 *
 * This used to default to https://illumestudentservices.cloud — production.
 * Every script here creates disposable users and fixture rows, so a run that
 * merely forgot to set BASE_URL wrote them straight into the live database.
 * The default is now localhost, and pointing at production takes a deliberate
 * ALLOW_PROD_QA opt-in.
 */
const PROD_HOST_RE = /illumestudentservices\.(cloud|ca)|187\.124\.112\.151/i;

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";

if (PROD_HOST_RE.test(BASE) && process.env.ALLOW_PROD_QA !== "yes-i-mean-it") {
  throw new Error(
    `Refusing to run the QA suite against production (${BASE}).\n` +
    `These scripts create users and fixture data. Point BASE_URL at a dev server,\n` +
    `or set ALLOW_PROD_QA=yes-i-mean-it if you genuinely intend to write to prod.`
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = new PrismaClient({ adapter: new PrismaPg(pool) });

// The DB is written directly, so which database is in play matters as much as
// which host. Print it (host only, never credentials) so a misdirected run is
// obvious in the log rather than discovered afterwards.
{
  let dbHost = "unknown";
  try { dbHost = new URL(process.env.DATABASE_URL ?? "").host || "unknown"; } catch { /* ignore */ }
  console.log(`[qa] target=${BASE}  db=${dbHost}`);
}

export const TAG = "QA" + crypto.randomBytes(3).toString("hex").toUpperCase();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Result bookkeeping ────────────────────────────────────────────────
export const failures = [];
const perSection = new Map();
let section = "";

export function startSection(name) {
  section = name;
  if (!perSection.has(name)) perSection.set(name, { pass: 0, fail: 0 });
  process.stdout.write(`\n── ${name} ${"─".repeat(Math.max(0, 56 - name.length))}\n`);
}

export function ok(label, extra = "") {
  perSection.get(section).pass++;
  process.stdout.write(`  ✓  ${label}${extra ? "  " + extra : ""}\n`);
}

export function fail(label, detail = "") {
  perSection.get(section).fail++;
  process.stdout.write(`  ✗  ${label}${detail ? "  → " + detail : ""}\n`);
  failures.push({ section, label, detail });
}

/** assert(cond) with a label. Returns the boolean so callers can branch. */
export function expect(cond, label, detail = "") {
  if (cond) { ok(label); return true; }
  fail(label, detail);
  return false;
}

export function summary() {
  process.stdout.write(`\n${"═".repeat(64)}\n  SUMMARY\n${"═".repeat(64)}\n`);
  let p = 0, f = 0;
  for (const [name, b] of perSection) {
    process.stdout.write(
      `  ${b.fail === 0 ? "✓" : "✗"} ${name.padEnd(50)} ${String(b.pass).padStart(3)} pass / ${b.fail} fail\n`
    );
    p += b.pass; f += b.fail;
  }
  process.stdout.write(`\n  TOTAL: ${p} pass / ${f} fail\n`);
  if (failures.length) {
    process.stdout.write(`\n  FAILURES:\n`);
    for (const x of failures) {
      process.stdout.write(`   ✗ [${x.section}] ${x.label}${x.detail ? " → " + x.detail : ""}\n`);
    }
  }
  return f;
}

// ── Cookie jar ────────────────────────────────────────────────────────
export class Jar {
  constructor() { this.cookies = new Map(); }
  ingest(headers) {
    for (const line of headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

// ── Disposable user + login ───────────────────────────────────────────

/**
 * Creates a throwaway user with MFA properly enrolled and returns
 * { user, jar, employee }. Caller must call destroyUser() when done.
 */
/**
 * `extra` is merged into the User row before the login happens, which is the
 * only moment it can be. Fields like `regionId` are baked into the session JWT
 * at sign-in, so setting one afterwards leaves the user in a region their own
 * session does not know about, and every region-scoped check then behaves as
 * if the field had never been set.
 */
export async function createAndLogin({ role = "SUPER_ADMIN", withEmployee = false, extra = {} } = {}) {
  const email = `${TAG.toLowerCase()}-${role.toLowerCase()}-${Date.now()}@illume.local`;
  const password = crypto.randomBytes(24).toString("base64url");
  const secret = generateSecret();
  const user = await db.user.create({
    data: {
      email,
      firstName: TAG,
      lastName: role,
      name: `${TAG} ${role}`,
      password: await bcrypt.hash(password, 12),
      role,
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      passwordChangedAt: new Date(),
      ...extra,
    },
  });

  let employee = null;
  if (withEmployee) {
    employee = await db.employee.create({
      data: {
        userId: user.id,
        employeeId: `${TAG}-${Date.now().toString().slice(-6)}`,
        jobTitle: "QA Bot",
        employmentType: "FULL_TIME",
        startDate: new Date(),
      },
    }).catch(() => null);
  }

  const jar = new Jar();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  jar.ingest(csrfRes.headers);
  const { csrfToken } = await csrfRes.json();

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE, json: "true" }),
  });
  jar.ingest(loginRes.headers);

  const code = await totpGenerate({ secret });
  const totpRes = await fetch(`${BASE}/api/auth/2fa/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ code }),
  });
  jar.ingest(totpRes.headers);
  if (!totpRes.ok) throw new Error(`[${role}] 2fa verify ${totpRes.status}`);

  const csrf2Res = await fetch(`${BASE}/api/auth/csrf`, { headers: { Cookie: jar.header() } });
  jar.ingest(csrf2Res.headers);
  const { csrfToken: csrf2 } = await csrf2Res.json();
  await fetch(`${BASE}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ csrfToken: csrf2, data: { twoFactorVerified: true } }),
  }).then((r) => jar.ingest(r.headers));

  return { user, jar, employee, email, password };
}

/**
 * Removes a disposable user and everything that references it.
 *
 * The order matters, and so does the breadth: rows created as a *side effect*
 * of the user's actions don't carry the test tag, so tag-matching alone leaves
 * them behind and the final `user.delete` then fails on a foreign key. Plan
 * activation materialising Activity rows is the case that caught this — three
 * ICR users survived cleanup before `activities` was added here.
 *
 * Each step is best-effort; a missing table or an already-deleted row must not
 * stop the rest of the teardown.
 */
export async function destroyUser(ctx) {
  if (!ctx?.user) return;
  const id = ctx.user.id;

  // Rows owned by the user's Employee record.
  if (ctx.employee) {
    const eid = ctx.employee.id;
    await db.task.deleteMany({ where: { createdById: eid } }).catch(() => {});
    await db.task.deleteMany({ where: { assigneeId: eid } }).catch(() => {});
    await db.travelRequest.deleteMany({ where: { employeeId: eid } }).catch(() => {});
    await db.leaveRequest.deleteMany({ where: { employeeId: eid } }).catch(() => {});
    await db.assetAssignment.deleteMany({ where: { employeeId: eid } }).catch(() => {});
  }

  // Rows referencing the User directly.
  await db.activity.deleteMany({ where: { userId: id } }).catch(() => {});
  await db.leadActivity.deleteMany({ where: { userId: id } }).catch(() => {});
  await db.engagementLog.deleteMany({ where: { userId: id } }).catch(() => {});
  await db.notification.deleteMany({ where: { userId: id } }).catch(() => {});
  await db.deletedRecord.deleteMany({ where: { deletedById: id } }).catch(() => {});
  await db.deletedRecord.deleteMany({ where: { restoredById: id } }).catch(() => {});
  await db.auditLog.deleteMany({ where: { userId: id } }).catch(() => {});
  // InstitutionUser was missing here, so any test that assigned an
  // INSTITUTION_CLIENT to an institution left the user undeletable behind that
  // FK — it only surfaced as the warning below, after the rows had leaked.
  await db.institutionUser.deleteMany({ where: { userId: id } }).catch(() => {});
  await db.passwordHistory.deleteMany({ where: { userId: id } }).catch(() => {});
  // Rows that reference the user by a name other than `userId`, so the deletes
  // above cannot see them. The button sweep clicks "new plan" controls, which
  // materialises QuarterlyRecruitmentPlan rows with icrId set to the sweeping
  // user — three of them survived a crashed run and blocked the teardown of two
  // disposable accounts until they were removed by hand.
  for (const [model, field] of [
    ["quarterlyRecruitmentPlan", "icrId"],
    ["icrMonthlyReport", "icrId"],
  ]) {
    if (!db[model]?.deleteMany) continue;
    await db[model].deleteMany({ where: { [field]: id } }).catch(() => {});
  }
  await db.$executeRaw`DELETE FROM attachments WHERE "uploadedById" = ${id}`.catch(() => {});
  await db.$executeRaw`UPDATE leads SET "assignedICRId" = NULL WHERE "assignedICRId" = ${id}`.catch(() => {});

  if (ctx.employee) await db.employee.delete({ where: { id: ctx.employee.id } }).catch(() => {});

  const gone = await db.user.delete({ where: { id } }).then(() => true).catch(() => false);
  if (!gone) {
    // Surface it rather than leaking silently — a leftover disposable admin
    // is exactly the thing that must not accumulate in production.
    process.stdout.write(`  ⚠ destroyUser: ${ctx.user.email} could not be deleted (FK still referencing)\n`);
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────

/**
 * Nginx rate-limits /api at 10r/s burst 20 — 110ms spacing keeps us clear
 * without making a 400-request suite take forever.
 */
export async function api(jar, method, path, body) {
  await sleep(110);
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: {
      Cookie: jar.header(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get("content-type") ?? "";
  let payload = null;
  if (ct.includes("application/json")) {
    payload = await res.json().catch(() => null);
  } else {
    payload = await res.text().catch(() => null);
  }
  return { ok: res.ok, status: res.status, payload, headers: res.headers };
}

/** Raw-body variant for malformed-JSON tests. */
export async function apiRaw(jar, method, path, rawBody, contentType = "application/json") {
  await sleep(110);
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: { Cookie: jar.header(), "Content-Type": contentType },
    body: rawBody,
  });
  let payload = null;
  try { payload = await res.json(); } catch { payload = await res.text().catch(() => null); }
  return { ok: res.ok, status: res.status, payload };
}

/** Pull an id out of the many response envelopes the API uses. */
export function idOf(payload) {
  return payload?.id ?? payload?.data?.id ?? payload?.lead?.id ?? payload?.user?.id ?? null;
}
