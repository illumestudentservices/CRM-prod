/**
 * Client list "needs attention" surfacing — real logins, three passes.
 *
 *   node --import tsx --env-file=.env scripts/qa-client-overview.mjs
 *
 * Open issues, an at-risk health rating and an imminent contract renewal all
 * existed only INSIDE a client record. The list showed a single
 * organisation-wide issue total at the top, so a client in trouble looked
 * exactly like one that was fine and an account manager had to open each in
 * turn to find out.
 *
 * Each pass signs in through the real form and reads the list as a person
 * would, then destroys its own account.
 */

import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

const PASSES = 3;
const allCreated = [];
const made = { institutions: [] };

async function signIn(page, email, password, secret) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  const submit = page.locator('button[type="submit"]').first();
  await submit.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 15000 }
  );
  await submit.click();
  await page.waitForURL(/verify-2fa/, { timeout: 20000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 20000 });
}

async function runPass(pass, browser) {
  startSection(`PASS ${pass} of ${PASSES} — real sign-in`);

  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  allCreated.push(admin);
  const row = await db.user.findUnique({
    where: { id: admin.user.id },
    select: { twoFactorSecret: true },
  });

  const soon = new Date(Date.now() + 21 * 86400000);

  // One client that needs attention, one that does not — the healthy one is
  // what proves the pills are conditional rather than always drawn.
  const troubled = await db.institution.create({
    data: {
      name: `${TAG}-p${pass}-Troubled`, country: "Malaysia", type: "UNIVERSITY",
      createdById: admin.user.id, accountHealth: "RED", renewalDate: soon,
    },
  });
  const healthy = await db.institution.create({
    data: {
      name: `${TAG}-p${pass}-Healthy`, country: "Vietnam", type: "UNIVERSITY",
      createdById: admin.user.id, accountHealth: "GREEN",
    },
  });
  made.institutions.push(troubled.id, healthy.id);

  await db.clientIssue.createMany({
    data: [
      { institutionId: troubled.id, title: `${TAG} p${pass} issue A`, category: "SERVICE_DELIVERY", severity: "HIGH", status: "OPEN", ownerId: admin.user.id, createdById: admin.user.id },
      { institutionId: troubled.id, title: `${TAG} p${pass} issue B`, category: "FINANCE", severity: "LOW", status: "IN_PROGRESS", ownerId: admin.user.id, createdById: admin.user.id },
      // Resolved must NOT count — it needs no attention.
      { institutionId: troubled.id, title: `${TAG} p${pass} issue C`, category: "OTHER", severity: "LOW", status: "RESOLVED", ownerId: admin.user.id, createdById: admin.user.id },
    ],
  });

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e.message)));

  await signIn(page, admin.email, admin.password, row.twoFactorSecret);
  expect(!/login|verify-2fa/.test(new URL(page.url()).pathname),
    "signed in through the real form", page.url());

  await page.goto(`${BASE}/institutions`, { waitUntil: "networkidle" });
  await page.waitForSelector(`text=${TAG}-p${pass}-Troubled`, { timeout: 20000 });
  ok("client list loaded with both fixtures visible");

  // Scope to each card so the assertions cannot be satisfied by another client.
  const troubledCard = page.locator("div").filter({ hasText: `${TAG}-p${pass}-Troubled` }).last();
  const healthyCard = page.locator("div").filter({ hasText: `${TAG}-p${pass}-Healthy` }).last();

  const issuesText = await page.getByTestId("open-issues-pill").allInnerTexts();
  expect(issuesText.some((t) => /2 open issues/.test(t)),
    "*** the card shows 2 open issues — resolved is excluded ***",
    JSON.stringify(issuesText));

  // The rating moved out of the attention block and up beside the status badge,
  // and it now reads in the client list's vocabulary rather than the CRM's:
  // RED is "Alarmed", not "At risk". It also renders for GREEN now, so a card
  // says "Happy" instead of saying nothing — see lib/account-health.ts.
  const healthText = await page.getByTestId("health-sentiment").allInnerTexts();
  expect(healthText.some((t) => /Alarmed/.test(t)),
    "*** an at-risk client says so on the list ***", JSON.stringify(healthText));
  expect(healthText.some((t) => /Happy/.test(t)),
    "*** and a healthy client is labelled rather than left blank ***", JSON.stringify(healthText));

  const renewalText = await page.getByTestId("renewal-pill").allInnerTexts();
  expect(renewalText.some((t) => /Renews in \d+d/.test(t)),
    "*** an imminent renewal is flagged on the list ***", JSON.stringify(renewalText));

  // The healthy client must stay quiet — otherwise the signal is noise.
  const attentionBlocks = await page.getByTestId("client-attention").count();
  expect(attentionBlocks >= 1, "at least one attention block rendered", `${attentionBlocks}`);
  const healthyHasPill = await healthyCard.getByTestId("open-issues-pill").count();
  expect(healthyHasPill === 0,
    "*** a healthy client shows no attention pills ***", `${healthyHasPill}`);

  void troubledCard;

  const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  expect(real.length === 0, "no console errors", real.slice(0, 2).join(" | "));

  await ctx.close();

  // ── Destroy this pass's account and prove it went ───────────────────────
  await db.clientIssue.deleteMany({ where: { institutionId: { in: [troubled.id, healthy.id] } } }).catch(() => {});
  await db.auditLog.deleteMany({ where: { entityId: { in: [troubled.id, healthy.id] } } }).catch(() => {});
  await db.institution.deleteMany({ where: { id: { in: [troubled.id, healthy.id] } } }).catch(() => {});
  await destroyUser(admin);

  const left = await db.user.count({ where: { id: admin.user.id } });
  expect(left === 0, `pass ${pass}: the disposable account was deleted`, `${left} remaining`);
  if (left === 0) {
    const i = allCreated.indexOf(admin);
    if (i >= 0) allCreated.splice(i, 1);
  }
}

async function main() {
  startSection("Baseline");
  const beforeUsers = await db.user.count();
  ok(`users=${beforeUsers}`);

  const browser = await chromium.launch();
  try {
    for (let p = 1; p <= PASSES; p++) await runPass(p, browser);
  } finally {
    await browser.close();
  }

  startSection("Footprint after three real sign-ins");
  const afterUsers = await db.user.count();
  expect(afterUsers === beforeUsers,
    "*** user count back to baseline — no account survived ***",
    `${beforeUsers} -> ${afterUsers}`);
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.code ?? "", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", `${e.code ?? ""} ${e.message}`);
} finally {
  await db.clientIssue.deleteMany({ where: { institutionId: { in: made.institutions } } }).catch(() => {});
  await db.auditLog.deleteMany({ where: { entityId: { in: made.institutions } } }).catch(() => {});
  await db.institution.deleteMany({ where: { id: { in: made.institutions } } }).catch(() => {});
  for (const c of allCreated) await destroyUser(c);
  const leakedUsers = await db.user.count({ where: { email: { contains: TAG.toLowerCase() } } }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leakedUsers}\n`);
  await db.$disconnect();
}
summary();
