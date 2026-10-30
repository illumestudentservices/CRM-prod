/**
 * Stored XSS in "Export as PDF" (HIGH pentest #7).
 *
 * The PDF export builds an HTML document from exported rows and opens it with
 * document.write() in a new window. Record values are user-controlled (a
 * student's name, a note, a program), so before the fix a value like
 * `<img src=x onerror=…>` or `</title><script>…</script>` ran as script in the
 * export window. buildExportPdfHtml() now HTML-escapes every dynamic value
 * (cell, title, column header). This asserts the payloads come out inert while
 * ordinary text is preserved, and that the CSV path is still formula-safe.
 *
 *   npx tsx scripts/qa-export-pdf-xss.ts
 */
import { buildExportPdfHtml, csvCell, escapeHtml, type ExportColumn } from "@/lib/export-format";

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string, extra = "") => {
  if (cond) { pass++; console.log(`  ✓  ${msg}`); }
  else { fail++; console.log(`  ✗  ${msg}${extra ? ` → ${extra}` : ""}`); }
};

const IMG = `<img src=x onerror=alert(document.cookie)>`;
const SCRIPT = `<script>alert(1)</script>`;
const TITLE_BREAK = `Students</title><script>alert(2)</script>`;
const HDR = `<b>Name</b>`;
const ATTR = `" onmouseover="alert(3)`;

const columns: ExportColumn[] = [
  { key: "name", header: "Name" },
  { key: "note", header: HDR },
];

const data: Record<string, unknown>[] = [
  { name: IMG, note: SCRIPT },
  { name: `José Ramírez`, note: `A & B < C` },
  { name: ATTR, note: null },
];

function run(runNo: number) {
  console.log(`\n── Export-PDF XSS (run ${runNo}) ──`);
  const html = buildExportPdfHtml(data, columns, TITLE_BREAK);

  // 1) Payloads are neutralised — none of the raw dangerous markup survives.
  ok(!html.includes(IMG), "raw <img onerror> payload is NOT in the document");
  ok(html.includes("&lt;img src=x onerror=alert(document.cookie)&gt;"), "the <img> payload is HTML-escaped");
  ok(!html.includes("<script>alert(1)"), "raw <script>alert(1) is NOT in the document");
  ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "the <script> cell payload is escaped");

  // 2) Title cannot break out of <title> or inject a script.
  ok(!html.includes("<script>alert(2)"), "title payload cannot inject a live <script>");
  ok(html.includes("&lt;/title&gt;&lt;script&gt;alert(2)"), "title </title><script> break-out is escaped");

  // 3) Column headers are escaped too.
  ok(!html.includes("<b>Name</b>"), "raw <b> in a column header is NOT present");
  ok(html.includes("&lt;b&gt;Name&lt;/b&gt;"), "column header markup is escaped");

  // 4) Attribute-style quote payload is escaped.
  ok(html.includes("&quot; onmouseover=&quot;alert(3)"), "quote/attribute payload is escaped");

  // 5) Ordinary data is preserved and readable.
  ok(html.includes("José Ramírez"), "a normal non-ASCII name is preserved");
  ok(html.includes("A &amp; B &lt; C"), "ampersand and < in ordinary text are escaped, not dropped");
  ok(html.includes("<td>—</td>"), "null cell renders as an em dash");

  // 6) The document structure (self-print) is intact.
  ok(html.includes("window.print"), "the print bootstrap script is still present");
  ok(html.includes("<td>") && html.includes("</table>"), "the table structure is intact");

  // 7) escapeHtml direct checks.
  ok(escapeHtml(`<>&"'`) === "&lt;&gt;&amp;&quot;&#39;", "escapeHtml covers all five characters");

  // 8) CSV path is still formula-safe (regression guard).
  ok(csvCell("=cmd|' /c calc'!A1") === `"'=cmd|' /c calc'!A1"`, "csvCell neutralises a leading = formula");
  ok(csvCell("+15550100") === `"'+15550100"`, "csvCell neutralises a leading + (phone number)");
  ok(csvCell(`a"b`) === `"a""b"`, "csvCell doubles embedded quotes (RFC 4180)");
  ok(csvCell("plain") === `"plain"`, "csvCell leaves ordinary text alone");
}

for (let i = 1; i <= 3; i++) run(i);

console.log(`\n${"=".repeat(50)}\n  TOTAL: ${pass} pass / ${fail} fail\n${"=".repeat(50)}`);
process.exit(fail ? 1 : 0);
