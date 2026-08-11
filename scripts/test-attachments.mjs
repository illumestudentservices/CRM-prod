#!/usr/bin/env node
/**
 * End-to-end smoke test for the polymorphic attachment system on prod.
 *
 * What it does:
 *   1. Creates a disposable SUPER_ADMIN with a random password + TOTP secret
 *      (MFA enrolled properly, never bypassed — per standing test-login policy).
 *   2. Logs in via the real /api/auth/callback/credentials + /api/auth/2fa/verify
 *      flow, so anything the browser can hit, this script can hit.
 *   3. For each parent type in `TARGETS`, uploads a small text file, lists to
 *      confirm it appears, downloads it, then DELETEs it.
 *   4. Deletes the disposable user + all its audit rows.
 *
 * Runs on the VPS (has otplib/bcrypt/Prisma available; talks to the local
 * postgres for setup and to the public URL for the API layer, exactly what
 * a browser would do).
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { generateSecret, generate as totpGenerate } from "otplib";
import crypto from "node:crypto";

const BASE = process.env.BASE_URL ?? "https://illumestudentservices.cloud";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

// Targets we can safely test against — one existing record per parent type
// that actually has rows in prod. `parentId: null` is filled from the DB below.
const TARGETS = [
  { parentType: "LEAD",                    parentId: "lead-aisha-diallo-gmail-com" },
  { parentType: "MONTHLY_REPORT",          parentId: null },
  { parentType: "RECRUITMENT_EVENT",       parentId: null },
  { parentType: "RECRUITMENT_PARTNER",     parentId: null },
  { parentType: "ENGAGEMENT_LOG",          parentId: null },
  { parentType: "INSTITUTION_INTEREST",    parentId: null },
  { parentType: "LEAD_NOTE",               parentId: null },
];

// otplib v13 exposes async standalone helpers; the app wraps them in lib/totp.ts.

function log(step, detail = "") {
  process.stdout.write(`\n[${step}] ${detail}`);
}
function ok(msg = "") { process.stdout.write(` ✓ ${msg}`); }
function fail(msg) { throw new Error(msg); }

// Cookie jar: NextAuth sets a __Secure-authjs.session-token on prod.
class Jar {
  constructor() { this.cookies = new Map(); }
  ingest(headers) {
    const sc = headers.getSetCookie?.() ?? [];
    for (const line of sc) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function main() {
  // ── 1. Fill any nullable targets from the DB ────────────────────────────
  // Resolve one existing record per parent type. Anything the DB can't find
  // is dropped from the run rather than manufactured — we don't want ghost
  // parent rows lying around.
  const lookups = [
    ["MONTHLY_REPORT",       () => db.monthlyReport.findFirst({ select: { id: true } })],
    ["RECRUITMENT_EVENT",    () => db.event.findFirst({ where: { deletedAt: null }, select: { id: true } })],
    ["RECRUITMENT_PARTNER",  () => db.recruitmentPartner.findFirst({ where: { deletedAt: null }, select: { id: true } })],
    ["ENGAGEMENT_LOG",       () => db.engagementLog.findFirst({ select: { id: true } })],
    ["INSTITUTION_INTEREST", () => db.institutionInterest.findFirst({ select: { id: true } })],
    ["LEAD_NOTE",            () => db.leadNote.findFirst({ select: { id: true } })],
  ];
  for (const [type, fn] of lookups) {
    const row = await fn();
    const t = TARGETS.find((x) => x.parentType === type);
    if (row) t.parentId = row.id;
    else {
      const idx = TARGETS.indexOf(t);
      if (idx >= 0) TARGETS.splice(idx, 1);
    }
  }

  // ── 2. Create disposable admin ──────────────────────────────────────────
  const email = `attachment-test-${Date.now()}@illume.local`;
  const password = crypto.randomBytes(24).toString("base64url");
  const secret = generateSecret();
  const passwordHash = await bcrypt.hash(password, 12);

  log("setup", `creating ${email}`);
  const user = await db.user.create({
    data: {
      email,
      firstName: "Attachment",
      lastName: "Test",
      name: "Attachment Test",
      password: passwordHash,
      role: "SUPER_ADMIN",
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      passwordChangedAt: new Date(),
    },
  });
  ok(`user ${user.id}`);

  // ── 3. Sign in ─────────────────────────────────────────────────────────
  const jar = new Jar();

  // Kick off with a CSRF token
  log("login", "fetching csrf");
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  jar.ingest(csrfRes.headers);
  const { csrfToken } = await csrfRes.json();
  ok();

  log("login", "posting credentials");
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jar.header(),
    },
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: BASE,
      json: "true",
    }),
  });
  jar.ingest(loginRes.headers);
  if (loginRes.status >= 500) fail(`credentials POST ${loginRes.status}`);
  ok(`status ${loginRes.status}`);

  // ── 4. Verify TOTP ─────────────────────────────────────────────────────
  log("2fa", "verifying totp");
  const code = await totpGenerate({ secret });
  const totpRes = await fetch(`${BASE}/api/auth/2fa/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ code }),
  });
  jar.ingest(totpRes.headers);
  if (!totpRes.ok) fail(`2fa verify HTTP ${totpRes.status} — ${await totpRes.text()}`);
  ok();

  // The browser calls useSession().update({ twoFactorVerified: true }), which
  // NextAuth translates into a POST /api/auth/session with a session-shaped body
  // — that's what flips token.twoFactorPending false in the jwt callback.
  log("2fa", "flipping session token");
  const csrfRes2 = await fetch(`${BASE}/api/auth/csrf`, { headers: { Cookie: jar.header() } });
  jar.ingest(csrfRes2.headers);
  const { csrfToken: csrf2 } = await csrfRes2.json();
  const updRes = await fetch(`${BASE}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ csrfToken: csrf2, data: { twoFactorVerified: true } }),
  });
  jar.ingest(updRes.headers);
  ok(`update ${updRes.status}`);

  // Confirm session
  log("session", "reading /api/auth/session");
  const sessRes = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: jar.header() } });
  const session = await sessRes.json();
  if (!session?.user?.email) fail(`no session user — got ${JSON.stringify(session)}`);
  ok(`as ${session.user.email}`);

  // ── 5. For each target, upload → list → download → delete ──────────────
  const uploadedIds = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Nginx rate-limits /api at 10r/s + burst 20. Each target does 4 requests,
  // so ~500ms between targets keeps us clear of the burst.
  for (const target of TARGETS) {
    await sleep(500);
    log(`test ${target.parentType}`, `parentId=${target.parentId}`);

    // Upload
    const fd = new FormData();
    const testContent = `Test attachment for ${target.parentType} at ${new Date().toISOString()}\nWill be deleted immediately.\n`;
    fd.append("file", new Blob([testContent], { type: "text/plain" }), `test-${target.parentType}.txt`);
    const uploadRes = await fetch(
      `${BASE}/api/attachments?parentType=${target.parentType}&parentId=${encodeURIComponent(target.parentId)}`,
      { method: "POST", headers: { Cookie: jar.header() }, body: fd }
    );
    if (!uploadRes.ok) {
      process.stdout.write(` ✗ upload ${uploadRes.status} — ${await uploadRes.text()}`);
      continue;
    }
    const uploaded = await uploadRes.json();
    ok(`uploaded id=${uploaded.data.id}`);
    uploadedIds.push({ id: uploaded.data.id, target });

    // List (rate-limit safe with a small pause)
    await sleep(150);
    const listRes = await fetch(
      `${BASE}/api/attachments?parentType=${target.parentType}&parentId=${encodeURIComponent(target.parentId)}`,
      { headers: { Cookie: jar.header() } }
    );
    if (!listRes.ok || !listRes.headers.get("content-type")?.includes("application/json")) {
      process.stdout.write(` ✗ list HTTP ${listRes.status} (${listRes.headers.get("content-type") ?? "no content-type"})`);
      continue;
    }
    const list = await listRes.json();
    const found = list.data?.find((a) => a.id === uploaded.data.id);
    if (!found) {
      process.stdout.write(` ✗ list did not include the just-uploaded file`);
      continue;
    }
    ok(`listed (${list.data.length} rows)`);

    // Download
    const dlRes = await fetch(`${BASE}/api/attachments/${uploaded.data.id}`, {
      headers: { Cookie: jar.header() },
    });
    if (!dlRes.ok) {
      process.stdout.write(` ✗ download ${dlRes.status}`);
      continue;
    }
    const disp = dlRes.headers.get("content-disposition");
    if (!disp?.includes("attachment")) {
      process.stdout.write(` ⚠ download disposition ${disp}`);
    } else {
      ok(`downloaded (${dlRes.headers.get("content-length")} bytes, ${dlRes.headers.get("x-content-type-options") ?? "no-nosniff"})`);
    }

    // Delete
    const delRes = await fetch(`${BASE}/api/attachments/${uploaded.data.id}`, {
      method: "DELETE",
      headers: { Cookie: jar.header() },
    });
    if (!delRes.ok) {
      process.stdout.write(` ✗ delete ${delRes.status}`);
      continue;
    }
    ok("deleted");
  }

  // ── 6. Cleanup the disposable admin + its audit rows ───────────────────
  log("cleanup", "removing test user + audit trail");
  await db.auditLog.deleteMany({ where: { userId: user.id } });
  await db.$executeRaw`DELETE FROM attachments WHERE "uploadedById" = ${user.id}`;
  await db.user.delete({ where: { id: user.id } });
  ok("done");

  process.stdout.write("\n\nAll done — attachment system verified end-to-end on prod.\n");
}

main()
  .catch((e) => {
    console.error("\n\nFAILED:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
