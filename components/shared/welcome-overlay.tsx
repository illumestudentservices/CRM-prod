"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";
import { IllumeMark } from "@/app/(auth)/_components/illume-mark";

/**
 * Brief hand-off between signing in and the dashboard.
 *
 * Deliberately understated: staff sign in every morning, so this is a moment of
 * orientation rather than a celebration.
 *
 * Portalled to document.body because the sign-in card sets backdrop-filter,
 * which makes it a containing block for fixed-position descendants — rendered
 * inline, this covers the card instead of the viewport.
 */

interface Props {
  name: string;
  onComplete: () => void;
}

export function WelcomeOverlay({ name, onComplete }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const eyebrowRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const ruleRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);

  const goRef = useRef<(() => void) | null>(null);
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const firstName = name.trim().split(/\s+/)[0];
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  useEffect(() => {
    // Navigation happens exactly once. GSAP runs on requestAnimationFrame, which
    // browsers throttle to ~1fps in a background tab — without this a user who
    // switches tabs mid-login would never be moved on.
    let navigated = false;
    const go = () => {
      if (navigated) return;
      navigated = true;
      onComplete();
    };
    goRef.current = go;
    const failsafe = setTimeout(go, 5000);
    failsafeRef.current = failsafe;

    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

    tl.fromTo(rootRef.current, { opacity: 0 }, { opacity: 1, duration: 0.28 })
      .fromTo(
        markRef.current,
        { opacity: 0, y: 10, scale: 0.94 },
        { opacity: 1, y: 0, scale: 1, duration: 0.42 },
        "-=0.1"
      )
      .fromTo(
        eyebrowRef.current,
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.3 },
        "-=0.2"
      )
      .fromTo(
        nameRef.current,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.42 },
        "-=0.18"
      )
      .fromTo(
        ruleRef.current,
        { scaleX: 0 },
        { scaleX: 1, duration: 0.5, ease: "power2.inOut" },
        "-=0.3"
      )
      .fromTo(
        dateRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.32 },
        "-=0.32"
      )
      // Hold long enough to actually register the name and date before moving on
      .to({}, { duration: 1.3 })
      .to(rootRef.current, { opacity: 0, duration: 0.45, onComplete: go });

    return () => {
      clearTimeout(failsafe);
      tl.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      ref={rootRef}
      onClick={() => {
        clearTimeout(failsafeRef.current);
        goRef.current?.();
      }}
      className="fixed inset-0 z-[999] flex flex-col items-center justify-center cursor-pointer"
      style={{
        opacity: 0,
        background:
          "radial-gradient(900px 600px at 50% 45%, rgba(56,189,248,0.07), transparent 65%)," +
          "linear-gradient(160deg, #04080F 0%, #071324 50%, #050C17 100%)",
      }}
      title="Click to continue"
    >
      <div ref={markRef} style={{ opacity: 0 }}>
        <IllumeMark size={40} />
      </div>

      <div
        ref={eyebrowRef}
        className="mt-6 text-[10px] font-semibold uppercase tracking-[0.3em] text-sky-300/40"
        style={{ opacity: 0 }}
      >
        Welcome back
      </div>

      <div
        ref={nameRef}
        className="mt-2.5 text-white text-center px-6"
        style={{
          opacity: 0,
          fontFamily: "var(--font-display), Georgia, serif",
          fontWeight: 600,
          fontSize: "clamp(1.9rem, 4vw, 2.9rem)",
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        {firstName}
      </div>

      <div
        ref={ruleRef}
        className="mt-6 h-px w-28"
        style={{
          transformOrigin: "center",
          background:
            "linear-gradient(90deg, transparent, rgba(245,165,36,.6), rgba(56,189,248,.6), transparent)",
        }}
      />

      <div
        ref={dateRef}
        className="mt-5 text-[11px] tracking-wide text-white/25"
        style={{ opacity: 0 }}
      >
        {today}
      </div>
    </div>,
    document.body
  );
}
