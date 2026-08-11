"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import Image from "next/image";
import {
  ShieldCheck, Loader2, Copy, Check, AlertTriangle, LogOut, ArrowRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MfaUnlockOverlay } from "@/components/shared/mfa-unlock-overlay";

/**
 * Mandatory 2FA enrolment.
 *
 * MFA is required for every role, so proxy.ts holds any signed-in user without
 * it here and blocks the rest of the app. There is deliberately no skip — the
 * only ways out are completing enrolment or signing out.
 */
export default function Setup2FAPage() {
  const router = useRouter();
  const { data: session, update } = useSession();
  const { toast } = useToast();
  const [welcomeName, setWelcomeName] = useState<string | null>(null);

  const [step, setStep] = useState<"intro" | "qr" | "done">("intro");
  const [loading, setLoading] = useState(false);
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [code, setCode] = useState("");
  // Spec pentest H-2 (2026-08-10) — enrolment requires the account
  // password to defend against stolen-session enrollment. Field is
  // collected here and posted to /api/auth/2fa/enable.
  const [currentPassword, setCurrentPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  async function startSetup() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate QR code");
      setSecret(data.secret);
      setQrDataUrl(data.qrDataUrl);
      setStep("qr");
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : "Failed to start setup",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    if (code.length !== 6) return;
    if (!currentPassword) {
      toast({ title: "Enter your account password to confirm.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, code, currentPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setBackupCodes(data.backupCodes ?? []);
      setStep("done");
      // Clear the password from memory as soon as it's been used.
      setCurrentPassword("");
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : "Verification failed",
        variant: "destructive",
      });
      setCode("");
      // Do NOT clear the password field here — user may only have typed
      // a wrong 6-digit code.
    } finally {
      setLoading(false);
    }
  }

  async function finish() {
    // Refresh the JWT so the proxy stops gating this session, then greet —
    // enrolment is the last step of a first sign-in.
    await update({ twoFactorEnrolled: true });
    setWelcomeName(session?.user?.name ?? "there");
  }

  function copyCodes() {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      {welcomeName && (
        <MfaUnlockOverlay
          name={welcomeName}
          onComplete={() => { router.push("/dashboard"); router.refresh(); }}
        />
      )}

      {/* Header */}
      <div className="mb-7">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="h-9 w-9 rounded-lg bg-blue-500/15 border border-blue-400/25 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-blue-400" />
          </div>
          <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-blue-400/70">
            Required
          </span>
        </div>
        <h1 className="text-xl font-semibold text-white mb-1">
          Set up two-factor authentication
        </h1>
        <p className="text-sm text-white/40">
          Your organisation requires 2FA on every account before you can sign in.
        </p>
      </div>

      {/* ── Step 1: intro ── */}
      {step === "intro" && (
        <div className="space-y-5">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4 space-y-3">
            {[
              ["1", "Install an authenticator", "Microsoft Authenticator, Google Authenticator, or any TOTP app."],
              ["2", "Scan a QR code", "We'll show you a code to scan with the app."],
              ["3", "Save your backup codes", "Use these if you ever lose your phone."],
            ].map(([n, title, desc]) => (
              <div key={n} className="flex gap-3">
                <div className="h-6 w-6 shrink-0 rounded-full bg-blue-500/15 border border-blue-400/25 flex items-center justify-center text-[11px] font-bold text-blue-400">
                  {n}
                </div>
                <div>
                  <p className="text-sm text-white/85 font-medium">{title}</p>
                  <p className="text-xs text-white/40 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={startSetup}
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)" }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Begin setup
          </button>
        </div>
      )}

      {/* ── Step 2: QR + verify ── */}
      {step === "qr" && (
        <div className="space-y-5">
          {qrDataUrl && (
            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-lg">
                <Image src={qrDataUrl} alt="2FA QR code" width={180} height={180} unoptimized />
              </div>
            </div>
          )}

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <p className="text-[11px] text-white/40 mb-1">
              Can&apos;t scan? Enter this key manually:
            </p>
            <code className="text-xs text-blue-300 font-mono break-all">{secret}</code>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-white/60">
              Enter the 6-digit code from your app
            </label>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-lg px-4 py-2.5 text-center text-lg tracking-[0.4em] font-mono text-white placeholder-white/20 bg-white/5 border border-white/10 focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {/* Spec pentest H-2 — confirm identity with the account password
              before enrolling. A stolen session cookie alone can't turn on
              attacker-controlled MFA. */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-white/60">
              Confirm with your account password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
              className="w-full rounded-lg px-4 py-2.5 text-white placeholder-white/20 bg-white/5 border border-white/10 focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <button
            onClick={confirm}
            disabled={code.length !== 6 || !currentPassword || loading}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)" }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Verify &amp; enable
          </button>
        </div>
      )}

      {/* ── Step 3: backup codes ── */}
      {step === "done" && (
        <div className="space-y-5">
          <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-3 flex items-start gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
            <p className="text-sm text-emerald-300">
              Two-factor authentication is now active on your account.
            </p>
          </div>

          {backupCodes.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-white/70">Backup codes</p>
                <button
                  onClick={copyCodes}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy all"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-3">
                {backupCodes.map((c) => (
                  <code key={c} className="text-xs font-mono text-white/80 text-center py-1">
                    {c}
                  </code>
                ))}
              </div>
              <div className="mt-3 rounded-lg border border-amber-400/25 bg-amber-500/10 p-3 flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-200/90">
                  Save these somewhere safe. Each one works once if you lose access to
                  your authenticator, and they won&apos;t be shown again.
                </p>
              </div>
            </div>
          )}

          <button
            onClick={finish}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)" }}
          >
            Continue to dashboard
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Sign out — the only way out other than enrolling */}
      <div className="mt-7 pt-5 border-t border-white/10 text-center">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-xs text-white/40 hover:text-white/70 transition-colors inline-flex items-center gap-1.5"
        >
          <LogOut className="h-3 w-3" />
          Sign out instead
        </button>
      </div>
    </div>
  );
}
