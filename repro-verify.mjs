import { chromium } from "playwright";
import { createHmac } from "crypto";

const BASE = "https://illumestudentservices.cloud";
const EMAIL = "admin@illumestudentservices.cloud";
const PASSWORD = "Ilm-Fw35HO0aXRBk";

function b32d(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let b = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const i = A.indexOf(c); if (i < 0) continue;
    b += i.toString(2).padStart(5, "0");
  }
  const o = Buffer.alloc(Math.floor(b.length / 8));
  for (let i = 0; i < o.length; i++) o[i] = parseInt(b.slice(i * 8, i * 8 + 8), 2);
  return o;
}
function totp(sec) {
  const k = b32d(sec);
  const c = Buffer.alloc(8);
  c.writeUInt32BE(Math.floor(Date.now() / 1000 / 30), 4);
  const h = createHmac("sha1", k).update(c).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}

const login = async (p) => {
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await p.fill('input[type="email"]', EMAIL);
  await p.fill('input[type="password"]', PASSWORD);
  await p.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 30000 });
  await p.click('button[type="submit"]');
  for (let i = 0; i < 25; i++) { await p.waitForTimeout(1000); if (!p.url().includes("/login")) break; }
};

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext();
const p = await ctx.newPage();

// Log every 2FA API exchange
p.on("response", async (r) => {
  if (r.url().includes("/api/auth/2fa/") || r.url().includes("/api/auth/session")) {
    let body = "";
    try { body = (await r.text()).slice(0, 220); } catch {}
    console.log(`   [${r.status()}] ${r.request().method()} ${new URL(r.url()).pathname}  ${body}`);
  }
});

console.log("=== PASS 1: enrol ===");
await login(p);
console.log("   landed:", p.url());
let secret = null;
if (p.url().includes("/setup-2fa")) {
  await p.click('button:has-text("Begin setup")');
  await p.waitForTimeout(3000);
  secret = await p.evaluate(() => document.querySelector("code")?.textContent.trim());
  await p.fill('input[inputmode="numeric"]', totp(secret));
  await p.click('button:has-text("Verify")');
  await p.waitForTimeout(4000);
  await p.click('button:has-text("Continue to dashboard")');
  await p.waitForTimeout(5000);
  console.log("   after enrol:", p.url(), "| secret:", secret);
} else {
  console.log("   already enrolled — cannot capture secret, aborting");
  await b.close(); process.exit(0);
}

console.log("\n=== PASS 2: fresh login, then verify TOTP ===");
await ctx.clearCookies();
await login(p);
console.log("   landed:", p.url());

if (!p.url().includes("/verify-2fa")) {
  console.log("   !! expected /verify-2fa");
} else {
  // Inspect what the client session says before submitting
  const sess = await p.evaluate(async () => {
    const r = await fetch("/api/auth/session");
    return await r.json();
  });
  console.log("   session.user.twoFactorPending =", sess?.user?.twoFactorPending);
  console.log("   session.user.twoFactorEnabled =", sess?.user?.twoFactorEnabled);

  await p.waitForTimeout(1500);
  const code = totp(secret);
  console.log("   submitting code:", code);
  await p.fill('input', code);
  await p.click('button[type="submit"]');
  await p.waitForTimeout(5000);

  const err = await p.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/(No pending[^\n]*|Invalid code[^\n]*|Unable to verify[^\n]*|2FA not configured[^\n]*)/i);
    return m ? m[0] : null;
  });
  console.log("   error shown:", err ?? "none");
  console.log("   final url:", p.url());
  console.log("   RESULT:", p.url().includes("/dashboard") ? "LOGGED IN" : "STUCK");
}

await b.close();
