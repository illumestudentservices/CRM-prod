/**
 * Pure, framework-free formatting for the shared Export button
 * (components/shared/export-button.tsx). Kept out of the client component so
 * the security-sensitive string building — CSV formula neutralisation and, in
 * particular, HTML escaping for the "Export as PDF" window — can be unit
 * tested without rendering React. See scripts/qa-export-pdf-xss.ts.
 */

export interface ExportColumn {
  key: string;
  header: string;
}

/**
 * Excel and Sheets execute a cell whose text begins with one of these, even
 * when the CSV field is quoted — quoting protects the DELIMITER, not the
 * formula parser.
 *
 * ★ THE EVERYDAY CASE IS NOT AN ATTACK, IT IS A PHONE NUMBER. `+1-555-0100`
 * begins with `+`, so Excel evaluates it and the cell shows a broken formula
 * or a negative number. Emergency contacts and international dialling codes
 * hit this constantly. `=cmd|…` is the security case, and one fix covers both.
 *
 * A leading apostrophe is Excel's "this is text" marker and is not displayed,
 * so the value reads back as stored. Sheets shows it literally on some import
 * paths — that is the accepted trade for not executing the cell.
 */
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

export function csvCell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  let s = String(val);
  if (FORMULA_TRIGGERS.test(s)) s = `'${s}`;
  // RFC 4180: quote every field, double any quote inside it.
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCSV(data: Record<string, unknown>[], columns: ExportColumn[]): string {
  const header = columns.map((c) => csvCell(c.header)).join(",");
  const rows = data.map((row) =>
    columns.map((c) => csvCell(row[c.key])).join(",")
  );
  return [header, ...rows].join("\r\n");
}

/**
 * Escape text for interpolation into HTML.
 *
 * The "Export as PDF" feature builds a document from exported rows and opens it
 * with document.write(). Those rows are real records — a student's name, a
 * note, a program title — any of which a user can set. Interpolated raw, a
 * value like `<img src=x onerror=…>` or `</title><script>…</script>` runs as
 * script in the export window: stored XSS. Every dynamic value (cell, title,
 * column header) goes through this first. Covers the five HTML-significant
 * characters, including both quote styles for safety inside attributes.
 */
export function escapeHtml(val: unknown): string {
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the self-contained HTML document for the PDF export window. Pure: it
 * takes data and returns a string, with every dynamic value escaped. The
 * caller writes the result into a new window that prints itself.
 */
export function buildExportPdfHtml(
  data: Record<string, unknown>[],
  columns: ExportColumn[],
  title: string
): string {
  const safeTitle = escapeHtml(title);

  const rows = data
    .map(
      (row) =>
        `<tr>${columns
          .map((c) => {
            const val = row[c.key];
            return `<td>${val === null || val === undefined ? "—" : escapeHtml(val)}</td>`;
          })
          .join("")}</tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 24px; }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; border-bottom: 2px solid #1E3A5F; padding-bottom: 12px; }
    .header h1 { font-size: 18px; font-weight: bold; color: #1E3A5F; }
    .header .meta { font-size: 10px; color: #666; text-align: right; }
    .brand { font-size: 11px; color: #0EA5E9; font-weight: 600; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    thead tr { background: #1E3A5F; color: white; }
    thead th { padding: 8px 10px; text-align: left; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
    tbody tr { border-bottom: 1px solid #e5e7eb; }
    /* dark-ok — print stylesheet; the paper is always white. */
    tbody tr:nth-child(even) { background: #f8fafc; }
    tbody td { padding: 7px 10px; vertical-align: top; word-break: break-word; }
    .footer { margin-top: 20px; font-size: 9px; color: #999; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 10px; }
    @media print {
      body { padding: 12px; }
      @page { margin: 1cm; size: A4 landscape; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">ILLUME STUDENT ADVISORY SERVICES</div>
      <h1>${safeTitle}</h1>
    </div>
    <div class="meta">
      <div>Exported: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>
      <div>${data.length} record${data.length !== 1 ? "s" : ""}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>${columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("")}</tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    &copy; ${new Date().getFullYear()} Illume Student Advisory Services &mdash; Confidential
  </div>
  <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`;
}
