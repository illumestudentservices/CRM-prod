import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The staff user guide, as a base64 attachment for Brevo.
 *
 * ★ WHY THIS IS A MODULE AND NOT TWO LINES AT THE CALL SITE.
 *
 * The guide is 2.7 MB, which is 3.6 MB once base64-encoded. Onboarding sends
 * it to eighty-odd people in one run, and reading + encoding the same file
 * eighty times is 290 MB of pointless string churn in a Node process that also
 * has to hold a Prisma client. So it is read once and kept.
 *
 * It is NOT read at import time. A missing file must not stop the module
 * graph from loading — the welcome email matters far more than its attachment.
 */

const FILE = "Illume ERP - Staff User Guide.pdf";

/** The name the recipient sees in their mail client, not the path on disk. */
export const STAFF_GUIDE_FILENAME = "Illume ERP - Staff User Guide.pdf";

/**
 * Brevo's hard ceiling for a transactional message is 10 MB including the
 * body and the base64 overhead. The guide is nowhere near it today, but the
 * guide grows every time a screenshot is added, and the failure mode is that
 * a new joiner silently receives nothing at all. 8 MB of base64 leaves room
 * for the HTML and the envelope, and anything above it is refused HERE —
 * where it can be logged and skipped — rather than by the API.
 */
const MAX_BASE64_BYTES = 8 * 1024 * 1024;

type Cached = { name: string; content: string } | null;

let cache: Cached;
let attempted = false;

function candidates(): string[] {
  // PM2 runs the app from /var/www/illume-crm, so cwd is the repo root and the
  // first candidate hits. The env var is the escape hatch for a standalone
  // build, where only the traced files are copied and docs/ would not be.
  const explicit = process.env.STAFF_GUIDE_PATH;
  return [
    ...(explicit ? [explicit] : []),
    join(process.cwd(), "docs", FILE),
    join(process.cwd(), "..", "docs", FILE),
  ];
}

/**
 * Returns the attachment, or null if the guide cannot be read.
 *
 * Null is a normal answer, not an error: the caller sends the email without
 * it. Both outcomes are logged once, because "did the guide go out?" is a
 * question somebody will ask after the fact.
 */
export function staffGuideAttachment(): { name: string; content: string } | null {
  if (attempted) return cache;
  attempted = true;

  for (const path of candidates()) {
    try {
      const bytes = statSync(path).size;
      const b64 = readFileSync(path).toString("base64");
      if (b64.length > MAX_BASE64_BYTES) {
        console.error(
          `[staff-guide] ${path} is too large to attach ` +
            `(${(bytes / 1048576).toFixed(1)} MB raw, ` +
            `${(b64.length / 1048576).toFixed(1)} MB encoded; limit ` +
            `${MAX_BASE64_BYTES / 1048576} MB). Sending without it.`,
        );
        cache = null;
        return cache;
      }
      console.log(
        `[staff-guide] attaching ${path} (${(bytes / 1048576).toFixed(2)} MB)`,
      );
      cache = { name: STAFF_GUIDE_FILENAME, content: b64 };
      return cache;
    } catch {
      // Try the next candidate.
    }
  }

  console.error(
    `[staff-guide] NOT FOUND — looked in: ${candidates().join(", ")}. ` +
      `Welcome emails will go out without the guide attached.`,
  );
  cache = null;
  return cache;
}

/** Test seam: forget what was read, so a replaced file is picked up. */
export function resetStaffGuideCache() {
  cache = undefined as unknown as Cached;
  attempted = false;
}
