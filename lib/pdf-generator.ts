import puppeteer from "puppeteer-core";

// Order matters: the first existing path wins. Google Chrome (a real .deb
// binary) is listed FIRST because on Ubuntu 24.04 the chromium packages are
// snaps, and snap confinement stops puppeteer launching them as a child
// process ("not a snap cgroup"). A snap chromium at /usr/bin/chromium-browser
// is a wrapper that fails, so it must not be preferred over a working Chrome.
// An explicit PUPPETEER_EXECUTABLE_PATH overrides everything.
const CHROMIUM_PATHS = [
  process.env.PUPPETEER_EXECUTABLE_PATH || "",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
].filter(Boolean);

function findChromium(): string {
  const fs = require("fs");
  for (const p of CHROMIUM_PATHS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return CHROMIUM_PATHS[0];
}

export async function generatePdfFromHtml(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    executablePath: findChromium(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
