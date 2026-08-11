#!/usr/bin/env node
/**
 * End-to-end recycle-bin test. For each testable entity type:
 *   1. Create a throwaway record.
 *   2. Delete it via the same HTTP endpoint the UI uses.
 *   3. Confirm it appears in /api/recycle-bin.
 *   4. Restore it via /api/recycle-bin/[id]/restore.
 *   5. Confirm the underlying entity is back.
 *   6. Delete again → purge → confirm the entity is gone and the bin
 *      entry is marked purged.
 *
 * Runs against the live prod URL over HTTPS as a disposable SUPER_ADMIN
 * with real MFA. Cleans up on exit.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ── Setup: disposable SUPER_ADMIN ─────────────────────────────────
  const email = `recycle-test-${Date.now()}@illume.local`;
  const password = crypto.randomBytes(24).toString("base64url");
  const secret = generateSecret();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.create({
    data: {
      email, firstName: "Recycle", lastName: "Test", name: "Recycle Test",
      password: passwordHash, role: "SUPER_ADMIN", isActive: true,
      twoFactorEnabled: true, twoFactorSecret: secret,
      passwordChangedAt: new Date(),
    },
  });
  process.stdout.write(`[setup] user ${user.id}\n`);

  const employee = await db.employee.create({
    data: {
      userId: user.id, employeeId: `EMP-RB-${Date.now()}`,
      jobTitle: "Test Admin", employmentType: "FULL_TIME",
      startDate: new Date(),
    },
  }).catch(() => null);

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
  const csrfRes2 = await fetch(`${BASE}/api/auth/csrf`, { headers: { Cookie: jar.header() } });
  jar.ingest(csrfRes2.headers);
  const { csrfToken: csrf2 } = await csrfRes2.json();
  await fetch(`${BASE}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ csrfToken: csrf2, data: { twoFactorVerified: true } }),
  }).then((r) => jar.ingest(r.headers));
  process.stdout.write(`[setup] signed in\n\n`);

  // ── Helpers ────────────────────────────────────────────────────────
  async function api(method, path, body) {
    await sleep(120);
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: jar.header() },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    let payload = null;
    try { payload = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, payload };
  }

  async function findInBin(entityType, entityId) {
    const r = await api("GET", `/api/recycle-bin?entityType=${entityType}`);
    if (!r.ok) return null;
    return r.payload.data.find((x) => x.entityId === entityId) ?? null;
  }

  // ── Test scenarios ──────────────────────────────────────────────────
  const scenarios = [];

  // Partner (soft-delete)
  scenarios.push({
    name: "RecruitmentPartner",
    setup: async () => {
      const r = await api("POST", "/api/sources", {
        name: `RB Test Partner ${Date.now()}`,
        type: "AGENT", country: "Testland",
      });
      return r.ok ? r.payload.id : null;
    },
    deleteUrl: (id) => `/api/sources/${id}`,
    verifyGone: async (id) => {
      const r = await db.recruitmentPartner.findUnique({ where: { id } });
      return r?.deletedAt != null;
    },
    verifyBack: async (id) => {
      const r = await db.recruitmentPartner.findUnique({ where: { id } });
      return r?.deletedAt == null;
    },
    verifyPurged: async (id) => {
      const r = await db.recruitmentPartner.findUnique({ where: { id } });
      return r == null;
    },
  });

  // Campaign (soft-delete)
  scenarios.push({
    name: "Campaign",
    setup: async () => {
      const r = await api("POST", "/api/campaigns", {
        name: `RB Test Campaign ${Date.now()}`,
        channel: "test", startDate: new Date().toISOString(),
      });
      return r.ok ? r.payload.id : null;
    },
    // Campaigns don't have their own DELETE endpoint currently — skip.
    skip: true,
  });

  // School (soft-delete)
  scenarios.push({
    name: "School",
    setup: async () => {
      const r = await api("POST", "/api/stakeholders/schools", {
        name: `RB Test School ${Date.now()}`, country: "Testland",
        type: "PRIVATE", relationshipStatus: "DEVELOPING",
      });
      return r.ok ? r.payload.id : null;
    },
    deleteUrl: (id) => `/api/stakeholders/schools/${id}`,
    verifyGone: async (id) => {
      const r = await db.school.findUnique({ where: { id } });
      return r?.deletedAt != null;
    },
    verifyBack: async (id) => {
      const r = await db.school.findUnique({ where: { id } });
      return r?.deletedAt == null;
    },
    verifyPurged: async (id) => {
      const r = await db.school.findUnique({ where: { id } });
      return r == null;
    },
  });

  // Risk (hard-delete via snapshot)
  scenarios.push({
    name: "RiskRegister",
    setup: async () => {
      const r = await api("POST", "/api/risks", {
        type: "MARKET", title: `RB Test Risk ${Date.now()}`,
        likelihood: 3, impact: 3, status: "OPEN",
        ownerId: user.id,
      });
      return r.ok ? r.payload.id : null;
    },
    deleteUrl: (id) => `/api/risks/${id}`,
    verifyGone: async (id) => {
      const r = await db.riskRegister.findUnique({ where: { id } });
      return r == null; // hard-deleted
    },
    verifyBack: async (id) => {
      const r = await db.riskRegister.findUnique({ where: { id } });
      return r != null;
    },
    verifyPurged: async (id) => {
      const r = await db.riskRegister.findUnique({ where: { id } });
      return r == null;
    },
  });

  // Compliance (hard-delete via snapshot)
  scenarios.push({
    name: "ComplianceItem",
    setup: async () => {
      const r = await api("POST", "/api/compliance", {
        complianceType: "GDPR",
        title: `RB Test Compliance ${Date.now()}`,
        status: "PENDING",
      });
      return r.ok ? r.payload.id : null;
    },
    deleteUrl: (id) => `/api/compliance/${id}`,
    verifyGone: async (id) => {
      const r = await db.complianceItem.findUnique({ where: { id } });
      return r == null;
    },
    verifyBack: async (id) => {
      const r = await db.complianceItem.findUnique({ where: { id } });
      return r != null;
    },
    verifyPurged: async (id) => {
      const r = await db.complianceItem.findUnique({ where: { id } });
      return r == null;
    },
  });

  // Attachment (soft-delete after migration 023)
  scenarios.push({
    name: "Attachment",
    setup: async () => {
      const lead = await db.lead.findFirst({ where: { deletedAt: null }, select: { id: true } });
      if (!lead) return null;
      const fd = new FormData();
      fd.append(
        "file",
        new Blob([`recycle-bin test ${Date.now()}`], { type: "text/plain" }),
        "rb-test.txt"
      );
      await sleep(120);
      const res = await fetch(
        `${BASE}/api/attachments?parentType=LEAD&parentId=${encodeURIComponent(lead.id)}`,
        { method: "POST", headers: { Cookie: jar.header() }, body: fd }
      );
      if (!res.ok) return null;
      const body = await res.json();
      return body.data.id;
    },
    deleteUrl: (id) => `/api/attachments/${id}`,
    verifyGone: async (id) => {
      const r = await db.attachment.findUnique({ where: { id } });
      return r?.deletedAt != null;
    },
    verifyBack: async (id) => {
      const r = await db.attachment.findUnique({ where: { id } });
      return r?.deletedAt == null;
    },
    verifyPurged: async (id) => {
      const r = await db.attachment.findUnique({ where: { id } });
      return r == null;
    },
  });

  // ── Run scenarios ───────────────────────────────────────────────────
  process.stdout.write("=== Per-entity round-trip ===\n");
  const summary = { pass: 0, fail: 0 };
  const trace = [];

  for (const s of scenarios) {
    if (s.skip) {
      process.stdout.write(`  ${s.name.padEnd(22)} SKIP (no HTTP DELETE)\n`);
      continue;
    }
    let step = "setup";
    try {
      const id = await s.setup();
      if (!id) { throw new Error("setup returned no id"); }
      trace.push({ entity: s.name, id });

      // Delete
      step = "delete";
      const del1 = await api("DELETE", s.deleteUrl(id));
      if (!del1.ok) throw new Error(`delete1 HTTP ${del1.status} ${JSON.stringify(del1.payload)}`);

      // Confirm gone-from-live
      step = "verify gone";
      if (!(await s.verifyGone(id))) throw new Error("row not deleted after DELETE");

      // Confirm in bin
      step = "in bin";
      const inBin = await findInBin(s.name, id);
      if (!inBin) throw new Error("not found in /api/recycle-bin");

      // Restore
      step = "restore";
      const restore = await api("POST", `/api/recycle-bin/${inBin.id}/restore`);
      if (!restore.ok) throw new Error(`restore HTTP ${restore.status} ${JSON.stringify(restore.payload)}`);

      // Confirm back
      step = "verify back";
      if (!(await s.verifyBack(id))) throw new Error("row not restored");

      // Delete again + purge
      step = "second delete";
      const del2 = await api("DELETE", s.deleteUrl(id));
      if (!del2.ok) throw new Error(`delete2 HTTP ${del2.status}`);
      const inBin2 = await findInBin(s.name, id);
      if (!inBin2) throw new Error("second delete didn't index in bin");

      step = "purge";
      const purge = await api("DELETE", `/api/recycle-bin/${inBin2.id}`);
      if (!purge.ok) throw new Error(`purge HTTP ${purge.status} ${JSON.stringify(purge.payload)}`);

      step = "verify purged";
      if (!(await s.verifyPurged(id))) throw new Error("row still present after purge");

      process.stdout.write(`  ${s.name.padEnd(22)} ✓\n`);
      summary.pass++;
    } catch (err) {
      process.stdout.write(`  ${s.name.padEnd(22)} ✗ at ${step}: ${err.message}\n`);
      summary.fail++;
    }
  }

  process.stdout.write(`\n=== SUMMARY ===\n${summary.pass} pass · ${summary.fail} fail\n`);

  // ── Cleanup ─────────────────────────────────────────────────────────
  process.stdout.write("\n[cleanup] ");
  // Any lingering entities from failed tests
  for (const t of trace) {
    try {
      const model = (
        { RecruitmentPartner: "recruitmentPartner", School: "school",
          RiskRegister: "riskRegister", ComplianceItem: "complianceItem",
          Attachment: "attachment" }
      )[t.entity];
      if (model) await db[model].deleteMany({ where: { id: t.id } }).catch(() => {});
    } catch {}
  }
  // Delete deleted_records entries the test may have left behind
  await db.deletedRecord.deleteMany({ where: { deletedById: user.id } });
  if (employee) await db.employee.delete({ where: { id: employee.id } }).catch(() => {});
  await db.auditLog.deleteMany({ where: { userId: user.id } });
  await db.$executeRaw`DELETE FROM attachments WHERE "uploadedById" = ${user.id}`;
  await db.user.delete({ where: { id: user.id } });
  process.stdout.write("user + entities cleaned\n");
}

main().catch((e) => { console.error("\nFAILED:", e); process.exit(1); }).finally(() => db.$disconnect());
