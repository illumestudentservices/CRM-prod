#!/usr/bin/env bash
#
# Zero-downtime-ish deploy for the Illume CRM VPS.
#
# The problem this solves: running `next build` inside the directory PM2 is
# serving from rewrites .next over ~90 seconds. Next.js serves content-hashed
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
PM2_APP=illume-crm
HEALTH_URL=http://localhost:3000
REF="${1:-origin/main}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$APP_DIR" ] || die "$APP_DIR not found"

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

log "Reloading $PM2_APP"
pm2 reload "$PM2_APP" --update-env >/dev/null 2>&1 || pm2 restart "$PM2_APP" >/dev/null

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
    pm2 restart "$PM2_APP" >/dev/null
    die "rolled back to previous build"
  fi
  die "no previous build to roll back to"
fi

rm -rf "$APP_DIR/.next.prev"
printf '\n\033[1;32m==> Deployed %s (%s) — HTTP %s\033[0m\n\n' "$COMMIT" "$SUBJECT" "$CODE"
