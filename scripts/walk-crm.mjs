#!/usr/bin/env node
/**
 * Full route walker — hits every dashboard page + every documented API as a
 * disposable SUPER_ADMIN, records HTTP status and error signatures for each.
 *
 * What "as a real user" means here:
 *   • Real login flow (credentials + TOTP + session-update to flip
 *     twoFactorPending), not a bypass.
 *   • Real production URL over HTTPS via nginx, not localhost.
 *   • Real navigation — GET each page, follow no redirects, log what came back.
 *   • Where a page's obvious action is an API call (list load, "add X"), also
 *     hit that API and log it.
 *
 * Runs on the VPS so it can reach @prisma/client + otplib from node_modules.
 * Cleans up the test user + any rows it wrote before exiting.
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

// Cookie jar identical to test-attachments.mjs.
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

const results = [];
function record(kind, path, status, note = "") {
  results.push({ kind, path, status, note });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hit(jar, path, opts = {}) {
  // Rate-limit safety: 50ms between hits keeps us clear of nginx's 10r/s + burst 20.
  await sleep(80);
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    redirect: "manual",
    headers: {
      Cookie: jar.header(),
      ...(opts.headers ?? {}),
    },
    body: opts.body,
  });
  jar.ingest(res.headers);
  return res;
}

// Classify HTTP status against expectation.
//   • Page: 200 OK, 3xx redirect. Anything else is a problem.
//   • API GET: 200 OK. 400 with a validation message is acceptable if params
//     are missing; log it but don't flag as broken.
function classify(kind, status) {
  if (kind === "PAGE") {
    if (status >= 200 && status < 400) return "ok";
    return "BROKEN";
  }
  if (kind === "API") {
    if (status >= 200 && status < 300) return "ok";
    if (status === 400 || status === 422) return "validation";
    if (status === 401) return "auth-drift";
    if (status === 403) return "forbidden";
    return "BROKEN";
  }
  return "?";
}

async function main() {
  // ── 1. Disposable admin ───────────────────────────────────────────────
  const email = `walker-${Date.now()}@illume.local`;
  const password = crypto.randomBytes(24).toString("base64url");
  const secret = generateSecret();
  const passwordHash = await bcrypt.hash(password, 12);

  process.stdout.write(`[setup] creating ${email}\n`);
  const user = await db.user.create({
    data: {
      email,
      firstName: "Walker",
      lastName: "Test",
      name: "Walker Test",
      password: passwordHash,
      role: "SUPER_ADMIN",
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      passwordChangedAt: new Date(),
    },
  });

  // ── 2. Sign in ────────────────────────────────────────────────────────
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
  if (loginRes.status >= 500) throw new Error(`credentials POST ${loginRes.status}`);

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

  const sessRes = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: jar.header() } });
  const session = await sessRes.json();
  if (!session?.user?.email) throw new Error("no session user");
  process.stdout.write(`[setup] signed in as ${session.user.email}\n\n`);

  // ── 3. Resolve real IDs so detail routes get exercised ────────────────
  const [aLead, aInst, aEvent, aReport, aMarket, aPartner, aPlan, aMkt] = await Promise.all([
    db.lead.findFirst({ where: { deletedAt: null }, select: { id: true } }),
    db.institution.findFirst({ where: { deletedAt: null }, select: { id: true } }),
    db.event.findFirst({ where: { deletedAt: null }, select: { id: true } }),
    db.monthlyReport.findFirst({ select: { id: true } }),
    db.market.findFirst({ select: { id: true } }),
    db.recruitmentPartner.findFirst({ where: { deletedAt: null }, select: { id: true } }),
    db.quarterlyRecruitmentPlan.findFirst({ select: { id: true } }).catch(() => null),
    db.market.findFirst({ select: { id: true } }),
  ]);

  // ── 4. Page walk ──────────────────────────────────────────────────────
  const pages = [
    "/dashboard",
    "/activities",
    "/activity-log",
    "/analytics",
    "/account",
    "/events",
    aEvent && `/events/${aEvent.id}`,
    "/field-operations",
    "/hr",
    "/hr?tab=employees",
    "/hr?tab=leave",
    "/hr?tab=holidays",
    "/hr?tab=attendance",
    "/hr?tab=tasks",
    "/hr?tab=announcements",
    "/hr?tab=assets",
    "/hr?tab=knowledge",
    "/hr?tab=performance-reviews",
    "/hr?tab=succession-planning",
    "/hr?tab=account-requests",
    "/hr?tab=leave-balances",
    "/institutions",
    aInst && `/institutions/${aInst.id}`,
    "/knowledge",
    "/market-intelligence",
    aMkt && `/market-intelligence/${aMkt.id}`,
    "/markets",
    aMarket && `/markets/${aMarket.id}`,
    "/recruitment-network",
    "/recruitment-network/campaigns",
    "/recruitment-network/events",
    "/recruitment-network/partners",
    aPartner && `/recruitment-network/partners/${aPartner.id}`,
    "/recruitment-network/performance",
    "/recruitment-planning",
    aPlan && `/recruitment-planning/${aPlan.id}`,
    "/reports",
    aReport && `/reports/${aReport.id}`,
    aReport && `/reports/${aReport.id}/edit`,
    "/reports/auto-populate",
    "/reports/new",
    "/reports/qbr",
    "/risk-compliance",
    "/search",
    "/settings",
    "/students",
    aLead && `/students/${aLead.id}`,
    "/students/offline",
    "/tasks",
    "/travel",
    "/whatsapp",
  ].filter(Boolean);

  process.stdout.write("=== PAGES ===\n");
  for (const p of pages) {
    const res = await hit(jar, p);
    const verdict = classify("PAGE", res.status);
    record("PAGE", p, res.status, verdict);
    const flag = verdict === "ok" ? " " : verdict === "BROKEN" ? "✗" : "!";
    process.stdout.write(`${flag} PAGE ${res.status}  ${p}\n`);
  }

  // ── 5. API walk ───────────────────────────────────────────────────────
  const apis = [
    "/api/dashboard/stats",
    "/api/activities",
    "/api/analytics/executive",
    "/api/analytics/overview",
    "/api/analytics/regional",
    "/api/leads",
    aLead && `/api/leads/${aLead.id}`,
    aLead && `/api/leads/${aLead.id}/activities`,
    aLead && `/api/leads/${aLead.id}/applications`,
    aLead && `/api/leads/${aLead.id}/checklist`,
    aLead && `/api/leads/${aLead.id}/notes`,
    "/api/institutions",
    aInst && `/api/institutions/${aInst.id}`,
    aInst && `/api/institutions/${aInst.id}/contacts`,
    aInst && `/api/institutions/${aInst.id}/contracts`,
    aInst && `/api/institutions/${aInst.id}/deliverables`,
    aInst && `/api/institutions/${aInst.id}/documents`,
    aInst && `/api/institutions/${aInst.id}/engagement`,
    aInst && `/api/institutions/${aInst.id}/health`,
    aInst && `/api/institutions/${aInst.id}/issues`,
    aInst && `/api/institutions/${aInst.id}/knowledge`,
    aInst && `/api/institutions/${aInst.id}/kpis`,
    "/api/sources",
    aPartner && `/api/sources/${aPartner.id}`,
    "/api/partner-contacts",
    "/api/campaigns",
    "/api/events",
    aEvent && `/api/events/${aEvent.id}`,
    "/api/markets",
    aMarket && `/api/markets/${aMarket.id}`,
    "/api/tasks",
    "/api/tasks/dashboard",
    "/api/reports",
    aReport && `/api/reports/${aReport.id}`,
    "/api/reports/qbr",
    "/api/reports/auto-populate",
    "/api/recruitment-planning/plans",
    "/api/risks",
    "/api/compliance",
    "/api/hr/employees",
    "/api/hr/departments",
    "/api/hr/leave",
    "/api/hr/leave/balances",
    "/api/hr/announcements",
    "/api/hr/holidays",
    "/api/hr/tasks",
    "/api/hr/attendance",
    "/api/hr/assets",
    "/api/hr/knowledge-base",
    "/api/hr/performance-reviews",
    "/api/hr/succession-plans",
    "/api/hr/account-requests",
    "/api/hr/regions",
    "/api/hr/unlinked-users",
    "/api/settings/users",
    "/api/settings/permissions",
    "/api/settings/regions",
    "/api/notifications",
    "/api/travel",
    "/api/whatsapp/conversations",
    "/api/knowledge/proposals",
    "/api/activity-log",
    "/api/institution-interests?leadId=" + (aLead?.id ?? "none"),
    "/api/market-intelligence/suggestions",
    "/api/market-intelligence/quarterly-report",
    "/api/stakeholders/agents",
    "/api/stakeholders/counsellors",
    "/api/stakeholders/schools",
    "/api/auth/2fa/status",
    "/api/auth/login-status",
  ].filter(Boolean);

  process.stdout.write("\n=== APIs ===\n");
  for (const a of apis) {
    const res = await hit(jar, a);
    const verdict = classify("API", res.status);
    record("API", a, res.status, verdict);
    const flag = verdict === "ok" ? " " : verdict === "BROKEN" ? "✗" : "!";
    process.stdout.write(`${flag} API  ${res.status}  ${a}\n`);
  }

  // ── 6. Summary ────────────────────────────────────────────────────────
  const broken = results.filter((r) => r.note === "BROKEN");
  const noise = results.filter((r) => ["validation", "forbidden", "auth-drift"].includes(r.note));
  process.stdout.write(`\n=== SUMMARY ===\n`);
  process.stdout.write(`total: ${results.length}  broken: ${broken.length}  soft: ${noise.length}  ok: ${results.length - broken.length - noise.length}\n`);
  if (broken.length > 0) {
    process.stdout.write(`\nBROKEN:\n`);
    for (const b of broken) process.stdout.write(`  ${b.kind} ${b.status} ${b.path}\n`);
  }
  if (noise.length > 0) {
    process.stdout.write(`\nSOFT (not necessarily bugs — 401/403/400 responses):\n`);
    for (const n of noise) process.stdout.write(`  ${n.kind} ${n.status} ${n.note.padEnd(11)} ${n.path}\n`);
  }

  // ── 7. Cleanup ────────────────────────────────────────────────────────
  await db.auditLog.deleteMany({ where: { userId: user.id } });
  await db.$executeRaw`DELETE FROM attachments WHERE "uploadedById" = ${user.id}`;
  await db.user.delete({ where: { id: user.id } });
  process.stdout.write(`\n[cleanup] removed test user ${email}\n`);
}

main()
  .catch((e) => {
    console.error("\nFAILED:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
