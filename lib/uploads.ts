/**
 * One upload size limit for the whole application.
 *
 * Before this, the knowledge base allowed 2 MB and contracts allowed 5 MB,
 * while nginx had no client_max_body_size at all and so defaulted to 1 MB —
 * meaning a 3 MB contract was accepted by the form, rejected at the edge, and
 * surfaced to the user as an unstyled 413 page. Three different answers to the
 * same question is how that happens, so there is now exactly one.
 *
 * Enforced at three layers, deliberately:
 *
 *   client  rejects before the bytes are sent, so the user gets an instant,
 *           specific message instead of waiting for an upload to fail
 *   server  the actual control — a client check is a convenience, not a
 *           security boundary, since the request can be made directly
 *   nginx   a backstop set slightly ABOVE the app limit, so oversized bodies
 *           are still cut off at the edge but anything between the two is
 *           refused by the app with a readable message rather than a raw 413
 */

export const MAX_UPLOAD_MB = 3;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** Shown wherever a file is refused, so the wording never drifts. */
export const UPLOAD_LIMIT_MESSAGE = `Files must be ${MAX_UPLOAD_MB} MB or smaller.`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface UploadCheck {
  ok: boolean;
  /** Ready to show to the user, naming the file and its actual size. */
  message?: string;
}

/** Single file. */
export function checkUploadSize(file: { name: string; size: number }): UploadCheck {
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      message: `"${file.name}" is ${formatBytes(file.size)}. ${UPLOAD_LIMIT_MESSAGE}`,
    };
  }
  if (file.size === 0) {
    return { ok: false, message: `"${file.name}" is empty.` };
  }
  return { ok: true };
}

/**
 * Several files at once. Reports every offender rather than only the first,
 * so a user picking ten files is not made to retry ten times.
 */
export function checkUploadSizes(files: Array<{ name: string; size: number }>): UploadCheck {
  const tooBig = files.filter((f) => f.size > MAX_UPLOAD_BYTES);
  if (tooBig.length === 0) return { ok: true };
  const names = tooBig.map((f) => `${f.name} (${formatBytes(f.size)})`).join(", ");
  return {
    ok: false,
    message: `${UPLOAD_LIMIT_MESSAGE} Too large: ${names}`,
  };
}
