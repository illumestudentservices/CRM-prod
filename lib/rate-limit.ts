/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * Process-local on purpose: the app runs as a single Node process under systemd,
 * so one shared map is enough to blunt request-frequency abuse (reset-email
 * bombing, email-quota drain). It resets on restart/deploy — an acceptable
 * trade for needing no datastore, given the per-account lockout and the
 * nginx rate-limit + fail2ban layer cover sustained attacks.
 *
 * Not a general authz control: use it only to cap how often an unauthenticated
 * action may be taken.
 */
const buckets = new Map<string, number[]>();
let lastPrune = 0;

/** Returns true if the request is ALLOWED, false if the limit is exceeded. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    maybePrune(now);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  maybePrune(now);
  return true;
}

function maybePrune(now: number): void {
  if (now - lastPrune < 5 * 60 * 1000) return;
  lastPrune = now;
  const horizon = now - 60 * 60 * 1000;
  for (const [k, arr] of buckets) {
    const kept = arr.filter((t) => t > horizon);
    if (kept.length === 0) buckets.delete(k);
    else buckets.set(k, kept);
  }
}

/** Best-effort client IP from proxy headers (nginx sets both here). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
