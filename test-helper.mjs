/**
 * Shared sign-in helper for pipeline E2E scripts.
 *
 * Uses the disposable test account in .env.test.local (gitignored). MFA is
 * mandatory app-wide, so every script has to complete the TOTP challenge —
 * doing it here keeps that out of each test.
 */
import { chromium } from "playwright";
import { createHmac } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

const BASE = "https://illumestudentservices.cloud";

function loadEnv() {
  const raw = readFileSync(join(import.meta.dirname, ".env.test.local"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function b32decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const i = A.indexOf(c);
    if (i < 0) continue;
    bits += i.toString(2).padStart(5, "0");
  }
  const out = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export function totp(secret) {
  const key = b32decode(secret);
  const ctr = Buffer.alloc(8);
  ctr.writeUInt32BE(Math.floor(Date.now() / 1000 / 30), 4);
  const h = createHmac("sha1", key).update(ctr).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}

/** Launches a browser, signs in through password + TOTP, returns { browser, page }. */
export async function signIn({ headless = true, viewport = { width: 1440, height: 950 } } = {}) {
  const env = loadEnv();
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', env.TEST_EMAIL);
  await page.fill('input[type="password"]', env.TEST_PASSWORD);
  await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 30000 });
  await page.click('button[type="submit"]');
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(300);
    if (!page.url().includes("/login")) break;
  }

  if (page.url().includes("/verify-2fa")) {
    await page.waitForTimeout(1200);
    await page.fill("input", totp(env.TEST_TOTP_SECRET));
    await page.click('button[type="submit"]');
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(300);
      if (page.url().includes("/dashboard")) break;
    }
  }

  if (!page.url().includes("/dashboard")) {
    throw new Error(`sign-in did not reach dashboard, stuck at ${page.url()}`);
  }
  return { browser, page, BASE };
}

export { BASE };
