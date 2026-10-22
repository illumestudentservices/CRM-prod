/**
 * The single rule for lifting a login's second-factor gate.
 *
 * A pending login may become fully authenticated ONLY on server-side proof:
 * the 2FA-verify route writes `stampedSid` onto the user row — equal to this
 * token's `sid` — after a real authenticator/email/backup code passes. The JWT
 * callback calls this function and clears `twoFactorPending` only when it
 * returns true, so a forged `update({ twoFactorVerified: true })` carrying no
 * matching stamp can never clear the gate.
 *
 * Kept pure and dependency-free so it can be unit-tested directly and so the
 * production path and the test exercise the exact same decision.
 */
export function mfaProofSatisfied(
  tokenSid: string | undefined,
  pending: boolean | undefined,
  stampedSid: string | null | undefined,
): boolean {
  if (!pending) return false; // not gated — nothing to lift
  if (!tokenSid) return false; // token predates this mechanism — re-authenticate
  if (!stampedSid) return false; // no proof was recorded for anyone
  return stampedSid === tokenSid; // the proof must belong to THIS session
}
