"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Eye, EyeOff, ShieldCheck, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MAX_AGE_DAYS, PASSWORD_HISTORY_DEPTH } from "@/lib/password";

const RULES = [
  { label: "At least 12 characters", test: (p: string) => p.length >= 12 },
  { label: "Uppercase letter (A-Z)", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter (a-z)", test: (p: string) => /[a-z]/.test(p) },
  { label: "Number (0-9)", test: (p: string) => /[0-9]/.test(p) },
  { label: "Special character (!@#$%...)", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export default function ChangePasswordPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Two different reasons to be here, and they need different forms. A forced
  // change on first login has no password the user chose, so asking for the
  // current one would be asking for a temp password they were emailed. An
  // expiry is a rotation of a password they know, and re-entering it stops a
  // hijacked session from silently changing the credentials.
  // mustChangePassword is set only for an admin-issued temporary password.
  // Anyone else landing here was sent by the rotation policy. Deriving it from
  // the session rather than a query param keeps the page statically
  // renderable — useSearchParams would force a Suspense boundary — and stops
  // the form being weakened by editing the URL.
  const isExpiry = !session?.user?.mustChangePassword;

  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  const allRulesMet = RULES.every((r) => r.test(password));
  const passwordsMatch = password === confirm && confirm.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allRulesMet || !passwordsMatch) return;
    if (isExpiry && !currentPassword) {
      setError("Enter your current password.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isExpiry ? { currentPassword, newPassword: password } : { newPassword: password }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      // Sign out so the new session won't have mustChangePassword=true
      await signOut({ callbackUrl: "/login?changed=1" });
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#1E3A5F] to-[#0369A1] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
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
          <div className="mb-6">
            <div className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 mb-3">
              <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-xs font-semibold text-amber-700">Action Required</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              {isExpiry ? "Time to Update Your Password" : "Set a New Password"}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {session?.user?.name ? `Hi ${session.user.name.split(" ")[0]}, ` : ""}
              {isExpiry
                ? `passwords are changed every ${PASSWORD_MAX_AGE_DAYS} days. Choose a new one to continue — it can't be one of your last ${PASSWORD_HISTORY_DEPTH}.`
                : "your account requires a password change before you can continue."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isExpiry && (
              <div className="space-y-1.5">
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Your existing password"
                  autoComplete="current-password"
                />
              </div>
            )}

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
              {submitting ? "Saving…" : "Set Password & Continue"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
