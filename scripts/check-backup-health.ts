/**
 * 3a — nightly database backup health check.
 *
 *   node --import tsx scripts/check-backup-health.ts
 *
 * Until now, a failed nightly backup was silent. `backup-db.sh` is careful to
 * never write a bad file (see its header), but it can only protect you when it
 * RUNS — if cron is removed, the box is down at 02:30, or the script errors
 * before writing, no file appears and nobody is told. The one thing a backup
 * system must never do is fail quietly, because you find out the day you need a
 * restore.
 *
 * This runs from the ROOT crontab a little after the 02:30 nightly job, reads
 * the newest `illume_crm-nightly-*.sql.gz`, and — if it is MISSING, STALE
 * (older than the window), TOO SMALL, or CORRUPT — writes a BACKUP_UNHEALTHY
 * audit row and emails the super admins. On a healthy backup it logs one line
 * and exits 0. It must read /root/db-backups, hence root; everything it touches
 * is read-only.
 *
 * Tunables (env):
 *   BACKUP_DIR        default /root/db-backups
 *   BACKUP_MAX_AGE_H  default 26  (nightly runs every 24h; 26 absorbs clock/runtime drift)
 *   BACKUP_MIN_BYTES  default 10240  (matches backup-db.sh's own floor)
 */
import "dotenv/config";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { db } from "@/lib/db";
import { notifyAdmins } from "@/lib/admin-alerts";
import { reportAutomationFailure } from "@/lib/automation-failure";

const DIR = process.env.BACKUP_DIR ?? "/root/db-backups";
const MAX_AGE_H = Number(process.env.BACKUP_MAX_AGE_H ?? 26);
const MIN_BYTES = Number(process.env.BACKUP_MIN_BYTES ?? 10240);
const PREFIX = "illume_crm-nightly-";
// Encrypted backups (.sql.gz.gpg) are the norm now; older plaintext .sql.gz are
// still accepted while they age out of the 14-day retention window.
const SUFFIXES = [".sql.gz.gpg", ".sql.gz"];
const PASSPHRASE_FILE = process.env.BACKUP_PASSPHRASE_FILE ?? "/root/.illume-backup-passphrase";

type Problem = { reason: string; detail: [string, string][] };

function newestNightly(): { path: string; name: string; mtime: Date; size: number } | null {
  let entries: string[];
  try {
    entries = readdirSync(DIR);
  } catch (e) {
    throw new Error(`cannot read backup directory ${DIR}: ${(e as Error).message}`);
  }
  const candidates = entries.filter((n) => n.startsWith(PREFIX) && SUFFIXES.some((s) => n.endsWith(s)));
  let newest: { path: string; name: string; mtime: Date; size: number } | null = null;
  for (const name of candidates) {
    const path = join(DIR, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (!newest || st.mtimeMs > newest.mtime.getTime()) {
      newest = { path, name, mtime: st.mtime, size: st.size };
    }
  }
  return newest;
}

function inspect(): Problem | null {
  const newest = newestNightly();
  if (!newest) {
    return {
      reason: "No nightly backup file found",
      detail: [
        ["Directory", DIR],
        ["Looked for", `${PREFIX}*.sql.gz[.gpg]`],
      ],
    };
  }

  const ageH = (Date.now() - newest.mtime.getTime()) / 3_600_000;
  const base: [string, string][] = [
    ["Newest backup", newest.name],
    ["Age", `${ageH.toFixed(1)} h`],
    ["Size", `${(newest.size / 1_048_576).toFixed(2)} MB`],
  ];

  if (ageH > MAX_AGE_H) {
    return {
      reason: `Newest backup is stale (${ageH.toFixed(1)}h old, limit ${MAX_AGE_H}h)`,
      detail: base,
    };
  }
  if (newest.size < MIN_BYTES) {
    return {
      reason: `Newest backup is suspiciously small (${newest.size} bytes, floor ${MIN_BYTES})`,
      detail: base,
    };
  }
  // Integrity. Best-effort about the checker's OWN environment (a missing
  // binary is not a backup fault), but a genuine corruption / un-decryptable
  // dump IS reported.
  if (newest.name.endsWith(".gpg")) {
    // Encrypted: prove it decrypts with the stored passphrase, then gzip -t the
    // plaintext stream. Only attempted when gpg and the passphrase are present
    // here — otherwise skip, like the gzip-missing case below.
    let gpgHere = true;
    try { execFileSync("gpg", ["--version"], { stdio: "ignore" }); } catch { gpgHere = false; }
    if (gpgHere && existsSync(PASSPHRASE_FILE)) {
      try {
        execSync(
          `gpg --quiet --batch --yes --pinentry-mode loopback --passphrase-file ${JSON.stringify(PASSPHRASE_FILE)} --decrypt ${JSON.stringify(newest.path)} | gzip -t`,
          { stdio: "ignore" }
        );
      } catch {
        return { reason: "Newest backup failed to decrypt / verify (bad passphrase or corrupt)", detail: base };
      }
    }
  } else {
    try {
      execFileSync("gzip", ["-t", newest.path], { stdio: "ignore" });
    } catch (e) {
      const msg = (e as NodeJS.ErrnoException).code === "ENOENT"
        ? null // gzip binary missing — skip the integrity check, not a backup problem
        : "gzip integrity check failed";
      if (msg) return { reason: msg, detail: base };
    }
  }

  console.log(`[check-backup-health] ok — ${newest.name}, ${(newest.size / 1_048_576).toFixed(2)}MB, ${ageH.toFixed(1)}h old`);
  return null;
}

async function main() {
  const problem = inspect();
  if (!problem) {
    await db.$disconnect();
    process.exit(0);
  }

  console.error(`[check-backup-health] UNHEALTHY — ${problem.reason}`);

  // Record it, even if the alert email can't go out.
  try {
    await db.auditLog.create({
      data: {
        userId: null,
        action: "BACKUP_UNHEALTHY",
        entity: "Backup",
        entityId: DIR,
        changes: { reason: problem.reason, detail: problem.detail },
      },
    });
  } catch (e) {
    console.error("[check-backup-health] audit write failed:", e);
  }

  try {
    await notifyAdmins({
      action: "BACKUP_UNHEALTHY",
      actorName: "System (backup check)",
      actorEmail: "system",
      summary: problem.reason,
      detail: problem.detail,
    });
  } catch (e) {
    console.error("[check-backup-health] admin alert failed:", e);
  }

  await db.$disconnect();
  process.exit(1);
}

main().catch(async (err) => {
  console.error("[check-backup-health] fatal", err);
  // The checker itself failing is a cron failure — surface it the same way.
  await reportAutomationFailure("check-backup-health", err);
  await db.$disconnect().catch(() => {});
  process.exit(2);
});
