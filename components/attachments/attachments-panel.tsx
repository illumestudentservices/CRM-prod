"use client";

import * as React from "react";
import { Paperclip, Upload, Download, Trash2, Loader2, AlertCircle, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { checkUploadSize, formatBytes, MAX_UPLOAD_MB } from "@/lib/uploads";

/**
 * Reusable attachments panel.
 *
 * Drop this into any detail view where the parent record supports
 * attachments (any value of the AttachmentParentType enum). Handles:
 *   - initial fetch of the attachment list,
 *   - drag/drop + click upload,
 *   - per-file client-side size guard so the user finds out instantly
 *     rather than after uploading,
 *   - inline error messaging for MIME + size rejects from the server
 *     (the H-4 allowlist is the real security boundary; the client just
 *     tells the user what the server would say),
 *   - download via a temporary anchor,
 *   - delete with confirmation.
 *
 * Props are deliberately narrow: only what the parent record actually
 * needs to identify itself, plus optional read-only mode for pages where
 * the caller can view but not modify.
 */

interface AttachmentRow {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadedById: string | null;
  uploadedBy?: { id: string; name: string | null; email: string } | null;
}

export type AttachmentParentType =
  | "TASK"
  | "ACTIVITY"
  | "CLIENT_ISSUE"
  | "RECRUITMENT_EVENT"
  | "MARKETING_CAMPAIGN"
  | "RECRUITMENT_PARTNER"
  | "MARKET_UPDATE_SUGGESTION"
  | "RECRUITMENT_PLAN"
  | "VARIATION_REQUEST"
  | "MONTHLY_REPORT"
  | "ICR_MONTHLY_REPORT"
  | "ENGAGEMENT_LOG"
  | "LEAD_NOTE"
  | "LEAD"
  | "INSTITUTION_INTEREST"
  | "RISK_REGISTER"
  | "COMPLIANCE_ITEM"
  | "ACCOUNT_INTERVENTION"
  | "QUARTERLY_BUSINESS_REVIEW";

export interface AttachmentsPanelProps {
  parentType: AttachmentParentType;
  parentId: string;
  /** Hide upload + delete controls; used when the parent record is locked. */
  readOnly?: boolean;
  /** Compact variant — no padded card wrapper, single-line list. */
  compact?: boolean;
  /** Called after a successful upload or delete so the caller can refresh
      any parent-level counts. */
  onChange?: () => void;
}

export function AttachmentsPanel({
  parentType,
  parentId,
  readOnly = false,
  compact = false,
  onChange,
}: AttachmentsPanelProps) {
  const { toast } = useToast();
  const [items, setItems] = React.useState<AttachmentRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const listUrl = React.useMemo(
    () => `/api/attachments?parentType=${parentType}&parentId=${encodeURIComponent(parentId)}`,
    [parentType, parentId]
  );
  const uploadUrl = React.useMemo(
    () => `/api/attachments?parentType=${parentType}&parentId=${encodeURIComponent(parentId)}`,
    [parentType, parentId]
  );

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch(listUrl, { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? "You don't have access to attachments here." : "Couldn't load attachments.");
        setItems([]);
        return;
      }
      const body = await res.json();
      setItems(Array.isArray(body.data) ? body.data : []);
      setError(null);
    } catch {
      setError("Couldn't load attachments.");
    } finally {
      setLoading(false);
    }
  }, [listUrl]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function uploadFile(file: File) {
    // Client-side size guard — the H-4 MIME allowlist runs server-side, so
    // if the file passes size the server may still refuse for MIME.
    const sizeCheck = checkUploadSize(file);
    if (!sizeCheck.ok) {
      toast({ title: sizeCheck.message ?? "File too large.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(uploadUrl, { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: body?.error ?? `Upload failed (HTTP ${res.status})`, variant: "destructive" });
        return;
      }
      await refresh();
      onChange?.();
    } catch {
      toast({ title: "Upload failed.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    for (const f of Array.from(fileList)) {
      await uploadFile(f);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete(a: AttachmentRow) {
    if (!confirm(`Delete "${a.name}"? This can't be undone.`)) return;
    const res = await fetch(`/api/attachments/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: body?.error ?? "Couldn't delete.", variant: "destructive" });
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== a.id));
    onChange?.();
  }

  const wrapperCls = compact
    ? "space-y-2"
    : "rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900";

  return (
    <div className={wrapperCls}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
          <Paperclip className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          Attachments <span className="text-slate-400 dark:text-slate-500 font-normal">({items.length})</span>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={cn(
              "inline-flex items-center gap-1 text-xs px-2 py-1 rounded border",
              "border-slate-200 bg-slate-50 hover:bg-slate-100",
              "dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700",
              "disabled:opacity-50"
            )}
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            {uploading ? "Uploading…" : "Add file"}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => handleUpload(e.target.files)}
          className="hidden"
        />
      </div>

      {/* Drop zone (interactive when not read-only) */}
      {!readOnly && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragActive) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            void handleUpload(e.dataTransfer.files);
          }}
          className={cn(
            "mt-2 rounded-md border border-dashed p-3 text-center text-xs transition-colors",
            dragActive
              ? "border-blue-400 bg-blue-50/50 text-blue-700 dark:border-blue-500/60 dark:bg-blue-500/10 dark:text-blue-300"
              : "border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-500"
          )}
        >
          Drop files here or click <span className="underline" onClick={() => fileInputRef.current?.click()}>Add file</span>. Max {MAX_UPLOAD_MB} MB.
          <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
            PDF, images (png/jpg/webp), Office (docx/xlsx/pptx), CSV, ZIP. HTML/SVG/EXE are refused.
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 flex items-start gap-1.5 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* List */}
      <ul className="mt-2 space-y-1">
        {loading && (
          <li className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </li>
        )}
        {!loading && items.length === 0 && (
          <li className="text-xs text-slate-400 dark:text-slate-500 italic py-1">
            No attachments yet.
          </li>
        )}
        {items.map((a) => (
          <li
            key={a.id}
            className={cn(
              "flex items-center gap-2 rounded border border-slate-100 bg-slate-50/40 p-2 text-xs",
              "dark:border-slate-800 dark:bg-slate-900/40"
            )}
          >
            <FileText className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <a
                href={`/api/attachments/${a.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-slate-800 dark:text-slate-200 hover:underline truncate block"
              >
                {a.name}
              </a>
              <div className="text-[10px] text-slate-500 dark:text-slate-500">
                {formatBytes(a.size)} · uploaded {new Date(a.createdAt).toLocaleDateString()}
                {a.uploadedBy?.name && <> by {a.uploadedBy.name}</>}
              </div>
            </div>
            <a
              href={`/api/attachments/${a.id}`}
              download={a.name}
              className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              aria-label={`Download ${a.name}`}
              title="Download"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
            {!readOnly && (
              <button
                type="button"
                onClick={() => handleDelete(a)}
                className="text-slate-400 hover:text-red-600 dark:text-slate-500 dark:hover:text-red-400"
                aria-label={`Delete ${a.name}`}
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
