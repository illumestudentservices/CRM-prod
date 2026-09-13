"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import { Loader2, ShieldCheck, AlertCircle, KeyRound } from "lucide-react";
import { MfaUnlockOverlay } from "@/components/shared/mfa-unlock-overlay";

export default function Verify2FAPage() {
  const { data: session, update } = useSession();
  const router = useRouter();

  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedBackupCode, setUsedBackupCode] = useState(false);
  const [codesRemaining, setCodesRemaining] = useState<number | null>(null);
  const [welcomeName, setWelcomeName] = useState<string | null>(null);
  // Explicit, because the field has to behave differently: backup codes are
  // hex with a hyphen, so a numeric keypad cannot type them.
  const [backupMode, setBackupMode] = useState(false);

  // Which factor this account is actually on. Null until the server says, and
  // the screen stays deliberately neutral until then — telling somebody to
  // "open your authenticator" when they do not have one is the exact confusion
  // the email method exists to remove.
  const [method, setMethod] = useState<"TOTP" | "EMAIL" | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    gsap.fromTo(
      [cardRef.current],
      { y: 22, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.5, ease: "power3.out", delay: 0.2 }
    );
    inputRef.current?.focus();
  }, []);

  // Someone landing here with nothing to verify — e.g. a stale tab — gets moved
  // on. Skipped while the greeting is playing, since that clears the pending
  // flag itself and would otherwise cut the overlay short.
  useEffect(() => {
    if (welcomeName) return;
    if (session && !session.user.twoFactorPending) {
      router.replace("/dashboard");
    }
  }, [session, router, welcomeName]);

  /**
   * Asks the server which factor this account is on, and — for EMAIL — sends
   * the code in the same round trip.
   *
   * `isResend` exists so the first automatic call cannot show "code sent",
   * which on a page the user did not ask to load reads as an alarm.
   */
  const requestCode = useCallback(async (isResend: boolean) => {
    setIsSending(true);
    if (isResend) { setError(null); setNotice(null); }
    try {
      const res = await fetch("/api/auth/2fa/email-otp", { method: "POST" });
      const data = await res.json();

      if (data.method) setMethod(data.method === "NONE" ? null : data.method);
      if (data.sentTo) setSentTo(data.sentTo);

      if (!res.ok) {
        if (typeof data.retryAfterSeconds === "number") setResendIn(data.retryAfterSeconds);
        setError(data.error ?? "Could not send your code.");
        return;
      }
      if (data.method === "EMAIL") {
        setResendIn(60);
        if (isResend) setNotice("A new code is on its way.");
      }
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setIsSending(false);
    }
  }, []);

  // One call on mount. An account on TOTP gets its method back and no email is
  // sent, so this costs a TOTP user one request and nothing else.
  useEffect(() => { void requestCode(false); }, [requestCode]);

  // Resend countdown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send what the user typed. Stripping non-digits here silently
        // destroyed backup codes, which are hex — "3A7F2-9C1E4" arrived as
        // "372914" and could never match. The route already normalises
        // whitespace and case for both code types.
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        gsap.fromTo(
          btnRef.current,
          { x: 0 },
          { x: 6, duration: 0.07, ease: "power2.inOut", yoyo: true, repeat: 5,
            onComplete: () => { gsap.set(btnRef.current, { x: 0 }); } }
        );
        setError(data.error ?? "Invalid code. Please try again.");
        return;
      }

      if (data.usedBackupCode) {
        setUsedBackupCode(true);
        setCodesRemaining(data.codesRemaining ?? null);
      }

      // Clear twoFactorPending from the JWT, then greet — this is the point the
      // sign-in is actually complete. The overlay navigates when it finishes.
      await update({ twoFactorVerified: true });
      setWelcomeName(session?.user?.name ?? "there");
    } catch {
      setError("Unable to verify. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  // Also detect a pasted backup code from someone who never hit the toggle.
  const isBackupCode = backupMode || /[A-Za-z-]/.test(code) || code.length > 6;

  return (
    <div ref={cardRef} style={{ opacity: 0 }}>
      {welcomeName && (
        <MfaUnlockOverlay
          name={welcomeName}
          onComplete={() => { router.replace("/dashboard"); router.refresh(); }}
        />
      )}

      <div className="mb-7 flex flex-col items-center text-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "rgba(59,130,246,0.15)", border: "1.5px solid rgba(59,130,246,0.25)" }}
        >
          <ShieldCheck className="h-7 w-7 text-blue-400" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-1">Two-factor authentication</h1>
        <p className="text-sm text-white/40">
          {method === "EMAIL" ? (
            <>
              We&apos;ve emailed a 6-digit code to{" "}
              <span className="text-white/60">{sentTo ?? "your inbox"}</span>
            </>
          ) : method === "TOTP" ? (
            <>
              Open Microsoft Authenticator and enter the 6-digit code for{" "}
              <span className="text-white/60">Illume CRM</span>
            </>
          ) : (
            // Neutral until the server answers. Naming the wrong factor here and
            // correcting it a moment later is worse than saying nothing.
            <>Enter your 6-digit code to continue</>
          )}
        </p>
      </div>

      {error && (
        <div
          className="mb-5 flex items-start gap-3 rounded-lg px-4 py-3"
          style={{
            background: "rgba(239,68,68,0.12)",
            border: "1.5px solid rgba(239,68,68,0.30)",
          }}
        >
          <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {notice && (
        <div
          className="mb-5 flex items-start gap-3 rounded-lg px-4 py-3"
          style={{
            background: "rgba(16,185,129,0.12)",
            border: "1.5px solid rgba(16,185,129,0.30)",
          }}
        >
          <ShieldCheck className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
          <p className="text-sm text-emerald-300">{notice}</p>
        </div>
      )}

      {usedBackupCode && (
        <div
          className="mb-5 flex items-start gap-3 rounded-lg px-4 py-3"
          style={{
            background: "rgba(245,158,11,0.12)",
            border: "1.5px solid rgba(245,158,11,0.30)",
          }}
        >
          <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-amber-300 font-medium">Backup code used</p>
            {codesRemaining !== null && (
              <p className="text-xs text-amber-400/80 mt-0.5">
                {codesRemaining} backup code{codesRemaining !== 1 ? "s" : ""} remaining.
                Consider generating new ones in Account Settings.
              </p>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-white/60">
            {isBackupCode ? "Backup code" : "Authentication code"}
          </label>
          <div className="relative">
            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              inputMode={isBackupCode ? "text" : "numeric"}
              autoCapitalize={isBackupCode ? "characters" : "off"}
              autoComplete="one-time-code"
              placeholder={isBackupCode ? "XXXXX-XXXXX" : "000000"}
              maxLength={20}
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(null); }}
              disabled={isLoading}
              className={[
                "w-full rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-white/25",
                "bg-white/5 border border-white/10 tracking-widest text-center font-mono text-base",
                "focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20",
                "transition-colors duration-200 disabled:opacity-50",
                error ? "border-red-500/50 focus:border-red-500/60 focus:ring-red-500/20" : "",
              ].join(" ")}
            />
          </div>
          <p className="text-xs text-white/30">
            {isBackupCode ? (
              <>
                Enter one of the backup codes saved when you set up
                authentication.{" "}
                <button
                  type="button"
                  className="text-blue-400/70 hover:text-blue-300 transition-colors underline underline-offset-2"
                  onClick={() => {
                    setBackupMode(false);
                    setCode("");
                    setError(null);
                    inputRef.current?.focus();
                  }}
                >
                  {method === "EMAIL" ? "Use the emailed code instead" : "Use your authenticator instead"}
                </button>
              </>
            ) : (
              <>
                {method === "EMAIL" ? "Didn't get it?" : "Can't access your authenticator?"}{" "}
                {method === "EMAIL" && (
                  <>
                    <button
                      type="button"
                      disabled={resendIn > 0 || isSending}
                      className="text-blue-400/70 hover:text-blue-300 transition-colors underline underline-offset-2 disabled:no-underline disabled:text-white/25 disabled:cursor-not-allowed"
                      onClick={() => void requestCode(true)}
                    >
                      {resendIn > 0 ? `Resend in ${resendIn}s` : "Send a new code"}
                    </button>
                    {" · "}
                  </>
                )}
                <button
                  type="button"
                  className="text-blue-400/70 hover:text-blue-300 transition-colors underline underline-offset-2"
                  onClick={() => {
                    setBackupMode(true);
                    setCode("");
                    setError(null);
                    inputRef.current?.focus();
                  }}
                >
                  Use a backup code
                </button>
              </>
            )}
          </p>
        </div>

        <button
          ref={btnRef}
          type="submit"
          disabled={isLoading || !code.trim()}
          className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
          style={{
            background: isLoading
              ? "rgba(59,130,246,0.35)"
              : "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)",
            boxShadow: "0 0 24px rgba(59,130,246,0.35), 0 2px 8px rgba(0,0,0,0.4)",
          }}
        >
          {isLoading ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Verifying...</>
          ) : (
            "Verify"
          )}
        </button>
      </form>

      <div
        className="mt-6 pt-5"
        style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}
      >
        <p className="text-xs text-white/30 text-center">
          Having trouble?{" "}
          <a
            href="mailto:it@illumestudentservices.ca"
            className="text-blue-400/70 hover:text-blue-300 transition-colors underline underline-offset-2"
          >
            Contact IT support
          </a>
        </p>
      </div>
    </div>
  );
}
