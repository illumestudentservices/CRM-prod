"use client";

import * as React from "react";
import { Download, FileSpreadsheet, FileText, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ExportColumn {
  key: string;
  header: string;
}

export interface ExportSection {
  label: string;
  data: Record<string, unknown>[];
  columns: ExportColumn[];
  filename: string;
}

interface ExportButtonProps {
  /** Single-dataset mode (original) */
  data?: Record<string, unknown>[];
  columns?: ExportColumn[];
  filename?: string;
  title?: string;
  /** Multi-dataset mode: shows a "Select data" sub-menu */
  exports?: ExportSection[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toCSV(data: Record<string, unknown>[], columns: ExportColumn[]): string {
  const header = columns.map((c) => `"${c.header}"`).join(",");
  const rows = data.map((row) =>
    columns
      .map((c) => {
        const val = row[c.key];
        if (val === null || val === undefined) return '""';
        return `"${String(val).replace(/"/g, '""')}"`;
      })
      .join(",")
  );
  return [header, ...rows].join("\r\n");
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function printAsPDF(
  data: Record<string, unknown>[],
  columns: ExportColumn[],
  title: string
) {
  const rows = data
    .map(
      (row) =>
        `<tr>${columns
          .map((c) => {
            const val = row[c.key];
            return `<td>${val === null || val === undefined ? "—" : String(val)}</td>`;
          })
          .join("")}</tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
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
      <h1>${title}</h1>
    </div>
    <div class="meta">
      <div>Exported: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>
      <div>${data.length} record${data.length !== 1 ? "s" : ""}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>${columns.map((c) => `<th>${c.header}</th>`).join("")}</tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    &copy; ${new Date().getFullYear()} Illume Student Advisory Services &mdash; Confidential
  </div>
  <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to export PDF."); return; }
  win.document.write(html);
  win.document.close();
}

// ─── Single-dataset export button ─────────────────────────────────────────────

function SingleExport({
  data,
  columns,
  filename,
  title,
}: Required<Pick<ExportButtonProps, "data" | "columns" | "filename" | "title">>) {
  const [busy, setBusy] = React.useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy || data.length === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-slate-500">
          {data.length} record{data.length !== 1 ? "s" : ""}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 cursor-pointer"
          onClick={() => {
            setBusy(true);
            try { triggerDownload(toCSV(data, columns), `${filename}_${Date.now()}.csv`, "text/csv;charset=utf-8;"); }
            finally { setBusy(false); }
          }}
        >
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
          Export as Excel / CSV
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => printAsPDF(data, columns, title)}>
          <FileText className="h-4 w-4 text-red-500" />
          Export as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Multi-dataset export button ──────────────────────────────────────────────

function MultiExport({ exports, title }: { exports: ExportSection[]; title: string }) {
  const [busy, setBusy] = React.useState(false);
  const [step, setStep] = React.useState<"root" | "csv" | "pdf">("root");
  const [open, setOpen] = React.useState(false);

  const totalRecords = exports.reduce((s, e) => s + e.data.length, 0);

  function handleCSV(section: ExportSection) {
    setBusy(true);
    try {
      triggerDownload(
        toCSV(section.data, section.columns),
        `${section.filename}_${Date.now()}.csv`,
        "text/csv;charset=utf-8;"
      );
    } finally {
      setBusy(false);
      setOpen(false);
      setStep("root");
    }
  }

  function handlePDF(section: ExportSection) {
    printAsPDF(section.data, section.columns, `${title} — ${section.label}`);
    setOpen(false);
    setStep("root");
  }

  return (
    <DropdownMenu open={open} onOpenChange={(v) => { setOpen(v); if (!v) setStep("root"); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy || totalRecords === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {step === "root" && (
          <>
            <DropdownMenuLabel className="text-xs text-slate-500">Select format</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={(e) => { e.preventDefault(); setStep("csv"); }}
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              Export as Excel / CSV
              <ChevronRight className="h-3 w-3 ml-auto text-slate-400" />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={(e) => { e.preventDefault(); setStep("pdf"); }}
            >
              <FileText className="h-4 w-4 text-red-500" />
              Export as PDF
              <ChevronRight className="h-3 w-3 ml-auto text-slate-400" />
            </DropdownMenuItem>
          </>
        )}

        {(step === "csv" || step === "pdf") && (
          <>
            <DropdownMenuLabel className="text-xs text-slate-500 flex items-center gap-1">
              <button
                className="hover:text-slate-700 underline underline-offset-2"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setStep("root"); }}
              >
                ← Back
              </button>
              <span className="mx-1">·</span>
              Select dataset
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {exports.map((section) => (
              <DropdownMenuItem
                key={section.label}
                className="gap-2 cursor-pointer"
                disabled={section.data.length === 0}
                onClick={() => step === "csv" ? handleCSV(section) : handlePDF(section)}
              >
                {step === "csv"
                  ? <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  : <FileText className="h-4 w-4 text-red-500" />
                }
                <span className="truncate">{section.label}</span>
                <span className="ml-auto text-xs text-slate-400 shrink-0">{section.data.length}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Public component ──────────────────────────────────────────────────────────

export function ExportButton({
  data,
  columns,
  filename = "export",
  title = "Export",
  exports,
}: ExportButtonProps) {
  if (exports && exports.length > 0) {
    return <MultiExport exports={exports} title={title} />;
  }
  return (
    <SingleExport
      data={data ?? []}
      columns={columns ?? []}
      filename={filename}
      title={title}
    />
  );
}
