"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Eye, EyeOff, ShieldCheck, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RULES = [
  { label: "At least 12 characters", test: (p: string) => p.length >= 12 },
  { label: "Uppercase letter (A-Z)", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter (a-z)", test: (p: string) => /[a-z]/.test(p) },
  { label: "Number (0-9)", test: (p: string) => /[0-9]/.test(p) },
  { label: "Special character (!@#$%...)", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

type TokenStatus = "loading" | "valid" | "invalid" | "used" | "expired";

export default function ResetPasswordPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [tokenStatus, setTokenStatus] = useState<TokenStatus>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/auth/verify-reset-token?token=${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.valid) setTokenStatus("valid");
        else if (d.reason === "used") setTokenStatus("used");
        else if (d.reason === "expired") setTokenStatus("expired");
        else setTokenStatus("invalid");
      })
      .catch(() => setTokenStatus("invalid"));
  }, [token]);

  const allRulesMet = RULES.every((r) => r.test(password));
  const passwordsMatch = password === confirm && confirm.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allRulesMet || !passwordsMatch) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify-reset-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 3000);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#1E3A5F] to-[#0369A1] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-lg leading-none">Illume</div>
            <div className="text-white/50 text-[9px] tracking-[2.5px] uppercase">Student Advisory Services</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {tokenStatus === "loading" && (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-[#1E3A5F] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-slate-500">Validating your link…</p>
            </div>
          )}

          {(tokenStatus === "invalid" || tokenStatus === "used" || tokenStatus === "expired") && (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-7 h-7 text-red-600" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">
                {tokenStatus === "used" ? "Link Already Used" : tokenStatus === "expired" ? "Link Expired" : "Invalid Link"}
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                {tokenStatus === "used"
                  ? "This password reset link has already been used."
                  : tokenStatus === "expired"
                  ? "This link has expired. Request a new password reset from your administrator."
                  : "This link is invalid or doesn't exist."}
              </p>
              <Button variant="outline" onClick={() => router.push("/login")}>Back to Login</Button>
            </div>
          )}

          {tokenStatus === "valid" && !done && (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">Set Your Password</h2>
                <p className="text-sm text-slate-500 mt-1">Choose a strong password for your Illume account.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">New Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-10"
                      placeholder="Create a strong password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm Password</Label>
                  <Input
                    id="confirm"
                    type={showPassword ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={confirm && !passwordsMatch ? "border-red-400" : ""}
                    placeholder="Repeat your password"
                    autoComplete="new-password"
                  />
                  {confirm && !passwordsMatch && (
                    <p className="text-xs text-red-500">Passwords do not match</p>
                  )}
                </div>

                {/* Complexity rules */}
                {password.length > 0 && (
                  <div className="bg-slate-50 rounded-lg p-3 space-y-1.5">
                    {RULES.map((rule) => (
                      <div key={rule.label} className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${rule.test(password) ? "bg-emerald-100" : "bg-slate-200"}`}>
                          {rule.test(password)
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            : <XCircle className="w-3.5 h-3.5 text-slate-400" />
                          }
                        </div>
                        <span className={`text-xs ${rule.test(password) ? "text-emerald-700" : "text-slate-500"}`}>
                          {rule.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
                )}

                <Button
                  type="submit"
                  className="w-full bg-[#1E3A5F] hover:bg-[#162d4a]"
                  disabled={submitting || !allRulesMet || !passwordsMatch}
                >
                  {submitting ? "Setting Password…" : "Set Password & Sign In"}
                </Button>
              </form>
            </>
          )}

          {done && (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7 text-emerald-600" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Password Set!</h2>
              <p className="text-sm text-slate-500">Redirecting you to the login page…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
