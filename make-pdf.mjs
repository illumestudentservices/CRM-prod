/**
 * Renders the offline capture SOP to a PDF for circulation to ICRs.
 *
 * Built from docs/offline-capture-sop.md and deliberately NOT from
 * offline-lead-capture.md. The latter carries file paths, API behaviour and
 * known gaps — useful to whoever maintains this, meaningless to someone standing
 * at a booth, and not something to hand outside the team.
 *
 * Markdown is converted by `marked` (fetched with npx, so nothing is added to
 * package.json) and printed through Chromium, which is already present for
 * Playwright. The intermediate HTML is written into docs/ deliberately: the
 * image paths in the markdown are relative, and Chromium resolves them against
 * the file it loaded.
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MD = "docs/offline-capture-sop.md";
const HTML = "docs/.tmp-offline-capture-sop.html";
const PDF = "docs/Collecting Leads at Events - SOP.pdf";

// Run through a shell: Node on Windows refuses to spawn a .cmd shim directly.
const body = execSync(`npx --yes marked -i ${MD}`, {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

const css = `
  @page { size: A4; margin: 18mm 16mm 20mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 10.5pt; line-height: 1.55; color: #1e293b; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 21pt; color: #1E3A5F; margin: 0 0 4pt; letter-spacing: -0.3pt; }
  h1 + p { color: #64748b; font-size: 11pt; margin-top: 0; }
  h2 {
    font-size: 14pt; color: #1E3A5F; margin: 22pt 0 8pt;
    padding-bottom: 4pt; border-bottom: 1.5px solid #e2e8f0;
    break-after: avoid; page-break-after: avoid;
  }
  h3 { font-size: 11.5pt; color: #334155; margin: 16pt 0 6pt; break-after: avoid; page-break-after: avoid; }
  p { margin: 7pt 0; }
  a { color: #0369a1; text-decoration: none; }
  code {
    font-family: "Cascadia Mono", Consolas, "SF Mono", monospace; font-size: 9pt;
    background: #f1f5f9; padding: 1.5pt 4pt; border-radius: 3px; color: #0f172a;
  }
  pre {
    background: #0f172a; color: #e2e8f0; padding: 10pt 12pt; border-radius: 6px;
    overflow-x: auto; font-size: 8.5pt; line-height: 1.5;
    break-inside: avoid; page-break-inside: avoid;
  }
  pre code { background: none; color: inherit; padding: 0; }
  table {
    width: 100%; border-collapse: collapse; margin: 10pt 0; font-size: 9.5pt;
    break-inside: avoid; page-break-inside: avoid;
  }
  th {
    background: #1E3A5F; color: #fff; text-align: left;
    padding: 6pt 8pt; font-weight: 600; font-size: 9pt;
  }
  td { padding: 5.5pt 8pt; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  blockquote {
    margin: 10pt 0; padding: 8pt 12pt; background: #fffbeb;
    border-left: 3px solid #f59e0b; color: #78350f;
    break-inside: avoid; page-break-inside: avoid;
  }
  blockquote p { margin: 4pt 0; }
  blockquote pre { background: #1c1917; }
  /* Screenshots: bordered so the page edges are visible against white paper,
     and never split across a page break. */
  img {
    max-width: 100%; height: auto; display: block; margin: 10pt auto;
    border: 1px solid #cbd5e1; border-radius: 5px;
    break-inside: avoid; page-break-inside: avoid;
  }
  ul, ol { margin: 7pt 0; padding-left: 20pt; }
  li { margin: 3pt 0; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 20pt 0; }
  strong { color: #0f172a; }
`;

fs.writeFileSync(
  HTML,
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`
);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file:///" + path.resolve(HTML).replace(/\\/g, "/"), {
  waitUntil: "networkidle",
});
await page.pdf({
  path: PDF,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div style="font-size:7pt;color:#94a3b8;width:100%;padding:0 16mm;">
     Illume Student Advisory Services — Collecting Leads at Events</div>`,
  footerTemplate: `<div style="font-size:7pt;color:#94a3b8;width:100%;padding:0 16mm;text-align:right;">
     Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
  margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
});
await browser.close();
fs.unlinkSync(HTML);

const kb = Math.round(fs.statSync(PDF).size / 1024);
console.log(`written: ${PDF} (${kb} KB)`);
