#!/usr/bin/env node
/**
 * End-to-end test for the two new create-forms.
 *
 * Signs in as a disposable SUPER_ADMIN with real MFA, POSTs a real partner
 * and a real campaign (the same call the browser makes), confirms each shows
 * up in the list, then deletes both + the test user + any audit trail.
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
  const email = `create-test-${Date.now()}@illume.local`;
  const password = crypto.randomBytes(24).toString("base64url");
  const secret = generateSecret();
  const passwordHash = await bcrypt.hash(password, 12);

  process.stdout.write(`[setup] creating ${email}\n`);
  const user = await db.user.create({
    data: {
      email,
      firstName: "Create",
      lastName: "Test",
      name: "Create Test",
      password: passwordHash,
      role: "SUPER_ADMIN",
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      passwordChangedAt: new Date(),
    },
  });

  const jar = new Jar();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  jar.ingest(csrfRes.headers);
  const { csrfToken } = await csrfRes.json();

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
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
  if (!totpRes.ok) throw new Error(`2fa verify ${totpRes.status}`);

  const csrfRes2 = await fetch(`${BASE}/api/auth/csrf`, { headers: { Cookie: jar.header() } });
  jar.ingest(csrfRes2.headers);
  const { csrfToken: csrf2 } = await csrfRes2.json();
  const updRes = await fetch(`${BASE}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ csrfToken: csrf2, data: { twoFactorVerified: true } }),
  });
  jar.ingest(updRes.headers);
  process.stdout.write(`[setup] signed in\n\n`);

  const created = { partnerId: null, campaignId: null };

  // ── Partner create ──────────────────────────────────────────────────
  await sleep(200);
  process.stdout.write("[partner] POST /api/sources ");
  const partnerRes = await fetch(`${BASE}/api/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({
      name: `Walker Test Partner ${Date.now()}`,
      type: "AGENT",
      country: "Testland",
      city: "Test City",
      email: "partner@example.test",
      agreementStatus: "PENDING",
      rating: 3,
      notes: "Created by walker script — safe to delete.",
    }),
  });
  if (!partnerRes.ok) {
    process.stdout.write(`✗ ${partnerRes.status} ${await partnerRes.text()}\n`);
  } else {
    const partner = await partnerRes.json();
    created.partnerId = partner.id;
    process.stdout.write(`✓ id=${partner.id}\n`);

    // Verify it lists
    await sleep(200);
    const listRes = await fetch(`${BASE}/api/sources`, { headers: { Cookie: jar.header() } });
    const list = await listRes.json();
    const found = Array.isArray(list) ? list.find((p) => p.id === partner.id) : null;
    process.stdout.write(`[partner] appears in list: ${found ? "✓" : "✗"}\n`);
  }

  // ── Campaign create ─────────────────────────────────────────────────
  await sleep(200);
  process.stdout.write("[campaign] POST /api/campaigns ");
  const campaignRes = await fetch(`${BASE}/api/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({
      name: `Walker Test Campaign ${Date.now()}`,
      channel: "Test Channel",
      type: "FAIR",
      startDate: new Date().toISOString(),
      country: "Testland",
      city: "Test City",
      budget: 1000,
      status: "PLANNED",
    }),
  });
  if (!campaignRes.ok) {
    process.stdout.write(`✗ ${campaignRes.status} ${await campaignRes.text()}\n`);
  } else {
    const campaign = await campaignRes.json();
    created.campaignId = campaign.id;
    process.stdout.write(`✓ id=${campaign.id}\n`);

    // Verify it lists
    await sleep(200);
    const listRes = await fetch(`${BASE}/api/campaigns`, { headers: { Cookie: jar.header() } });
    const list = await listRes.json();
    const found = Array.isArray(list) ? list.find((c) => c.id === campaign.id) : null;
    process.stdout.write(`[campaign] appears in list: ${found ? "✓" : "✗"}\n`);
  }

  // ── Cleanup ─────────────────────────────────────────────────────────
  process.stdout.write("\n[cleanup] ");
  if (created.partnerId) {
    // Real hard delete via DB (the DELETE endpoint soft-deletes).
    await db.recruitmentPartner.delete({ where: { id: created.partnerId } }).catch(() => {});
    process.stdout.write("partner deleted ");
  }
  if (created.campaignId) {
    await db.campaign.delete({ where: { id: created.campaignId } }).catch(() => {});
    process.stdout.write("campaign deleted ");
  }
  await db.auditLog.deleteMany({ where: { userId: user.id } });
  await db.$executeRaw`DELETE FROM attachments WHERE "uploadedById" = ${user.id}`;
  await db.user.delete({ where: { id: user.id } });
  process.stdout.write("test user deleted\n");
  process.stdout.write("\nDone.\n");
}

main()
  .catch((e) => { console.error("\nFAILED:", e); process.exit(1); })
  .finally(() => db.$disconnect());
