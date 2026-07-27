"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import { Loader2, Mail, Lock, Eye, EyeOff, AlertCircle, ShieldAlert, Clock } from "lucide-react";
import { getSession } from "next-auth/react";
import Link from "next/link";
import { WelcomeOverlay } from "@/components/shared/welcome-overlay";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required").min(6, "Password must be at least 6 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const inputClass = [
  "w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/25",
  "bg-white/5 border border-white/10",
  "focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20",
  "transition-colors duration-200",
  "disabled:opacity-50",
].join(" ");

const inputErrorClass = "border-red-500/50 focus:border-red-500/60 focus:ring-red-500/20";

function useCountdown(targetDate: Date | null): number {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!targetDate) { setRemaining(0); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((targetDate.getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetDate]);
  return remaining;
}

function fmtCountdown(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [welcomeName, setWelcomeName] = useState<string | null>(null);
  // Until React hydrates, the form would submit natively. The form is POST so
  // credentials never reach the URL, but we also hold the button until the JS
  // handler is live so submits always go through signIn().
  const [hydrated, setHydrated] = useState(false);

  // Simple error state
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);

  const headingRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema) as never,
    defaultValues: { email: "", password: "" },
  });

  const countdown = useCountdown(lockedUntil);
  const isLocked = lockedUntil !== null && countdown > 0;

  // Auto-clear lock when countdown hits 0
  useEffect(() => {
    if (lockedUntil && countdown === 0) setLockedUntil(null);
  }, [countdown, lockedUntil]);

  useEffect(() => { setHydrated(true); }, []);

  // Staggered entry animation
  useEffect(() => {
    const els = [headingRef.current, emailRef.current, passwordRef.current, btnRef.current, footerRef.current];
    gsap.fromTo(els, { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.08, ease: "power3.out", delay: 0.55 });
    const glowTween = gsap.to(btnRef.current, {
      boxShadow: "0 0 42px rgba(59,130,246,0.6), 0 2px 10px rgba(0,0,0,0.5)",
      duration: 1.4, repeat: -1, yoyo: true, ease: "sine.inOut", delay: 1.2,
    });
    return () => { glowTween.kill(); };
  }, []);

  const handleBtnEnter = () => { if (!isLoading) gsap.to(btnRef.current, { scale: 1.025, duration: 0.18 }); };
  const handleBtnLeave = () => { gsap.to(btnRef.current, { scale: 1, duration: 0.18 }); };
  const handleBtnDown  = () => { if (!isLoading) gsap.to(btnRef.current, { scale: 0.97, duration: 0.08 }); };
  const handleBtnUp    = () => { gsap.to(btnRef.current, { scale: 1, duration: 0.15 }); };

  const onSubmit = async (values: LoginFormValues) => {
    setIsLoading(true);
    setErrorMsg(null);
    setAttemptsLeft(null);

    try {
      await signIn("credentials", {
        email: values.email,
        password: values.password,
        redirect: false,
      });

      // In NextAuth v5, check the session directly — result.ok/error are unreliable
      const session = await getSession();

      if (!session?.user) {
        // Login failed — shake button and show error immediately
        gsap.fromTo(btnRef.current, { x: 0 },
          { x: 6, duration: 0.07, ease: "power2.inOut", yoyo: true, repeat: 5,
            onComplete: () => { gsap.set(btnRef.current, { x: 0 }); } }
        );

        setErrorMsg("Invalid email or password. Please try again.");

        // Enrich with attempt count / lockout info in background
        fetch("/api/auth/login-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: values.email }),
        })
          .then((r) => r.json())
          .then((s) => {
            if (s.status === "locked") {
              setLockedUntil(new Date(s.lockedUntil));
              setErrorMsg(null);
            } else if (s.status === "inactive") {
              setErrorMsg("This account has been deactivated. Contact your administrator.");
            } else if (typeof s.attemptsRemaining === "number" && s.attemptsRemaining < 5) {
              setAttemptsLeft(s.attemptsRemaining);
            }
          })
          .catch(() => {/* keep the generic message */});

        return;
      }

      // Login succeeded
      setWelcomeName(session.user.name ?? "there");
    } catch {
      setErrorMsg("Unable to connect. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const showBanner = errorMsg !== null || isLocked;

  return (
    <div>
      {welcomeName && (
        <WelcomeOverlay name={welcomeName} onComplete={() => { router.push("/dashboard"); router.refresh(); }} />
      )}

      {/* Error / lockout banner */}
      {showBanner && (
        <div
          className="mb-5 flex items-start gap-3 rounded-lg px-4 py-3"
          style={{
            background: isLocked ? "rgba(245,158,11,0.13)" : "rgba(239,68,68,0.12)",
            border: isLocked ? "1.5px solid rgba(245,158,11,0.35)" : "1.5px solid rgba(239,68,68,0.30)",
          }}
        >
          {isLocked
            ? <ShieldAlert className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            : <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
          }

          {isLocked ? (
            <div>
              <p className="text-sm font-semibold text-amber-300">Account temporarily locked</p>
              <p className="text-xs text-amber-400/80 mt-0.5">
                Too many failed attempts. Try again in{" "}
                <span className="font-mono font-bold text-amber-200">{fmtCountdown(countdown)}</span>
              </p>
              <p className="text-xs text-amber-500/70 mt-1">A notification has been sent to your email.</p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-red-300">{errorMsg}</p>
              {attemptsLeft !== null && attemptsLeft > 0 && (
                <p className="text-xs text-red-400/80 mt-0.5">
                  <span className="font-semibold text-red-300">{attemptsLeft}</span>{" "}
                  attempt{attemptsLeft !== 1 ? "s" : ""} remaining before lockout.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Heading */}
      <div ref={headingRef} className="mb-7" style={{ opacity: 0 }}>
        <h1 className="text-xl font-semibold text-white mb-1">Welcome back</h1>
        <p className="text-sm text-white/40">Sign in to your account to continue</p>
      </div>

      {/* method="post" matters: if this form ever submits before hydration, a
          GET would put the password in the URL (and into access logs). */}
      <form onSubmit={handleSubmit(onSubmit)} method="post" noValidate className="space-y-5">
        {/* Email */}
        <div ref={emailRef} className="space-y-1.5" style={{ opacity: 0 }}>
          <label className="text-sm font-medium text-white/60">Email address</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25 pointer-events-none" />
            <input
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@company.com"
              disabled={isLoading || isLocked}
              className={`${inputClass} pl-9 ${errors.email ? inputErrorClass : ""}`}
              {...register("email")}
            />
          </div>
          {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
        </div>

        {/* Password */}
        <div ref={passwordRef} className="space-y-1.5" style={{ opacity: 0 }}>
          <label className="text-sm font-medium text-white/60">Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25 pointer-events-none" />
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              disabled={isLoading || isLocked}
              className={`${inputClass} pl-9 pr-10 ${errors.password ? inputErrorClass : ""}`}
              {...register("password")}
            />
            <button
              type="button"
              tabIndex={-1}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 transition-colors"
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
        </div>

        {/* Submit */}
        <button
          ref={btnRef}
          type="submit"
          disabled={isLoading || isLocked || !hydrated}
          onMouseEnter={handleBtnEnter}
          onMouseLeave={handleBtnLeave}
          onMouseDown={handleBtnDown}
          onMouseUp={handleBtnUp}
          className="w-full mt-2 py-2.5 px-4 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            opacity: 0,
            background: isLoading || isLocked || !hydrated
              ? "rgba(59,130,246,0.35)"
              : "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)",
            boxShadow: "0 0 24px rgba(59,130,246,0.35), 0 2px 8px rgba(0,0,0,0.4)",
          }}
        >
          {isLoading ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Signing in...</>
          ) : isLocked ? (
            <><Clock className="h-4 w-4" />Locked — {fmtCountdown(countdown)}</>
          ) : (
            "Sign in"
          )}
        </button>

        <div className="text-center mt-3">
          <Link
            href="/forgot-password"
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            Forgot your password?
          </Link>
        </div>
      </form>

      {/* Footer */}
      <div
        ref={footerRef}
        className="mt-7 pt-5"
        style={{ borderTop: "1px solid rgba(255,255,255,0.10)", opacity: 0 }}
      >
        <div
          className="rounded-lg px-3 py-2.5 text-center"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <p className="text-xs text-white/50 leading-relaxed">
            Access is restricted to authorised personnel only.
            <br />
            Contact your system administrator at{" "}
            <a href="mailto:it@illumestudentservices.ca" className="text-blue-400/80 hover:text-blue-300 underline underline-offset-2 transition-colors">
              it@illumestudentservices.ca
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
