"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";

const inputClass = [
  "w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/25",
  "bg-white/5 border border-white/10",
  "focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20",
  "transition-colors duration-200",
  "disabled:opacity-50",
].join(" ");

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // Always show success — never reveal whether the email exists
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {submitted ? (
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Check your email</h1>
          <p className="text-sm text-white/50 leading-relaxed mb-1">
            If an account exists for{" "}
            <span className="text-white/70 font-medium">{email}</span>, a password
            reset link has been sent.
          </p>
          <p className="text-xs text-white/30 mt-3 mb-6">
            The link expires in 24 hours. Check your spam folder if you don&apos;t see it.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-7">
            <h1 className="text-xl font-semibold text-white mb-1">Reset your password</h1>
            <p className="text-sm text-white/40">
              Enter your email and we&apos;ll send a secure reset link.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-white/60">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25 pointer-events-none" />
                <input
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className={`${inputClass} pl-9`}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full mt-2 py-2.5 px-4 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)",
                boxShadow: "0 0 24px rgba(59,130,246,0.35), 0 2px 8px rgba(0,0,0,0.4)",
              }}
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        </>
      )}

      <div className="mt-6 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
