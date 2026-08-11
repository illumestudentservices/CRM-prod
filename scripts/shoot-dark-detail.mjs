#!/usr/bin/env node
/**
 * Second dark-mode pass, aimed at the things the page-level sweep can't reach:
 *
 *   • the Security tab (a click, not a query param)
 *   • the granular permissions panel added in Phase 10
 *   • an open dialog, which is where the shadcn primitives I re-paired live —
 *     Switch, Checkbox, Select, Table, Tabs, Dropdown
 *   • a report detail page, the most chart-dense screen in the app
 *
 * Those primitives are shared, so a mistake in them shows up everywhere; they
 * are worth looking at directly rather than inferring from a scanner.
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

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const email = `shot2-${Date.now()}@illume.local`;
  const password = crypto.randomBytes(24).toString("base64url");
  const secret = generateSecret();
  const user = await db.user.create({
    data: {
      email, firstName: "Shot", lastName: "Detail", name: "Shot Detail",
      password: await bcrypt.hash(password, 12),
      role: "SUPER_ADMIN", isActive: true,
      twoFactorEnabled: true, twoFactorSecret: secret,
      passwordChangedAt: new Date(),
    },
  });
  const employee = await db.employee.create({
    data: {
      userId: user.id, employeeId: `SHOT2-${Date.now().toString().slice(-6)}`,
      jobTitle: "QA", employmentType: "FULL_TIME", startDate: new Date(),
    },
  }).catch(() => null);

  const report = await db.monthlyReport.findFirst({ select: { id: true } });
  const inst = await db.institution.findFirst({ where: { deletedAt: null }, select: { id: true } });

  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    colorScheme: "dark",
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("illume-theme", "dark"); } catch {}
  });
  const page = await ctx.newPage();

  const shoot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `dark-${name}.png`) });
    console.log(`[shot] ${name}`);
  };

  try {
    // ── Sign in ──
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/verify-2fa**", { timeout: 20000 }).catch(() => {});
    const code = await totpGenerate({ secret });
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
    await page.waitForTimeout(3000);
    console.log(`[login] ${page.url()}`);

    // ── Settings → Security (click, the tab isn't URL-driven) ──
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /^Security$/i }).click().catch(async () => {
      await page.locator('text="Security"').first().click().catch(() => {});
    });
    await page.waitForTimeout(2000);
    await shoot("security-tab");

    // The permission matrix and the new granular panel are further down.
    await page.evaluate(() => window.scrollBy(0, 900));
    await page.waitForTimeout(800);
    await shoot("security-matrix");

    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h3")]
        .find((n) => /Function .* field permissions/i.test(n.textContent ?? ""));
      h?.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(1200);
    await shoot("granular-permissions");

    // Its Fields sub-tab exercises Checkbox in a table.
    await page.getByRole("button", { name: /Fields \/ columns/i }).click().catch(() => {});
    await page.waitForTimeout(1200);
    await shoot("granular-fields");

    // ── A dialog: Switch, Select, Input, Label on a raised surface ──
    await page.goto(`${BASE}/recruitment-network/partners`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /Add Partner/i }).click().catch(() => {});
    await page.waitForTimeout(1200);
    await shoot("dialog-add-partner");
    await page.keyboard.press("Escape").catch(() => {});

    // ── A dropdown menu, opened ──
    await page.goto(`${BASE}/students`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await shoot("students-kanban");

    // ── Report detail: the densest chart page ──
    if (report) {
      await page.goto(`${BASE}/reports/${report.id}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      await shoot("report-detail");
      // Tooltips only paint on hover — this is the surface that used to render
      // as a white box because contentStyle set a border but no background.
      const chart = page.locator(".recharts-surface").first();
      if (await chart.count()) {
        const box = await chart.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
          await page.waitForTimeout(900);
          await shoot("chart-tooltip");
        }
      }
    }

    // ── Institution detail: enrollment chart + governance cards ──
    if (inst) {
      await page.goto(`${BASE}/institutions/${inst.id}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      await shoot("institution-detail");
    }
  } finally {
    await browser.close().catch(() => {});
    await db.activity.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await db.auditLog.deleteMany({ where: { userId: user.id } }).catch(() => {});
    if (employee) await db.employee.delete({ where: { id: employee.id } }).catch(() => {});
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log(`[cleanup] ${email} removed`);
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); })
  .finally(() => db.$disconnect());
