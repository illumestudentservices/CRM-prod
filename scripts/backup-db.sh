#!/usr/bin/env bash
#
# Back up the production database — ENCRYPTED AT REST with a PUBLIC KEY.
#
#   backup-db.sh [label]      label defaults to "manual"
#
# Used three ways:
#   - nightly from cron            backup-db.sh nightly
#   - before every deploy          backup-db.sh pre-deploy   (see deploy.sh)
#   - by hand before a migration   backup-db.sh pre-042
#
# ── Why public-key, not a passphrase (2026-11-22) ────────────────────────────
#
# The dump holds passport numbers, home addresses and the whole database. It was
# first encrypted with a symmetric passphrase, but that passphrase had to live on
# the same box as the dumps — so a stolen disk/snapshot or a root compromise got
# both the ciphertext AND the key.
#
# Now the box holds only the backup PUBLIC key: it can LOCK a backup but cannot
# OPEN one. The matching PRIVATE key is kept OFF the server (password manager /
# offline). So even someone who fully owns this server, or walks off with a whole
# disk image, cannot decrypt the backups — only the holder of the private key
# can, with scripts/restore-backup.sh on their own machine.
#
# Recipient = $BACKUP_GPG_RECIPIENT (default "illume-backup"), a key that must be
# imported into root's GPG keyring. Encryption is REQUIRED and fail-closed: no
# recipient key, no backup (we never silently fall back to plaintext).
#
# ── Verify BEFORE encrypting ─────────────────────────────────────────────────
#
# The box cannot decrypt to check its own work, so the dump is verified while it
# is still plaintext (gzip integrity + the core tables are present), then
# encrypted. The transient plaintext .gz is mode 600, lives only for the few
# seconds between dump and encrypt, and is removed immediately (and on ANY exit
# via the trap) — the same plaintext that `pg_dump` already streams through the
# box every run.
#
# ── Two long-standing failure modes still guarded ────────────────────────────
# 1. A pipeline hides a failing pg_dump (its exit is the last stage's) — so every
#    stage's PIPESTATUS is checked and the finished file is verified before it
#    counts. 2. Pruning before the new dump succeeds empties the directory on a
#    bad night — nothing is deleted until the new file exists and is verified.
#
set -euo pipefail

DB=illume_crm
DEST=/root/db-backups
LABEL="${1:-manual}"
KEEP_DAYS=14
TS=$(date +%Y%m%d-%H%M%S)
OUT="$DEST/${DB}-${LABEL}-${TS}.sql.gz.gpg"
PART="$OUT.part"
GZ="$DEST/.${DB}-${LABEL}-${TS}.sql.gz.tmp"   # transient plaintext, 600, removed below
RECIPIENT="${BACKUP_GPG_RECIPIENT:-illume-backup}"

log()  { printf '[backup-db] %s\n' "$*"; }
die()  { printf '[backup-db] FAILED: %s\n' "$*" >&2; exit 1; }

# Half-written OR transient-plaintext files go on ANY exit, not just via die().
trap 'rm -f "$PART" "$GZ"' EXIT

command -v pg_dump >/dev/null || die "pg_dump not on PATH"
command -v gpg >/dev/null     || die "gpg not on PATH — needed to encrypt the backup"
# The recipient's public key must be in root's keyring, or we would write a dump
# we cannot protect. Fail rather than fall back to plaintext.
gpg --list-keys "$RECIPIENT" >/dev/null 2>&1 || die "backup public key '$RECIPIENT' not in the keyring — import it first (gpg --import)"
mkdir -p "$DEST"
umask 077   # the dump holds passport numbers and home addresses

# ── Dump → gzip → transient plaintext ────────────────────────────────────────
log "dumping $DB -> $(basename "$OUT")"
set +e
sudo -u postgres pg_dump "$DB" | gzip > "$GZ"
STATUS=("${PIPESTATUS[@]}")
set -e
[ "${STATUS[0]}" -eq 0 ] || die "pg_dump exited ${STATUS[0]}"
[ "${STATUS[1]}" -eq 0 ] || die "gzip exited ${STATUS[1]}"

# ── Verify the plaintext dump before we encrypt it ───────────────────────────
gzip -t "$GZ" 2>/dev/null || die "gzip integrity check failed"

# grep WITHOUT -q (must read the whole stream): `zcat | grep -q` SIGPIPEs zcat on
# first match and pipefail then reads a SUCCESSFUL match as a failed check.
CREATED=$(zcat "$GZ" | grep '^CREATE TABLE' || true)
TABLES=$(printf '%s\n' "$CREATED" | grep -c '^CREATE TABLE' || true)
[ "$TABLES" -gt 0 ] || die "no CREATE TABLE statements — the dump is empty"
for t in users employees leads leave_requests; do
  case "$CREATED" in
    *"CREATE TABLE public.$t "*) ;;
    *) die "table '$t' missing from the dump — wrong database?" ;;
  esac
done

GZSIZE=$(stat -c %s "$GZ")
[ "$GZSIZE" -gt 10240 ] || die "dump is only ${GZSIZE} bytes"

# ── Encrypt to the public key ────────────────────────────────────────────────
# --trust-model always: this is our own backup key, explicitly imported; we do
# not want an "untrusted recipient" prompt to block a non-interactive cron run.
gpg --encrypt --recipient "$RECIPIENT" --trust-model always --batch --yes -o "$PART" "$GZ" \
  || die "gpg encrypt failed for recipient '$RECIPIENT'"
rm -f "$GZ"   # drop the plaintext the instant it is encrypted (trap also covers it)

# Structural sanity on the ciphertext — no private key needed, just that it is a
# well-formed OpenPGP message and not truncated. NOTE: `gpg --list-packets` EXITS
# NON-ZERO on a public-only keyring (it tries, and fails, to find a secret key to
# open it) even for a perfectly good file — so we must NOT trust its exit code.
# It still PRINTS the packet list, so we check that instead.
PKTS=$(gpg --list-packets "$PART" 2>/dev/null || true)
case "$PKTS" in
  *"encrypted data packet"*) ;;
  *) die "encrypted file is not a valid OpenPGP message" ;;
esac

mv "$PART" "$OUT"
chmod 600 "$OUT"
log "ok — $(du -h "$OUT" | cut -f1), $TABLES tables, encrypted to '$RECIPIENT'"

# ── Prune, only now, and only our own ────────────────────────────────────────
# Both the encrypted dumps and any older plaintext .sql.gz (pre-encryption) age
# out. Hand-made historical dumps (pre-019, pre-redesign …) are not ours to delete.
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
