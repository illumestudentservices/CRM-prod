"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ShieldAlert, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Surfaces the signed-in user's 2FA state inside Settings → Security.
 *
 * The enrolment flow itself lives on /account (it needs the QR + backup codes),
 * but Security is where people go looking for it, so we mirror the status here
 * and link across rather than leaving a dead end.
 */
export function MfaStatusCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/2fa/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEnabled(d?.enabled ?? false))
      .catch(() => setEnabled(false));
  }, []);

  return (
    <div className="border rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          {enabled ? (
            <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
            </div>
          ) : (
            <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              Two-Factor Authentication
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 max-w-md">
              {enabled === null
                ? "Checking your account…"
                : enabled
                ? "Your account requires a code from your authenticator app at every sign-in."
                : "Your account is protected by password only. Enable 2FA for stronger security."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {enabled !== null && (
            <span
              className={`text-xs px-2 py-1 rounded-full font-medium ${
                enabled
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {enabled ? "Enabled" : "Disabled"}
            </span>
          )}
          <Button asChild size="sm" variant={enabled ? "outline" : "default"}
            className={enabled ? "" : "bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"}>
            <Link href="/account">
              {enabled ? "Manage" : "Set up 2FA"}
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
