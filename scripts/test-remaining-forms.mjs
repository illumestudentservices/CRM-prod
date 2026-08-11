#!/usr/bin/env node
/**
 * End-to-end test for the 4 newest UI wire-ups:
 *   1. POST /api/stakeholders/schools (Add School)
 *   2. POST /api/stakeholders/counsellors (Add Counsellor)
 *   3. POST /api/market-intelligence/quarterly-report (Quarterly Report)
 *   4. POST /api/tasks/templates/fire (Fire Template) — skipped if no template rows exist
 *
 * Merge duplicates isn't tested here because it requires two real duplicate
 * leads and permanently soft-deletes one; that's a destructive op we'd only
 * want to run against fixtures we own.
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
  const email = `remaining-forms-test-${Date.now()}@illume.local`;
  const password = crypto.randomBytes(24).toString("base64url");
  const secret = generateSecret();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.create({
    data: {
      email, firstName: "Remaining", lastName: "Test", name: "Remaining Test",
      password: passwordHash, role: "SUPER_ADMIN", isActive: true,
      twoFactorEnabled: true, twoFactorSecret: secret,
      passwordChangedAt: new Date(),
    },
  });
  process.stdout.write(`[setup] user ${user.id}\n`);

  // Every super-admin needs an Employee profile for the fire-template
  // endpoint (it looks up createdById from Employee).
  const employee = await db.employee.create({
    data: {
      userId: user.id,
      employeeId: `EMP-TEST-${Date.now()}`,
      jobTitle: "Test Admin",
      employmentType: "FULL_TIME",
      startDate: new Date(),
    },
  }).catch((e) => { process.stdout.write(`[setup] employee create failed: ${e.message}\n`); return null; });

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
  process.stdout.write("[setup] signed in\n\n");

  const created = { schoolId: null, counsellorId: null };

  // 1. Add School
  await sleep(200);
  process.stdout.write("[school] POST ");
  const sRes = await fetch(`${BASE}/api/stakeholders/schools`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({
      name: `Test High ${Date.now()}`,
      country: "Testland",
      city: "Test City",
      type: "PRIVATE",
      relationshipStatus: "DEVELOPING",
    }),
  });
  if (!sRes.ok) { process.stdout.write(`✗ ${sRes.status} ${await sRes.text()}\n`); }
  else {
    const s = await sRes.json();
    created.schoolId = s.id;
    process.stdout.write(`✓ id=${s.id}\n`);
  }

  // 2. Add Counsellor (needs a school)
  if (created.schoolId) {
    await sleep(200);
    process.stdout.write("[counsellor] POST ");
    const cRes = await fetch(`${BASE}/api/stakeholders/counsellors`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: jar.header() },
      body: JSON.stringify({
        name: `Test Counsellor ${Date.now()}`,
        schoolId: created.schoolId,
        email: "test@example.com",
        position: "Head of Careers",
        influenceScore: 7,
      }),
    });
    if (!cRes.ok) { process.stdout.write(`✗ ${cRes.status} ${await cRes.text()}\n`); }
    else {
      const c = await cRes.json();
      created.counsellorId = c.id;
      process.stdout.write(`✓ id=${c.id}\n`);
    }
  }

  // 3. Quarterly Report (needs a real market)
  await sleep(200);
  process.stdout.write("[quarterly-report] POST ");
  const market = await db.market.findFirst({ select: { id: true } });
  if (!market) {
    process.stdout.write("skipped (no market rows)\n");
  } else {
    const qRes = await fetch(`${BASE}/api/market-intelligence/quarterly-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: jar.header() },
      body: JSON.stringify({ marketId: market.id, quarter: 3, year: 2026 }),
    });
    if (!qRes.ok) {
      process.stdout.write(`✗ ${qRes.status} ${await qRes.text()}\n`);
    } else {
      const q = await qRes.json();
      const keys = Object.keys(q).slice(0, 5).join(",");
      process.stdout.write(`✓ payload keys: ${keys}\n`);
    }
  }

  // 4. Fire Template
  await sleep(200);
  process.stdout.write("[fire-template] POST ");
  const template = await db.taskTemplate.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!template) {
    process.stdout.write("skipped (no active templates)\n");
  } else {
    const fRes = await fetch(`${BASE}/api/tasks/templates/fire`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: jar.header() },
      body: JSON.stringify({ templateId: template.id }),
    });
    if (!fRes.ok) {
      process.stdout.write(`✗ ${fRes.status} ${await fRes.text()}\n`);
    } else {
      const f = await fRes.json();
      const n = Array.isArray(f) ? f.length : (f?.created ?? "?");
      process.stdout.write(`✓ tasks created: ${n}\n`);
    }
  }

  // Cleanup
  process.stdout.write("\n[cleanup] ");
  if (created.counsellorId) {
    await db.counsellor.delete({ where: { id: created.counsellorId } }).catch(() => {});
    process.stdout.write("counsellor ");
  }
  if (created.schoolId) {
    await db.school.delete({ where: { id: created.schoolId } }).catch(() => {});
    process.stdout.write("school ");
  }
  // Delete any tasks the test admin created via fire-template
  await db.task.deleteMany({ where: { createdById: employee?.id } }).catch(() => {});
  if (employee) await db.employee.delete({ where: { id: employee.id } }).catch(() => {});
  await db.auditLog.deleteMany({ where: { userId: user.id } });
  await db.$executeRaw`DELETE FROM attachments WHERE "uploadedById" = ${user.id}`;
  await db.user.delete({ where: { id: user.id } });
  process.stdout.write("user cleaned\n\nDone.\n");
}

main().catch((e) => { console.error("\nFAILED:", e); process.exit(1); }).finally(() => db.$disconnect());
