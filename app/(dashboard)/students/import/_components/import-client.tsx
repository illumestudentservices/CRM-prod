"use client";

import * as React from "react";
import Papa from "papaparse";
import {
  Upload, Download, CheckCircle2, AlertTriangle, Loader2, FileSpreadsheet, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  IMPORT_FIELDS, IMPORT_MAX_ROWS, resolveInstitutionForRow, validateImportRow,
  type ImportableInstitution,
} from "@/lib/lead-import";

interface Props {
  admin: boolean;
  institutions: ImportableInstitution[];
}

type RowStatus = "valid" | "error";
type ServerStatus = "created" | "duplicate" | "error";

interface PreviewRow {
  row: number;
  raw: Record<string, string>;
  name: string;
  email: string;
  university: string;
  status: RowStatus;
  message?: string;
  serverStatus?: ServerStatus;
  serverMessage?: string;
}

interface Summary {
  submitted: number;
  created: number;
  duplicates: number;
  failed: number;
}

const PREVIEW_LIMIT = 100;

export function ImportLeadsClient({ admin, institutions }: Props) {
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<PreviewRow[]>([]);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [summary, setSummary] = React.useState<Summary | null>(null);

  const validCount = rows.filter((r) => r.status === "valid").length;
  const errorCount = rows.length - validCount;

  function reset() {
    setRows([]);
    setFileName(null);
    setParseError(null);
    setSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFile(file: File) {
    setParseError(null);
    setSummary(null);
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const data = res.data.filter(
          (r) => r && Object.values(r).some((v) => String(v ?? "").trim() !== "")
        );
        if (data.length === 0) {
          setRows([]);
          setParseError("The file has no data rows. Did you fill in the template?");
          return;
        }
        if (data.length > IMPORT_MAX_ROWS) {
          setRows([]);
          setParseError(`Too many rows: ${data.length}. The limit is ${IMPORT_MAX_ROWS} per import.`);
          return;
        }
        const preview: PreviewRow[] = data.map((raw, i) => {
          const rowNo = i + 1;
          const valid = validateImportRow(raw);
          const name = `${(raw.firstName ?? "").trim()} ${(raw.lastName ?? "").trim()}`.trim();
          const email = (raw.email ?? "").trim();
          if (!valid.ok) {
            return { row: rowNo, raw, name, email, university: (raw.university ?? "").trim(), status: "error", message: valid.errors.join("; ") };
          }
          const resolved = resolveInstitutionForRow(valid.data.university, institutions, admin);
          if (!resolved.ok) {
            return { row: rowNo, raw, name, email, university: valid.data.university ?? "", status: "error", message: resolved.error };
          }
          return { row: rowNo, raw, name, email, university: resolved.institutionName, status: "valid" };
        });
        setRows(preview);
      },
      error: (err) => {
        setRows([]);
        setParseError(`Could not read the file: ${err.message}`);
      },
    });
  }

  async function handleImport() {
    if (validCount === 0 || importing) return;
    setImporting(true);
    try {
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rows.map((r) => r.raw) }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ title: "Import failed", description: json.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      const results: { row: number; status: ServerStatus; message?: string }[] = json.results ?? [];
      const byRow = new Map(results.map((r) => [r.row, r]));
      setRows((prev) =>
        prev.map((r) => {
          const sr = byRow.get(r.row);
          return sr ? { ...r, serverStatus: sr.status, serverMessage: sr.message } : r;
        })
      );
      setSummary(json.summary as Summary);
      const s = json.summary as Summary;
      toast({
        title: "Import finished",
        description: `${s.created} created${s.duplicates ? `, ${s.duplicates} possible duplicates` : ""}${s.failed ? `, ${s.failed} failed` : ""}.`,
      });
    } catch {
      toast({ title: "Import failed", description: "A network error occurred.", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Step 1: template + guide ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-[#1E3A5F]" />
            Step 1 — Download the template
          </CardTitle>
          <CardDescription>
            Fill your leads into this CSV, then upload it below. Keep the header row exactly as it is.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Button asChild>
            <a href="/api/leads/import/template" download>
              <Download className="size-4" /> Download CSV template
            </a>
          </Button>

          {/* University guidance */}
          <Alert>
            <AlertTitle>Which university?</AlertTitle>
            <AlertDescription>
              {admin ? (
                <>You can import for <strong>any university</strong>. Fill the <code>university</code> column on every row with a name that matches a university exactly.</>
              ) : institutions.length === 1 ? (
                <>Your leads will be imported for <strong>{institutions[0].name}</strong>. You can leave the <code>university</code> column blank.</>
              ) : institutions.length > 1 ? (
                <>You represent more than one university, so fill the <code>university</code> column on every row with one of: {institutions.map((i) => <strong key={i.id}>{i.name}</strong>).reduce((acc, el, idx) => idx === 0 ? [el] : [...acc, ", ", el], [] as React.ReactNode[])}.</>
              ) : (
                <>You are not assigned to any university yet, so you cannot import leads. Please ask an administrator.</>
              )}
            </AlertDescription>
          </Alert>

          {/* Field guide */}
          <div>
            <p className="text-sm font-medium mb-2">Columns</p>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Column</TableHead>
                    <TableHead className="w-28">Required?</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {IMPORT_FIELDS.map((f) => (
                    <TableRow key={f.key}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{f.key}</TableCell>
                      <TableCell>
                        {f.required ? (
                          <Badge className="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300 hover:bg-red-100">Mandatory</Badge>
                        ) : (
                          <Badge variant="secondary">Optional</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{f.notes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Step 2: upload ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="size-5 text-[#1E3A5F]" />
            Step 2 — Upload your file
          </CardTitle>
          <CardDescription>We&apos;ll check every row before anything is saved.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="size-4" /> Choose CSV file
            </Button>
            {fileName && (
              <span className="text-sm text-muted-foreground inline-flex items-center gap-2">
                {fileName}
                <button type="button" onClick={reset} className="text-muted-foreground hover:text-foreground" aria-label="Clear file">
                  <X className="size-4" />
                </button>
              </span>
            )}
          </div>

          {parseError && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Could not read the file</AlertTitle>
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}

          {rows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="size-4" /> {validCount} ready
                </span>
                {errorCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-400">
                    <AlertTriangle className="size-4" /> {errorCount} with problems
                  </span>
                )}
                <span className="text-muted-foreground">of {rows.length} rows</span>
              </div>

              {errorCount > 0 && !summary && (
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Some rows have problems</AlertTitle>
                  <AlertDescription>
                    Rows with problems will be skipped. Fix them in the file and re-upload, or import the {validCount} good rows now.
                  </AlertDescription>
                </Alert>
              )}

              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Row</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>University</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, PREVIEW_LIMIT).map((r) => (
                      <TableRow key={r.row}>
                        <TableCell className="text-muted-foreground">{r.row}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.name || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.email || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.university || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>
                          <StatusCell r={r} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {rows.length > PREVIEW_LIMIT && (
                <p className="text-xs text-muted-foreground">Showing the first {PREVIEW_LIMIT} of {rows.length} rows. All rows will be processed.</p>
              )}

              {summary ? (
                <Alert>
                  <CheckCircle2 className="size-4" />
                  <AlertTitle>Import finished</AlertTitle>
                  <AlertDescription>
                    {summary.created} created
                    {summary.duplicates ? `, ${summary.duplicates} possible duplicates (created and flagged)` : ""}
                    {summary.failed ? `, ${summary.failed} failed` : ""}.
                    {" "}
                    <button type="button" className="underline" onClick={reset}>Import another file</button>
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="flex items-center gap-3">
                  <Button onClick={handleImport} disabled={validCount === 0 || importing}>
                    {importing ? <><Loader2 className="size-4 animate-spin" /> Importing…</> : <>Import {validCount} lead{validCount === 1 ? "" : "s"}</>}
                  </Button>
                  <Button variant="ghost" onClick={reset} disabled={importing}>Cancel</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusCell({ r }: { r: PreviewRow }) {
  if (r.serverStatus) {
    if (r.serverStatus === "created")
      return <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400 text-sm"><CheckCircle2 className="size-4" /> Created</span>;
    if (r.serverStatus === "duplicate")
      return <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 text-sm" title={r.serverMessage}><AlertTriangle className="size-4" /> Duplicate</span>;
    return <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400 text-sm" title={r.serverMessage}><AlertTriangle className="size-4" /> {r.serverMessage ?? "Failed"}</span>;
  }
  if (r.status === "valid")
    return <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400 text-sm"><CheckCircle2 className="size-4" /> Ready</span>;
  return <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400 text-sm" title={r.message}>
    <AlertTriangle className="size-4" /> {r.message}
  </span>;
}
