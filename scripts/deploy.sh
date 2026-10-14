#!/usr/bin/env bash
#
# Zero-downtime-ish deploy for the Illume CRM VPS.
#
# The problem this solves: running `next build` inside the directory the app
# is serving from rewrites .next over ~90 seconds. Next.js serves content-hashed
# chunks, so anyone with the app open during that window hits ChunkLoadError and
# a 500. That happened in production on 2026-07-27.
#
# Instead we build in a shadow copy while the live app keeps serving untouched,
# then swap .next in and reload. The window where the two can disagree drops
# from ~90s to well under a second.
#
# Usage:  deploy.sh [git-ref]     (defaults to origin/main)

set -euo pipefail

APP_DIR=/var/www/illume-crm
BUILD_DIR=/var/www/illume-crm-build
SERVICE=illume-crm
# The app runs as the unprivileged `illume` user under systemd. It used to
# run as root under PM2; a flaw in the app was a flaw in the whole machine.
APP_USER=illume
HEALTH_URL=http://localhost:3000
REF="${1:-origin/main}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$APP_DIR" ] || die "$APP_DIR not found"

# The app tree belongs to $APP_USER but this script runs as root, and git
# refuses to touch a repository owned by somebody else ("dubious ownership").
# Declared here rather than set by hand on the box, so a rebuilt server or a
# second environment does not fail on its first deploy.
for d in "$APP_DIR" "$BUILD_DIR"; do
  git config --global --get-all safe.directory 2>/dev/null | grep -qx "$d"     || git config --global --add safe.directory "$d"
done

# ── 1. Refresh the shadow checkout ────────────────────────────────────────────
log "Syncing source into shadow build dir"
if [ ! -d "$BUILD_DIR/.git" ]; then
  rm -rf "$BUILD_DIR"
  git clone --quiet "$APP_DIR" "$BUILD_DIR"
  git -C "$BUILD_DIR" remote set-url origin \
    "$(git -C "$APP_DIR" remote get-url origin)"
fi

git -C "$BUILD_DIR" fetch --quiet origin
git -C "$BUILD_DIR" reset --hard --quiet "$REF"
COMMIT=$(git -C "$BUILD_DIR" rev-parse --short HEAD)
SUBJECT=$(git -C "$BUILD_DIR" log -1 --pretty=%s)
log "Building $COMMIT — $SUBJECT"

# .env is deliberately untracked; the build needs it for NEXT_PUBLIC_* inlining
cp "$APP_DIR/.env" "$BUILD_DIR/.env"

# ── 2. Install + build, with the live app still serving ───────────────────────
cd "$BUILD_DIR"
if ! cmp -s "$BUILD_DIR/package-lock.json" "$APP_DIR/package-lock.json" \
   || [ ! -d "$BUILD_DIR/node_modules" ]; then
  log "Dependencies changed — installing"
  npm ci --no-audit --no-fund
fi

npx prisma generate >/dev/null
npm run build || die "build failed — live app untouched, nothing swapped"

[ -d "$BUILD_DIR/.next" ] || die "build produced no .next"

# ── 2b. Back up the database before anything is swapped ───────────────────────
#
# Here rather than at the top: a build that fails changes nothing, so there is
# nothing to roll back to and no reason to spend the time.
#
# The health check below can restore the previous .next, but it cannot undo a
# data change — and `git reset --hard` in the next step brings new source onto
# the live database. A failed deploy was recoverable; a deploy that wrote bad
# data was not.
#
# Fatal on failure, deliberately. "Deploy anyway, we have no backup" is the
# decision this script should not be allowed to make quietly.
#
# Run from BUILD_DIR, not APP_DIR, for two reasons: it is the version being
# deployed, and APP_DIR has not been updated yet at this point — so on the very
# first deploy carrying this change APP_DIR has no backup-db.sh at all and the
# deploy would abort on its own new safety check.
log "Backing up the database"
"$BUILD_DIR/scripts/backup-db.sh" pre-deploy || die "backup failed — nothing deployed"

# ── 3. Swap the build in ──────────────────────────────────────────────────────
log "Swapping build into place"
rm -rf "$APP_DIR/.next.prev"
[ -d "$APP_DIR/.next" ] && mv "$APP_DIR/.next" "$APP_DIR/.next.prev"
cp -a "$BUILD_DIR/.next" "$APP_DIR/.next"

# Source files must match the build that references them
git -C "$APP_DIR" fetch --quiet origin
git -C "$APP_DIR" reset --hard --quiet "$REF"
# node_modules only needs refreshing when the lockfile moved
if ! cmp -s "$BUILD_DIR/package-lock.json" "$APP_DIR/package-lock.json"; then
  cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund
fi
cd "$APP_DIR" && npx prisma generate >/dev/null

# Everything above ran as root, so the files are root-owned again. The
# service runs as $APP_USER and would fail to read its own build.
log "Returning ownership to $APP_USER"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

log "Restarting $SERVICE"
systemctl restart "$SERVICE"

# ── 4. Health check, roll back if it doesn't come up ──────────────────────────
log "Health check"
OK=0
for i in $(seq 1 20); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || echo 000)
  case "$CODE" in
    200|301|302|307|308) OK=1; break ;;
  esac
  sleep 1
done

if [ "$OK" -ne 1 ]; then
  printf '\033[1;31mHealth check failed (last: %s) — rolling back\033[0m\n' "${CODE:-none}"
  if [ -d "$APP_DIR/.next.prev" ]; then
    rm -rf "$APP_DIR/.next"
    mv "$APP_DIR/.next.prev" "$APP_DIR/.next"
    chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
    systemctl restart "$SERVICE"
    die "rolled back to previous build"
  fi
  die "no previous build to roll back to"
fi

rm -rf "$APP_DIR/.next.prev"
printf '\n\033[1;32m==> Deployed %s (%s) — HTTP %s\033[0m\n\n' "$COMMIT" "$SUBJECT" "$CODE"
