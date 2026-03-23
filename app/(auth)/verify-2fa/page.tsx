"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import { Loader2, ShieldCheck, AlertCircle, KeyRound } from "lucide-react";

export default function Verify2FAPage() {
  const { data: session, update } = useSession();
  const router = useRouter();

  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedBackupCode, setUsedBackupCode] = useState(false);
  const [codesRemaining, setCodesRemaining] = useState<number | null>(null);

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

  // If 2FA is no longer pending (update() cleared it), redirect
  useEffect(() => {
    if (session && !session.user.twoFactorPending) {
      router.replace("/dashboard");
    }
  }, [session, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.replace(/\D/g, "").trim() || code.trim() }),
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

      // Tell NextAuth to clear twoFactorPending from the JWT
      await update({ twoFactorVerified: true });
      // useEffect above will redirect once session updates
    } catch {
      setError("Unable to verify. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  const isBackupCode = code.replace(/\d/g, "").length > 0 || code.length > 6;

  return (
    <div ref={cardRef} style={{ opacity: 0 }}>
      <div className="mb-7 flex flex-col items-center text-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "rgba(59,130,246,0.15)", border: "1.5px solid rgba(59,130,246,0.25)" }}
        >
          <ShieldCheck className="h-7 w-7 text-blue-400" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-1">Two-factor authentication</h1>
        <p className="text-sm text-white/40">
          Open Microsoft Authenticator and enter the 6-digit code for{" "}
          <span className="text-white/60">Illume CRM</span>
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
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
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
            Can&apos;t access your authenticator?{" "}
            <button
              type="button"
              className="text-blue-400/70 hover:text-blue-300 transition-colors underline underline-offset-2"
              onClick={() => { setCode(""); inputRef.current?.focus(); }}
            >
              Use a backup code
            </button>
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
