#!/usr/bin/env bash
#
# Restore / open a public-key-encrypted database backup from backup-db.sh.
#
#   restore-backup.sh <file.sql.gz.gpg>            # decrypted SQL to stdout
#   restore-backup.sh <file.sql.gz.gpg> --verify   # decrypt + check, write nothing
#
# IMPORTANT: run this on the machine that holds the backup PRIVATE key (your
# laptop / wherever you imported it) — NOT on the server, which only has the
# public key and cannot decrypt. Copy the backup file over first.
#
# Examples:
#   # Drill: prove a backup opens with your private key, change nothing
#   restore-backup.sh illume_crm-nightly-....sql.gz.gpg --verify
#
#   # Actually restore into a database (DANGEROUS — overwrites it):
#   restore-backup.sh illume_crm-nightly-....sql.gz.gpg | psql -d illume_crm_restore_test
#
# gpg uses your default keyring; set GNUPGHOME to point at a different one.
#
set -euo pipefail

FILE="${1:-}"
MODE="${2:-}"

die() { printf '[restore-backup] FAILED: %s\n' "$*" >&2; exit 1; }

[ -n "$FILE" ]            || die "usage: restore-backup.sh <file.sql.gz.gpg> [--verify]"
[ -r "$FILE" ]           || die "backup file not readable: $FILE"
command -v gpg >/dev/null || die "gpg not on PATH"

# Decrypt with whatever private key in the keyring matches the message. If the
# private key isn't here, gpg fails with 'no secret key' — which is the whole
# point of keeping it off the server.
gpg_dec() { gpg --quiet --batch --yes --decrypt "$FILE" 2>/dev/null; }

if [ "$MODE" = "--verify" ]; then
  gpg_dec | gzip -t 2>/dev/null || die "decrypt + gzip integrity failed (missing private key or corrupt file)"
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
