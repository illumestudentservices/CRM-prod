import { chromium } from "playwright";
import { createHmac } from "crypto";
import { readFileSync } from "fs";
export const BASE = "https://illumestudentservices.cloud";
export function loadEnv() {
  const out = {};
  for (const line of readFileSync(".env.test.local", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
export function totp(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const v = A.indexOf(c); if (v === -1) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeUInt32BE(Math.floor(Date.now() / 1000 / 30), 4);
  const h = createHmac("sha1", key).update(ctr).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o+1] << 16) | (h[o+2] << 8) | h[o+3];
  return String(n % 1e6).padStart(6, "0");
}
export async function signIn({ headless = true } = {}) {
  const env = loadEnv();
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', env.TEST_EMAIL);
  await page.fill('input[type="password"]', env.TEST_PASSWORD);
  await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 30000 });
  await page.click('button[type="submit"]');
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(300); if (/verify-2fa|dashboard/.test(page.url())) break; }
  if (page.url().includes("/verify-2fa")) {
    await page.fill("input", totp(env.TEST_TOTP_SECRET));
    await page.click('button[type="submit"]');
    for (let i = 0; i < 60; i++) { await page.waitForTimeout(300); if (page.url().includes("/dashboard")) break; }
  }
  if (!page.url().includes("/dashboard")) throw new Error(`stuck at ${page.url()}`);
  return { browser, page, BASE, env };
}
