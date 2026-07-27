"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Shield, ShieldOff, ShieldCheck, Copy, RefreshCw, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

type Step = "idle" | "setup-qr" | "setup-verify" | "setup-done" | "disable-confirm";

export default function AccountPage() {
  const { data: session } = useSession();
  const { toast } = useToast();

  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [loading, setLoading] = useState(false);

  // Setup state
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  // Disable state
  const [disableCode, setDisableCode] = useState("");

  const load2FAStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/2fa/status");
      if (!res.ok) return;
      const data = await res.json();
      setTwoFactorEnabled(data.enabled);
    } catch {
      setTwoFactorEnabled(false);
    }
  }, []);

  useEffect(() => { load2FAStatus(); }, [load2FAStatus]);

  async function startSetup() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSecret(data.secret);
      setQrDataUrl(data.qrDataUrl);
      setStep("setup-qr");
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to generate QR", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function confirmSetup() {
    if (setupCode.length !== 6) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, code: setupCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBackupCodes(data.backupCodes);
      setTwoFactorEnabled(true);
      setStep("setup-done");
      toast({ title: "Two-factor authentication enabled!" });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Verification failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function confirmDisable() {
    if (disableCode.length !== 6) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disableCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTwoFactorEnabled(false);
      setStep("idle");
      setDisableCode("");
      toast({ title: "Two-factor authentication disabled" });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to disable 2FA", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function copyBackupCodes() {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    toast({ title: "Backup codes copied to clipboard" });
  }

  const user = session?.user;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your profile and security settings</p>
      </div>

      {/* Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          {user?.image ? (
            <Image src={user.image} alt={user.name ?? ""} width={48} height={48} className="rounded-full" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-lg font-bold text-muted-foreground">
              {user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div>
            <p className="font-semibold">{user?.name ?? "—"}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
            <Badge variant="secondary" className="mt-1 text-xs">{user?.role?.replace(/_/g, " ")}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* 2FA Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Two-Factor Authentication
              </CardTitle>
              <CardDescription className="mt-1">
                Required on all accounts. Uses Microsoft Authenticator or any TOTP app.
              </CardDescription>
            </div>
            {twoFactorEnabled !== null && (
              <Badge
                variant={twoFactorEnabled ? "default" : "secondary"}
                className={twoFactorEnabled ? "bg-emerald-100 text-emerald-800 border-emerald-200" : ""}
              >
                {twoFactorEnabled ? "Enabled" : "Disabled"}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">

          {/* ── Idle / status ── */}
          {step === "idle" && (
            <>
              {twoFactorEnabled === null && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading status…
                </div>
              )}
              {twoFactorEnabled === false && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-amber-800">
                      Your account is protected by password only. Enable 2FA for stronger security.
                    </p>
                  </div>
                  <Button onClick={startSetup} disabled={loading} className="gap-2">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Set up two-factor authentication
                  </Button>
                </div>
              )}
              {twoFactorEnabled === true && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    <p className="text-emerald-800">
                      2FA is active. You&apos;ll be prompted for a code from your authenticator app each time you sign in.
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    2FA is mandatory for all accounts and can&apos;t be turned off.
                    If you&apos;ve lost access to your authenticator, ask a system
                    administrator to reset it for you.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ── Step 1: QR code ── */}
          {step === "setup-qr" && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Step 1 — Scan the QR code</p>
                <p>Open <strong>Microsoft Authenticator</strong>, tap <strong>+</strong>, choose <strong>Other account</strong>, and scan:</p>
              </div>

              {qrDataUrl && (
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="2FA QR code" className="rounded-lg border p-2 bg-white" width={220} height={220} />
                </div>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Can&apos;t scan? Enter the key manually
                </summary>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 bg-muted rounded px-2 py-1.5 font-mono text-xs break-all">{secret}</code>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                    onClick={() => { navigator.clipboard.writeText(secret); toast({ title: "Secret copied" }); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </details>

              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={() => setStep("idle")} disabled={loading}>Cancel</Button>
                <Button onClick={() => setStep("setup-verify")} className="flex-1">Next — Enter code</Button>
              </div>
            </div>
          )}

          {/* ── Step 2: Verify first code ── */}
          {step === "setup-verify" && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Step 2 — Verify your code</p>
                <p>Enter the 6-digit code shown in Microsoft Authenticator to confirm setup:</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Authentication code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={setupCode}
                  onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                  className="w-full rounded-md border px-3 py-2 text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep("setup-qr")} disabled={loading}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Back
                </Button>
                <Button
                  onClick={confirmSetup}
                  disabled={loading || setupCode.length !== 6}
                  className="flex-1 gap-2"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Enable 2FA
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Show backup codes ── */}
          {step === "setup-done" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-900">Save your backup codes now</p>
                  <p className="text-amber-800 mt-0.5">
                    These codes let you sign in if you lose access to your authenticator.
                    Each code can only be used once. Store them somewhere safe.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-muted rounded-lg p-3">
                {backupCodes.map((c) => (
                  <code key={c} className="text-sm font-mono text-center py-1">{c}</code>
                ))}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={copyBackupCodes} className="gap-2">
                  <Copy className="h-4 w-4" /> Copy all
                </Button>
                <Button onClick={() => { setStep("idle"); setBackupCodes([]); setSetupCode(""); }} className="flex-1">
                  Done
                </Button>
              </div>
            </div>
          )}

          {/* ── Disable confirmation ── */}
          {step === "disable-confirm" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
                <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <p className="text-red-800">
                  Disabling 2FA will remove the extra security layer from your account.
                  Enter your current authentication code to confirm.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Current authentication code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                  className="w-full rounded-md border px-3 py-2 text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setStep("idle"); setDisableCode(""); }} disabled={loading}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={confirmDisable}
                  disabled={loading || disableCode.length !== 6}
                  className="flex-1 gap-2"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
                  Disable 2FA
                </Button>
              </div>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
