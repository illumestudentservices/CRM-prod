/**
 * QA for 3a — check-backup-health.ts.
 *
 * Builds throwaway backup directories and runs the real checker against each,
 * asserting: a healthy fresh backup exits 0 and writes NO alert; and each
 * unhealthy shape (missing / stale / too-small / corrupt) exits non-zero AND
 * writes a BACKUP_UNHEALTHY audit row naming that directory. Email is forced
 * off; audit rows and admin notifications created during the test are removed.
 *
 *   BREVO_API_KEY= npx tsx --env-file=.env.local scripts/qa-backup-health.ts
 */
import "dotenv/config";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";

let pass = 0;
let fail = 0;
function expect(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

const SCRIPT = "scripts/check-backup-health.ts";

/** Run the checker against a dir; return its exit code (0 = healthy). */
function runChecker(dir: string): number {
  try {
    execFileSync("node", ["--import", "tsx", SCRIPT], {
      env: { ...process.env, BACKUP_DIR: dir, BREVO_API_KEY: "" },
      stdio: "ignore",
    });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? 1;
  }
}

async function alertRows(dir: string): Promise<number> {
  return db.auditLog.count({ where: { action: "BACKUP_UNHEALTHY", entityId: dir } });
}

function makeNightly(dir: string, name: string, bytes: number, ageHours: number, valid = true) {
  const path = join(dir, name);
  // Random bytes: gzip can't compress them, so the on-disk size tracks `bytes`
  // (filler like "aaaa" would compress to almost nothing and defeat the size check).
  const raw = randomBytes(bytes);
  writeFileSync(path, valid ? gzipSync(raw) : Buffer.concat([gzipSync(raw), Buffer.from("CORRUPT")]));
  if (ageHours > 0) {
    const t = (Date.now() - ageHours * 3_600_000) / 1000;
    utimesSync(path, t, t);
  }
  return path;
}

async function scenario(label: string, build: (dir: string) => void, expectHealthy: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "qa-backup-"));
  try {
    build(dir);
    const code = runChecker(dir);
    const rows = await alertRows(dir);
    if (expectHealthy) {
      expect(`${label}: exits 0`, code === 0, `(code ${code})`);
      expect(`${label}: writes NO alert`, rows === 0, `(rows ${rows})`);
    } else {
      expect(`${label}: exits non-zero`, code !== 0, `(code ${code})`);
      expect(`${label}: writes a BACKUP_UNHEALTHY alert`, rows >= 1, `(rows ${rows})`);
    }
  } finally {
    await db.auditLog.deleteMany({ where: { action: "BACKUP_UNHEALTHY", entityId: dir } });
    rmSync(dir, { recursive: true, force: true });
  }
}

async function run() {
  // Healthy: a fresh, valid, 20KB nightly dump.
  await scenario("healthy fresh backup", (dir) => {
    makeNightly(dir, "illume_crm-nightly-20260101-023001.sql.gz", 20000, 0.1);
  }, true);

  // Missing: directory with no nightly file (a stray pre-deploy doesn't count).
  await scenario("no nightly file", (dir) => {
    writeFileSync(join(dir, "illume_crm-pre-deploy-20260101-101010.sql.gz"), gzipSync(Buffer.alloc(20000, "a")));
  }, false);

  // Stale: a valid dump but 48h old (window is 26h).
  await scenario("stale backup (48h old)", (dir) => {
    makeNightly(dir, "illume_crm-nightly-20251230-023001.sql.gz", 20000, 48);
  }, false);

  // Too small: fresh but under the 10KB floor.
  await scenario("too-small backup", (dir) => {
    makeNightly(dir, "illume_crm-nightly-20260101-023001.sql.gz", 500, 0.1);
  }, false);

  // Corrupt: fresh, big enough, but fails gzip -t (only asserted if gzip exists).
  let gzipAvailable = true;
  try { execFileSync("gzip", ["--version"], { stdio: "ignore" }); } catch { gzipAvailable = false; }
  if (gzipAvailable) {
    await scenario("corrupt backup (bad gzip)", (dir) => {
      makeNightly(dir, "illume_crm-nightly-20260101-023001.sql.gz", 20000, 0.1, false);
    }, false);
  } else {
    console.log("  — skipped corrupt-backup case (gzip not on PATH)");
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => {
  console.error("qa-backup-health crashed", e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
