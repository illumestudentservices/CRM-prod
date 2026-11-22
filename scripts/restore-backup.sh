#!/usr/bin/env bash
#
# Restore / open an encrypted database backup written by backup-db.sh.
#
#   restore-backup.sh <file.sql.gz.gpg>            # decrypted SQL to stdout
#   restore-backup.sh <file.sql.gz.gpg> --verify   # decrypt + check, write nothing
#
# Examples:
#   # Drill: prove the newest nightly can be opened with the stored passphrase
#   restore-backup.sh "$(ls -t /root/db-backups/illume_crm-nightly-*.sql.gz.gpg | head -1)" --verify
#
#   # Actually restore into a database (DANGEROUS — overwrites it):
#   restore-backup.sh /root/db-backups/illume_crm-nightly-....sql.gz.gpg | sudo -u postgres psql -d illume_crm_restore_test
#
# The passphrase comes from $BACKUP_PASSPHRASE_FILE (default
# /root/.illume-backup-passphrase), the same file backup-db.sh uses. This script
# never writes to any database itself — piping the output into psql is a
# deliberate, separate step.
#
set -euo pipefail

FILE="${1:-}"
MODE="${2:-}"
PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-/root/.illume-backup-passphrase}"

die() { printf '[restore-backup] FAILED: %s\n' "$*" >&2; exit 1; }

[ -n "$FILE" ]            || die "usage: restore-backup.sh <file.sql.gz.gpg> [--verify]"
[ -r "$FILE" ]           || die "backup file not readable: $FILE"
command -v gpg >/dev/null || die "gpg not on PATH"
[ -r "$PASSPHRASE_FILE" ] || die "passphrase file not readable at $PASSPHRASE_FILE"

gpg_dec() { gpg --quiet --batch --yes --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" --decrypt "$FILE" 2>/dev/null; }

if [ "$MODE" = "--verify" ]; then
  # Decrypt + gunzip-integrity + confirm it carries the core tables. Writes
  # nothing anywhere — a safe restore drill.
  gpg_dec | gzip -t 2>/dev/null || die "decrypt + gzip integrity failed (bad passphrase or corrupt file)"
  CREATED=$(gpg_dec | zcat | grep '^CREATE TABLE' || true)
  TABLES=$(printf '%s\n' "$CREATED" | grep -c '^CREATE TABLE' || true)
  [ "$TABLES" -gt 0 ] || die "no CREATE TABLE statements — the dump is empty"
  for t in users employees leads leave_requests; do
    case "$CREATED" in
      *"CREATE TABLE public.$t "*) ;;
      *) die "core table '$t' missing — wrong database or corrupt dump?" ;;
    esac
  done
  printf '[restore-backup] OK — %s decrypts cleanly, %s tables present\n' "$(basename "$FILE")" "$TABLES" >&2
  exit 0
fi

# Default: stream the decrypted, decompressed SQL to stdout.
gpg_dec | zcat
