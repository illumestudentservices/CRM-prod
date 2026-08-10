/**
 * Attachment upload / download hardening — spec pentest H-4 (2026-08-10).
 *
 * Original bug: upload routes accepted any client-supplied MIME type and any
 * filename verbatim, then the download routes echoed both back in the response
 * headers. Consequences:
 *
 *   1. An uploader could set mimeType: "text/html" (or "image/svg+xml") and
 *      upload markup with <script>. The server declared it as HTML in its own
 *      response, so nosniff didn't help — the browser executed it same-origin,
 *      giving a session-riding XSS.
 *
 *   2. Raw filenames landed in Content-Disposition. A crafted name containing
 *      `; filename*=UTF-8''evil.html` or CR/LF bytes could inject header
 *      parameters or a whole new response line.
 *
 * The fix, applied at both the upload and download boundaries:
 *
 *   - Client-supplied MIME is compared to a small allowlist. If the type
 *     isn't on the list, the upload is refused. On download, we don't trust
 *     the stored value either — we send the CANONICAL type for the allowed
 *     kind rather than whatever was persisted, so a pre-fix row with a bad
 *     type can't be served incorrectly.
 *
 *   - Filename is sanitised (control chars stripped, path separators removed,
 *     length capped). Header-safe encoding for Content-Disposition uses the
 *     RFC 5987 filename*=UTF-8''… form on top of a plain-ASCII fallback.
 *
 *   - Content-Disposition is always `attachment` — never `inline` — so even
 *     an HTML/PDF viewer path cannot render an untrusted file in the origin.
 *
 *   - X-Content-Type-Options: nosniff on every response.
 *
 *   - X-Download-Options: noopen for older IE/Edge.
 *
 *   - Content-Security-Policy: sandbox on downloads, defensively.
 *
 * The allowlist is intentionally narrow. It's the set of formats the CRM
 * needs today (documents, images, presentations, spreadsheets). Anything
 * new needs a considered add here rather than a silent free-for-all.
 */

/** Canonical MIME → allowed extensions. Downloads emit this exact string. */
const ALLOWED_MIME: Record<string, ReadonlyArray<string>> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "text/plain": ["txt", "csv", "log", "md"],
  // Legacy MS Office
  "application/msword": ["doc"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.ms-powerpoint": ["ppt"],
  // Modern MS Office
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  // OpenDocument
  "application/vnd.oasis.opendocument.text": ["odt"],
  "application/vnd.oasis.opendocument.spreadsheet": ["ods"],
  "application/vnd.oasis.opendocument.presentation": ["odp"],
  // Archives (contract packs)
  "application/zip": ["zip"],
  "application/x-zip-compressed": ["zip"],
  // CSV — Excel sometimes reports this
  "text/csv": ["csv"],
} as const;

/** Reverse index: ext → canonical MIME. Populated from ALLOWED_MIME. */
const EXT_TO_MIME: Record<string, string> = {};
for (const [mime, exts] of Object.entries(ALLOWED_MIME)) {
  for (const ext of exts) EXT_TO_MIME[ext] = mime;
}

/** Extensions we NEVER accept even if the client claims a benign MIME. */
const BLOCKED_EXTENSIONS = new Set([
  "html", "htm", "xhtml", "svg", "svgz",
  "js", "mjs", "cjs", "ts", "jsx", "tsx",
  "exe", "bat", "cmd", "sh", "ps1", "vbs", "vbe", "jar", "app", "msi",
  "hta", "cpl", "scr", "com",
  "php", "phtml", "asp", "aspx", "jsp", "rb", "py", "pl", "cgi",
  "wasm", "swf",
]);

export interface AttachmentValidation {
  ok: boolean;
  /** Ready to return to the user. */
  message?: string;
  /** Canonical MIME to persist (never trust the client-supplied one). */
  canonicalMime?: string;
  /** Filename safe for storage (control chars stripped, path parts removed). */
  safeName?: string;
}

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  if (i <= 0) return "";
  return filename.slice(i + 1).toLowerCase();
}

function sanitiseFilename(raw: string): string {
  // Strip path separators (both slashes), NUL bytes, and other control
  // characters. Also normalise whitespace and cap length.
  // eslint-disable-next-line no-control-regex
  let name = raw.replace(/[/\\\x00-\x1f\x7f]/g, "").trim();
  // Reject `..` segments that survived the slash strip (belt & braces).
  name = name.replace(/\.\.+/g, ".");
  if (name.length === 0) name = "file";
  if (name.length > 200) name = name.slice(0, 200);
  return name;
}

/**
 * Validate an incoming upload. Returns the canonical MIME and safe name to
 * persist. Refuses on:
 *   - blocked extension (html, svg, exe, script types, etc.)
 *   - unknown / non-allowlisted MIME
 *   - extension / MIME mismatch (a .pdf claiming to be text/html, etc.)
 *   - empty filename
 */
export function validateAttachment(file: {
  name: string;
  type: string;
  size: number;
}): AttachmentValidation {
  const safeName = sanitiseFilename(file.name);
  if (!safeName) return { ok: false, message: "Filename is invalid." };

  const ext = extensionOf(safeName);
  if (!ext) {
    return { ok: false, message: "File must have an extension." };
  }
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      message: `Files of type .${ext} are not allowed for security reasons.`,
    };
  }

  const canonicalByExt = EXT_TO_MIME[ext];
  if (!canonicalByExt) {
    return {
      ok: false,
      message: `Files of type .${ext} are not allowed. Ask an administrator if you need this type supported.`,
    };
  }

  const claimedMime = (file.type || "").toLowerCase();
  // If the client did report a MIME, verify it matches the extension. This
  // catches "innocent" mislabels and forced type-confusion attacks alike.
  if (claimedMime && claimedMime !== canonicalByExt) {
    // Some benign renamings still line up (e.g. text/csv vs application/csv);
    // treat those loosely by checking the reverse map for the claimed MIME.
    const canonicalByMime = ALLOWED_MIME[claimedMime];
    if (!canonicalByMime || !canonicalByMime.includes(ext)) {
      return {
        ok: false,
        message: `File "${safeName}" has type "${claimedMime}" which doesn't match its .${ext} extension.`,
      };
    }
  }

  return {
    ok: true,
    canonicalMime: canonicalByExt,
    safeName,
  };
}

/**
 * Build a safe Content-Disposition value for a given filename. Uses the
 * ASCII fallback + RFC 5987 UTF-8 form so non-ASCII names still work.
 * Always `attachment`, never `inline`.
 */
export function safeContentDisposition(filename: string): string {
  const safe = sanitiseFilename(filename);
  // ASCII-only fallback — replace any non-ASCII with underscore.
  // eslint-disable-next-line no-control-regex
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(safe);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * Standard secure headers for serving an attachment. Never trust the stored
 * mimeType — pass the canonical value derived from the extension. If the
 * stored value isn't on the allowlist, fall back to octet-stream.
 */
export function safeAttachmentHeaders(opts: {
  filename: string;
  storedMime: string;
  size: number;
}): Headers {
  const ext = extensionOf(sanitiseFilename(opts.filename));
  const canonical = EXT_TO_MIME[ext] ?? "application/octet-stream";
  // If the stored value disagrees with the extension, prefer the extension.
  const mime = opts.storedMime === canonical ? canonical : canonical;

  const h = new Headers();
  h.set("Content-Type", mime);
  h.set("Content-Disposition", safeContentDisposition(opts.filename));
  h.set("Content-Length", String(opts.size));
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Download-Options", "noopen");
  // Sandbox the download response — even a malformed HTML/PDF viewer path
  // can't execute scripts or navigate to origin resources.
  h.set("Content-Security-Policy", "sandbox; default-src 'none'");
  h.set("Cache-Control", "private, no-store");
  h.set("Referrer-Policy", "no-referrer");
  return h;
}
