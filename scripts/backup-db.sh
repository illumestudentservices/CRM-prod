#!/usr/bin/env bash
#
# Back up the production database — ENCRYPTED AT REST.
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
# ── Encryption (2026-11-22) ──────────────────────────────────────────────────
#
# The dump holds passport numbers, home addresses and the whole database. A
# plain .sql.gz sitting on disk is readable by anyone who gets the file (a
# stolen snapshot, a copied backup). Each dump is now symmetrically encrypted
# with GPG (AES-256) using a passphrase kept OUTSIDE this repo and outside the
# backup directory. The output is `.sql.gz.gpg`.
#
# HARD RULE: the passphrase must never live in /root/db-backups or in any dump
# archive, and must NOT be the field-encryption key — or a stolen backup brings
# its own key. It lives at $BACKUP_PASSPHRASE_FILE (default
# /root/.illume-backup-passphrase, root-only 600), which this script only reads.
#
# Encryption is REQUIRED: if gpg or the passphrase file is missing, the backup
# FAILS loudly rather than silently writing a plaintext dump. "Back up in the
# clear because the key is missing" is not a decision this script may make
# quietly. Restore with scripts/restore-backup.sh.
#
# ── Two failure modes this script is built around ────────────────────────────
#
# 1. `pg_dump | gzip` HIDES A FAILING pg_dump. The pipeline's exit status is the
#    LAST stage's, and gzip/gpg are happy to process nothing, so a dump that
#    died on connect still writes a plausible-looking file and reports success.
#    That already happened here: illume_crm-pre-019-20260809-164600.sql is
#    0 bytes. Hence `set -o pipefail`, an explicit PIPESTATUS check on EVERY
#    stage, and verification (by decrypting) of the finished file before it is
#    allowed to count as a backup.
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
OUT="$DEST/${DB}-${LABEL}-${TS}.sql.gz.gpg"
PART="$OUT.part"
PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-/root/.illume-backup-passphrase}"

log()  { printf '[backup-db] %s\n' "$*"; }
die()  { printf '[backup-db] FAILED: %s\n' "$*" >&2; exit 1; }

# The half-written file goes on ANY exit, not just the ones die() handles.
trap 'rm -f "$PART"' EXIT

command -v pg_dump >/dev/null || die "pg_dump not on PATH"
command -v gpg >/dev/null     || die "gpg not on PATH — needed to encrypt the backup"
[ -r "$PASSPHRASE_FILE" ]     || die "passphrase file not readable at $PASSPHRASE_FILE — refusing to write a plaintext backup"
[ -s "$PASSPHRASE_FILE" ]     || die "passphrase file is empty at $PASSPHRASE_FILE"
mkdir -p "$DEST"
umask 077   # the dump holds passport numbers and home addresses

# gpg in a non-interactive/no-TTY cron context needs loopback pinentry to take
# the passphrase from a file. --batch --yes keeps it from ever prompting.
gpg_enc() { gpg --symmetric --cipher-algo AES256 --batch --yes --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" -o "$PART"; }
gpg_dec() { gpg --quiet --batch --yes --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" --decrypt "$PART" 2>/dev/null; }

# ── Dump → gzip → encrypt ─────────────────────────────────────────────────────
# Written to .part first: a half-finished file under the real name is
# indistinguishable from a good backup to anyone scanning the directory, and to
# the pruner below.
log "dumping $DB -> $(basename "$OUT") (encrypted)"
set +e
sudo -u postgres pg_dump "$DB" | gzip | gpg_enc
STATUS=("${PIPESTATUS[@]}")
set -e
[ "${STATUS[0]}" -eq 0 ] || die "pg_dump exited ${STATUS[0]}"
[ "${STATUS[1]}" -eq 0 ] || die "gzip exited ${STATUS[1]}"
[ "${STATUS[2]}" -eq 0 ] || die "gpg (encrypt) exited ${STATUS[2]}"

# ── Verify by DECRYPTING before it counts ────────────────────────────────────
# This also proves the backup can be opened with the stored passphrase — an
# un-decryptable backup is worse than none, and we want to learn that now, not
# the day we need a restore.
gpg_dec | gzip -t 2>/dev/null || die "decrypt + gzip integrity check failed (bad passphrase or corrupt dump)"

# One pass, collected into a variable. grep WITHOUT -q (it must read the whole
# stream): `gpg_dec | zcat | grep -q` would SIGPIPE zcat on first match and
# pipefail would then read a SUCCESSFUL match as a failed check.
CREATED=$(gpg_dec | zcat | grep '^CREATE TABLE' || true)
TABLES=$(printf '%s\n' "$CREATED" | grep -c '^CREATE TABLE' || true)
[ "$TABLES" -gt 0 ] || die "no CREATE TABLE statements — the dump is empty"

# Naming the tables the business cannot be restored without is stable, and
# catches a dump that connected to the wrong database.
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
log "ok — $(du -h "$OUT" | cut -f1), $TABLES tables, encrypted"

# ── Prune, only now, and only our own ────────────────────────────────────────
# Both the new encrypted dumps AND any older plaintext .sql.gz from before this
# change are aged out. The hand-made historical dumps (pre-019, pre-redesign …)
# are not this job's to delete, so only the scheduled labels are pruned.
PRUNED=0
for label in nightly pre-deploy; do
  for suffix in sql.gz.gpg sql.gz; do
    while IFS= read -r old; do
      [ -n "$old" ] || continue
      rm -f "$old" && PRUNED=$((PRUNED + 1))
      log "pruned $(basename "$old")"
    done < <(find "$DEST" -maxdepth 1 -type f \
               -name "${DB}-${label}-*.${suffix}" -mtime "+$KEEP_DAYS" 2>/dev/null)
  done
done

TOTAL=$(find "$DEST" -maxdepth 1 -type f \( -name "${DB}-*.sql.gz" -o -name "${DB}-*.sql.gz.gpg" \) | wc -l)
log "done — pruned $PRUNED, $TOTAL dump(s) held, keeping ${KEEP_DAYS}d of nightly/pre-deploy"
