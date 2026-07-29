import { chromium } from "playwright";
import { createHmac } from "crypto";
import { readFileSync } from "fs";

export const BASE = "https://illumestudentservices.cloud";

function loadEnv() {
  const out = {};
  for (const line of readFileSync(".env.test.local", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** RFC 6238 TOTP, so the harness can answer the mandatory MFA challenge. */
export function totp(secretB32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secretB32.replace(/=+$/, "").toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v === -1) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeUInt32BE(Math.floor(Date.now() / 1000 / 30), 4);
  const h = createHmac("sha1", key).update(ctr).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}

export async function signIn({ headless = true, viewport = { width: 1440, height: 950 } } = {}) {
  const env = loadEnv();
  if (!env.TEST_EMAIL) throw new Error("no credentials in .env.test.local");

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill('input[type="email"]', env.TEST_EMAIL);
  await page.fill('input[type="password"]', env.TEST_PASSWORD);
  await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 30000 });
  await page.click('button[type="submit"]');

  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(300);
    if (/verify-2fa|dashboard|change-password/.test(page.url())) break;
  }

  if (page.url().includes("/verify-2fa")) {
    await page.fill("input", totp(env.TEST_TOTP_SECRET));
    await page.click('button[type="submit"]');
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(300);
      if (page.url().includes("/dashboard")) break;
    }
  }

  if (page.url().includes("/setup-2fa")) throw new Error("MFA not enrolled on the test account");
  if (page.url().includes("/change-password")) throw new Error("stuck on forced password change");
  if (!page.url().includes("/dashboard")) {
    throw new Error(`sign-in did not reach dashboard, stuck at ${page.url()}`);
  }
  return { browser, page, BASE, env };
}
