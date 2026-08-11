#!/usr/bin/env node
/**
 * Renders the app in dark mode and captures screenshots, so the theme can be
 * reviewed rather than inferred from a static scan.
 *
 * The scanner proves every colour *has* a dark counterpart. It cannot tell you
 * whether the counterpart looks right — contrast, muddiness, a brand colour
 * that disappears into the card behind it. That needs eyes on a render.
 *
 * Drives a real browser through the real login (credentials + TOTP + the
 * session update that clears the 2FA gate), flips the theme by setting the
 * stored preference, then walks the page list.
 */

import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { generateSecret, generate as totpGenerate } from "otplib";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "shots");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

/** Pages worth looking at: the chart-heavy ones and the shared primitives. */
const PAGES = [
  ["dashboard", "/dashboard"],
  ["analytics", "/analytics"],
  ["students", "/students"],
  ["institutions", "/institutions"],
  ["hr", "/hr"],
  ["reports", "/reports"],
  ["settings-security", "/settings?tab=security"],
  ["tasks", "/tasks"],
  ["recruitment-network", "/recruitment-network/partners"],
  ["risk-compliance", "/risk-compliance"],
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const email = `shot-${Date.now()}@illume.local`;
  const password = crypto.randomBytes(24).toString("base64url");
  const secret = generateSecret();
  const user = await db.user.create({
    data: {
      email, firstName: "Shot", lastName: "Bot", name: "Shot Bot",
      password: await bcrypt.hash(password, 12),
      role: "SUPER_ADMIN", isActive: true,
      twoFactorEnabled: true, twoFactorSecret: secret,
      passwordChangedAt: new Date(),
    },
  });
  const employee = await db.employee.create({
    data: {
      userId: user.id, employeeId: `SHOT-${Date.now().toString().slice(-6)}`,
      jobTitle: "QA", employmentType: "FULL_TIME", startDate: new Date(),
    },
  }).catch(() => null);
  console.log(`[setup] ${email}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    // The toggle persists to localStorage and an inline script reads it before
    // hydration, so seeding it here means the first paint is already dark.
    colorScheme: "dark",
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("illume-theme", "dark"); } catch {}
  });
  const page = await ctx.newPage();

  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  try {
    // ── Sign in ──────────────────────────────────────────────────────
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]');

    // MFA is mandatory, so the app lands on /verify-2fa.
    await page.waitForURL("**/verify-2fa**", { timeout: 20000 }).catch(() => {});
    const code = await totpGenerate({ secret });
    // The code input is either one field or six single-character boxes.
    const boxes = await page.locator('input[inputmode="numeric"], input[maxlength="1"]').count();
    if (boxes >= 6) {
      for (let i = 0; i < 6; i++) {
        await page.locator('input[inputmode="numeric"], input[maxlength="1"]').nth(i).fill(code[i]);
      }
    } else {
      await page.fill('input[inputmode="numeric"], input[name="code"], input[type="text"]', code);
    }
    await page.click('button[type="submit"]').catch(() => {});
    await page.waitForURL("**/dashboard**", { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(3000); // let the unlock overlay finish
    console.log(`[login] at ${page.url()}`);

    // Make sure the dark class actually landed before shooting anything.
    const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    console.log(`[theme] documentElement.dark = ${isDark}`);
    if (!isDark) {
      await page.evaluate(() => {
        localStorage.setItem("illume-theme", "dark");
        document.documentElement.classList.add("dark");
      });
      await page.waitForTimeout(500);
    }

    // ── Walk the pages ───────────────────────────────────────────────
    for (const [name, url] of PAGES) {
      try {
        await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        // Charts animate in; give recharts a beat to paint.
        await page.waitForTimeout(2500);
        const file = path.join(OUT, `dark-${name}.png`);
        await page.screenshot({ path: file, fullPage: false });
        console.log(`[shot] ${name.padEnd(22)} ${page.url()}`);
      } catch (err) {
        console.log(`[shot] ${name.padEnd(22)} FAILED: ${err.message.slice(0, 80)}`);
      }
    }

    if (errors.length) {
      console.log(`\n[console errors] ${errors.length}`);
      for (const e of [...new Set(errors)].slice(0, 10)) console.log(`  · ${e.slice(0, 160)}`);
    }
  } finally {
    await browser.close().catch(() => {});
    // Teardown mirrors qa-lib.destroyUser — side-effect rows first, then the user.
    await db.activity.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await db.auditLog.deleteMany({ where: { userId: user.id } }).catch(() => {});
    if (employee) await db.employee.delete({ where: { id: employee.id } }).catch(() => {});
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log(`[cleanup] ${email} removed`);
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); })
  .finally(() => db.$disconnect());
