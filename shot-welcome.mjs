import { chromium } from "playwright";
import { join } from "path";
const BASE = "https://illumestudentservices.cloud";
const OUT = join(import.meta.dirname, "audit-shots");
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on("pageerror", e => console.log("[pageerror]", String(e).slice(0,160)));
await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
await p.fill('input[type="email"]', "admin@illumestudentservices.cloud");
await p.fill('input[type="password"]', "Ilm-Fw35HO0aXRBk");
await p.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 30000 });
const t0 = Date.now();
await p.click('button[type="submit"]');
// catch the overlay while it's up
let shot = false;
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(150);
  const up = await p.evaluate(() => {
    const el = document.querySelector('div[title="Click to continue"]');
    return el ? getComputedStyle(el).opacity : null;
  });
  if (up && parseFloat(up) > 0.85 && !shot) {
    await p.screenshot({ path: join(OUT, "welcome-overlay.png") });
    shot = true;
    console.log("captured overlay at opacity", up);
    break;
  }
}
if (!shot) console.log("overlay not captured");
for (let i=0;i<25;i++){ await p.waitForTimeout(500); if(!p.url().includes("/login")) break; }
console.log("total login->landed:", ((Date.now()-t0)/1000).toFixed(1)+"s", "->", p.url());
await b.close();
