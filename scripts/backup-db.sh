#!/usr/bin/env bash
#
# Back up the production database.
#
#   backup-db.sh [label]      label defaults to "manual"
#
# Used three ways:
#   - nightly from cron            backup-db.sh nightly
#   - before every deploy          backup-db.sh pre-deploy   (see deploy.sh)
#   - by hand before a migration   backup-db.sh pre-042
#
# Until 2026-10-09 there was no backup job at all. The twenty-eight dumps in
# /root/db-backups were each taken by hand before a risky migration, the newest
# was nineteen days old, and nothing in this repo mentioned backups. A cron
# entry existed to chmod the backup directory, which made it look covered.
#
# ── Two failure modes this script is built around ────────────────────────────
#
# 1. `pg_dump | gzip` HIDES A FAILING pg_dump. The pipeline's exit status is
#    gzip's, and gzip is perfectly happy to compress nothing, so a dump that
#    died on connect still writes a plausible-looking file and reports success.
#    That already happened here: illume_crm-pre-019-20260809-164600.sql is
#    0 bytes, written twenty seconds before the real one, and nobody noticed.
#    Hence `set -o pipefail`, an explicit PIPESTATUS check, and verification of
#    the finished file before it is allowed to count as a backup.
#
# 2. PRUNING BEFORE THE NEW DUMP SUCCEEDS. Rotate first and the night the dump
#    breaks is the night the old ones are deleted — the backup directory empties
#    itself and the failure is silent until someone needs a restore. Nothing is
#    deleted here until the new file exists and has been checked.
#
set -euo pipefail

DB=illume_crm
DEST=/root/db-backups
LABEL="${1:-manual}"
KEEP_DAYS=14
TS=$(date +%Y%m%d-%H%M%S)
OUT="$DEST/${DB}-${LABEL}-${TS}.sql.gz"
PART="$OUT.part"

log()  { printf '[backup-db] %s\n' "$*"; }
die()  { printf '[backup-db] FAILED: %s\n' "$*" >&2; exit 1; }

# The half-written file goes on ANY exit, not just the ones die() handles.
#
# A self-test crashed the script between the dump and the rename, and the
# orphaned .part survived — it does not match the `*.sql.gz` the pruner looks
# for, so nothing would ever have cleared it. One stale file is harmless; one
# per failure, forever, on a disk holding backups, is not.
trap 'rm -f "$PART"' EXIT

command -v pg_dump >/dev/null || die "pg_dump not on PATH"
mkdir -p "$DEST"
umask 077   # the dump holds passport numbers and home addresses

# ── Dump ─────────────────────────────────────────────────────────────────────
# Written to .part first: a half-finished file under the real name is
# indistinguishable from a good backup to anyone scanning the directory, and to
# the pruner below.
log "dumping $DB -> $(basename "$OUT")"
set +e
sudo -u postgres pg_dump "$DB" | gzip > "$PART"
STATUS=("${PIPESTATUS[@]}")
set -e
[ "${STATUS[0]}" -eq 0 ] || die "pg_dump exited ${STATUS[0]}"
[ "${STATUS[1]}" -eq 0 ] || die "gzip exited ${STATUS[1]}"

# ── Verify before it counts ──────────────────────────────────────────────────
gzip -t "$PART" 2>/dev/null || die "gzip integrity check failed"

# One pass, collected into a variable.
#
# ★ `zcat "$PART" | grep -q ...` is WRONG under `set -o pipefail`, and it took
# a self-test to see it: grep -q exits the instant it matches, zcat gets
# SIGPIPE, and pipefail then fails the pipeline because a stage died — so a
# SUCCESSFUL match reads as a failed check. The first version of this script
# rejected a perfectly good dump of the live database for that reason, which is
# the same shape of pipeline bug the header warns about.
CREATED=$(zcat "$PART" | grep '^CREATE TABLE' || true)
TABLES=$(printf '%s\n' "$CREATED" | grep -c '^CREATE TABLE' || true)
[ "$TABLES" -gt 0 ] || die "no CREATE TABLE statements — the dump is empty"

# A table count floor would need raising with every migration and would be
# forgotten. Naming the tables the business cannot be restored without is
# stable, and catches a dump that connected to the wrong database.
for t in users employees leads leave_requests; do
  case "$CREATED" in
    *"CREATE TABLE public.$t "*) ;;
    *) die "table '$t' missing from the dump — wrong database?" ;;
  esac
done

SIZE=$(stat -c %s "$PART")
[ "$SIZE" -gt 10240 ] || die "dump is only ${SIZE} bytes"

mv "$PART" "$OUT"
chmod 600 "$OUT"
log "ok — $(du -h "$OUT" | cut -f1), $TABLES tables"

# ── Prune, only now, and only our own ────────────────────────────────────────
# Restricted to the labels this script writes on a schedule. The hand-made
# historical dumps (pre-019, pre-redesign, pre-partner-rename …) are small, they
# mark specific migrations, and they are not this job's to delete.
PRUNED=0
for label in nightly pre-deploy; do
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    rm -f "$old" && PRUNED=$((PRUNED + 1))
    log "pruned $(basename "$old")"
  done < <(find "$DEST" -maxdepth 1 -type f \
             -name "${DB}-${label}-*.sql.gz" -mtime "+$KEEP_DAYS" 2>/dev/null)
done

TOTAL=$(find "$DEST" -maxdepth 1 -type f -name "${DB}-*.sql.gz" | wc -l)
log "done — pruned $PRUNED, $TOTAL dump(s) held, keeping ${KEEP_DAYS}d of nightly/pre-deploy"
