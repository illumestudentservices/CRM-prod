import { chromium } from "playwright";
import { join } from "path";

const dir = join(import.meta.dirname, "screenshots", "guide");
const htmlPath = join(dir, "ILLUME-CRM-USER-GUIDE.html");
const pdfPath = join(dir, "ILLUME-CRM-USER-GUIDE.pdf");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("file:///" + htmlPath.replace(/\\/g, "/"), { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
});
console.log("PDF saved to:", pdfPath);
await browser.close();
