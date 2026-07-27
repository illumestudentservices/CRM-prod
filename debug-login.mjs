import { chromium } from "playwright";
import { join } from "path";

const BASE = "https://illumestudentservices.cloud";
const OUT = join(import.meta.dirname, "audit-shots");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("console", (m) => console.log(`  [console.${m.type()}]`, m.text().slice(0, 250)));
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 250)));
page.on("requestfailed", (r) => console.log("  [reqfail]", r.url().slice(0, 120), r.failure()?.errorText));
page.on("response", async (r) => {
  if (r.url().includes("/api/auth")) {
    console.log(`  [auth] ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  }
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });

// Inspect form structure
const inputs = await page.evaluate(() =>
  Array.from(document.querySelectorAll("input")).map((i) => ({
    type: i.type, name: i.name, id: i.id, placeholder: i.placeholder, required: i.required,
  }))
);
console.log("INPUTS:", JSON.stringify(inputs, null, 2));

const buttons = await page.evaluate(() =>
  Array.from(document.querySelectorAll("button")).map((b) => ({ type: b.type, text: b.innerText.trim().slice(0, 40) }))
);
console.log("BUTTONS:", JSON.stringify(buttons, null, 2));

console.log("\n--- Filling form ---");
await page.fill('input[type="email"]', "admin@illumestudentservices.cloud");
await page.fill('input[type="password"]', "Ilm-Fw35HO0aXRBk");
await page.screenshot({ path: join(OUT, "dbg-1-filled.png") });

console.log("--- Submitting ---");
await page.click('button[type="submit"]');

for (let i = 1; i <= 8; i++) {
  await page.waitForTimeout(2000);
  console.log(`  t+${i * 2}s  url=${page.url()}`);
  if (!page.url().includes("/login")) break;
}

await page.screenshot({ path: join(OUT, "dbg-2-after.png"), fullPage: true });

const errText = await page.evaluate(() => {
  const t = document.body.innerText;
  const m = t.match(/(invalid|incorrect|failed|error|wrong|locked|disabled)[^\n]{0,120}/gi);
  return m ? m.slice(0, 5) : null;
});
console.log("\nError text on page:", errText);
console.log("Final URL:", page.url());

await browser.close();
