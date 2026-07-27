import { chromium } from "playwright";
import { join } from "path";
const OUT = join(import.meta.dirname, "audit-shots");
const b = await chromium.launch({ headless: true });
for (const [name, w, h] of [["desktop",1600,1000],["mobile",390,844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on("pageerror", e => console.log(`[${name} pageerror]`, String(e).slice(0,160)));
  await p.goto("https://illumestudentservices.cloud/login", { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(4500); // let arcs travel
  await p.screenshot({ path: join(OUT, `login-${name}.png`), fullPage: false });
  console.log(name, "captured");
  await p.close();
}
await b.close();
