import { chromium } from "playwright";
import { createHmac } from "crypto";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = "https://illumestudentservices.cloud";
const EMAIL = "admin@illumestudentservices.cloud";
const PASSWORD = "Ilm-Fw35HO0aXRBk";
const OUT = join(import.meta.dirname, "audit-shots");
mkdirSync(OUT, { recursive: true });

function b32d(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let b = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) { const i = A.indexOf(c); if (i < 0) continue; b += i.toString(2).padStart(5, "0"); }
  const o = Buffer.alloc(Math.floor(b.length / 8));
  for (let i = 0; i < o.length; i++) o[i] = parseInt(b.slice(i * 8, i * 8 + 8), 2);
  return o;
}
function totp(sec) {
  const k = b32d(sec); const c = Buffer.alloc(8);
  c.writeUInt32BE(Math.floor(Date.now() / 1000 / 30), 4);
  const h = createHmac("sha1", k).update(c).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 180)));
p.on("console", (m) => { if (m.type() === "error" && !/favicon|DevTools/.test(m.text())) errs.push("console: " + m.text().slice(0, 180)); });
p.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("favicon")) errs.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });

// --- sign in (handles the mandatory-MFA gate) ---
await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
await p.fill('input[type="email"]', EMAIL);
await p.fill('input[type="password"]', PASSWORD);
await p.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 30000 });
await p.click('button[type="submit"]');
for (let i = 0; i < 40; i++) { await p.waitForTimeout(300); if (!p.url().includes("/login")) break; }

if (p.url().includes("/setup-2fa")) {
  await p.click('button:has-text("Begin setup")'); await p.waitForTimeout(3000);
  const secret = await p.evaluate(() => document.querySelector("code")?.textContent.trim());
  await p.fill('input[inputmode="numeric"]', totp(secret));
  await p.click('button:has-text("Verify")'); await p.waitForTimeout(3500);
  await p.click('button:has-text("Continue to dashboard")');
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(300); if (p.url().includes("/dashboard")) break; }
  console.log("(enrolled test 2FA, secret " + secret + ")");
}
console.log("signed in ->", p.url());

// --- knowledge base ---
await p.goto(`${BASE}/knowledge`, { waitUntil: "domcontentloaded", timeout: 45000 });
await p.waitForTimeout(4000);
await p.screenshot({ path: join(OUT, "kb-01-default.png"), fullPage: true });

const tabs = await p.evaluate(() =>
  Array.from(document.querySelectorAll("button")).map((x) => x.innerText.trim()).filter((t) => t && t.length < 40)
);
console.log("\nbuttons/tabs present:", JSON.stringify([...new Set(tabs)].slice(0, 20)));

const bodyLen = await p.evaluate(() => document.body.innerText.trim().length);
console.log("page text length:", bodyLen);

// Walk each tab
for (const label of ["General", "Institution", "Market", "Proposal"]) {
  const el = p.locator(`button:has-text("${label}")`).first();
  if (await el.count()) {
    await el.click();
    await p.waitForTimeout(2200);
    const txt = await p.evaluate(() => document.body.innerText);
    const empty = /no .*(found|yet|articles)|nothing here/i.test(txt);
    console.log(`  tab "${label}": ${empty ? "EMPTY STATE" : "has content"}`);
    await p.screenshot({ path: join(OUT, `kb-02-${label.toLowerCase()}.png`), fullPage: true });
  } else {
    console.log(`  tab "${label}": not found`);
  }
}

console.log("\nerrors:", errs.length ? [...new Set(errs)] : "none");
await b.close();
