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
import {
  type ExportColumn,
  csvCell,
  toCSV,
  buildExportPdfHtml,
} from "@/lib/export-format";

export type { ExportColumn };
// Re-exported for existing importers; the implementation now lives in
// lib/export-format.ts so it can be unit tested without React.
export { csvCell };

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

function triggerDownload(content: string, filename: string, mime: string) {
  // ★ The BOM is what makes Excel read this as UTF-8.
  //
  // `charset=utf-8` in the MIME type is ignored for a file opened from disk:
  // Excel on Windows falls back to the system codepage, so "José Ramírez" and
  // "陈伟" arrive as mojibake. This business recruits from India, Nigeria,
  // China and Malaysia — non-ASCII names are the norm here, not an edge case.
  // Written as an escape, not a literal BOM: an invisible character in source
  // is one "tidy up whitespace" commit away from silently disappearing, and
  // the symptom would be mojibake in someone else's spreadsheet weeks later.
  const body = mime.includes("csv") ? `\uFEFF${content}` : content;
  const blob = new Blob([body], { type: mime });
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
  // The document is built in lib/export-format.ts, where every dynamic value
  // (cell, title, header) is HTML-escaped. Record values are user-controlled
  // and this window executes scripts, so escaping is what stops a stored name
  // or note from running as code here.
  const html = buildExportPdfHtml(data, columns, title);

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
        <DropdownMenuLabel className="text-xs text-slate-500 dark:text-slate-400">
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
            <DropdownMenuLabel className="text-xs text-slate-500 dark:text-slate-400">Select format</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={(e) => { e.preventDefault(); setStep("csv"); }}
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              Export as Excel / CSV
              <ChevronRight className="h-3 w-3 ml-auto text-slate-400 dark:text-slate-500" />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={(e) => { e.preventDefault(); setStep("pdf"); }}
            >
              <FileText className="h-4 w-4 text-red-500" />
              Export as PDF
              <ChevronRight className="h-3 w-3 ml-auto text-slate-400 dark:text-slate-500" />
            </DropdownMenuItem>
          </>
        )}

        {(step === "csv" || step === "pdf") && (
          <>
            <DropdownMenuLabel className="text-xs text-slate-500 flex items-center gap-1">
              <button
                className="hover:text-slate-700 dark:hover:text-slate-200 underline underline-offset-2"
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
                <span className="ml-auto text-xs text-slate-400 dark:text-slate-500 shrink-0">{section.data.length}</span>
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
