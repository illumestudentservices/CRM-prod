import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = "https://illumestudentservices.cloud";
const OUT = join(import.meta.dirname, "audit-shots");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));

await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
await page.fill('input[type="email"]', "admin@illumestudentservices.cloud");
await page.fill('input[type="password"]', "Ilm-Fw35HO0aXRBk");
await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 30000 });
await page.click('button[type="submit"]');
for (let i = 0; i < 20; i++) { await page.waitForTimeout(1000); if (!page.url().includes("/login")) break; }
console.log("Logged in ->", page.url());

// Go to the account page where 2FA lives
await page.goto(`${BASE}/account`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: join(OUT, "account-2fa.png"), fullPage: true });

const txt = await page.evaluate(() => document.body.innerText);
console.log("\n--- /account page content ---");
console.log(txt.slice(0, 900));

// Check the 2FA status API
const status = await page.request.get(`${BASE}/api/auth/2fa/status`);
console.log("\n2FA status API:", status.status(), await status.text());

// Try generating a secret (proves the TOTP pipeline works)
const gen = await page.request.post(`${BASE}/api/auth/2fa/generate`);
const genBody = await gen.text();
console.log("2FA generate API:", gen.status());
console.log("  has QR:", genBody.includes("data:image"), "| has secret:", /"secret"/.test(genBody));

await browser.close();
