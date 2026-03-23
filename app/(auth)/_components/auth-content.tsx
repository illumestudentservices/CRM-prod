"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";

export function AuthContent({ children }: { children: React.ReactNode }) {
  const iconRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLSpanElement>(null);
  const subtitleRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const accentRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

    // Logo icon pops in
    tl.fromTo(
      iconRef.current,
      { scale: 0.4, opacity: 0, rotation: -15 },
      { scale: 1, opacity: 1, rotation: 0, duration: 0.65, ease: "back.out(1.8)" }
    )
    // Brand name slides in from left
    .fromTo(
      brandRef.current,
      { x: -18, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.45 },
      "-=0.4"
    )
    // Subtitle fades up
    .fromTo(
      subtitleRef.current,
      { y: 6, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.4 },
      "-=0.25"
    )
    // Card reveals with blur clear
    .fromTo(
      cardRef.current,
      { y: 36, opacity: 0, filter: "blur(10px)" },
      { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.6 },
      "-=0.15"
    )
    // Accent line sweeps across
    .fromTo(
      accentRef.current,
      { scaleX: 0, transformOrigin: "left center" },
      { scaleX: 1, duration: 0.7, ease: "power2.inOut" },
      "-=0.4"
    )
    // Footer fades last
    .fromTo(
      footerRef.current,
      { opacity: 0 },
      { opacity: 1, duration: 0.5 },
      "-=0.2"
    );
  }, []);

  return (
    <div className="relative z-10 w-full max-w-md mx-auto px-4 py-12">
      {/* Brand */}
      <div className="flex flex-col items-center mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div
            ref={iconRef}
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, #1d4ed8, #06b6d4)",
              boxShadow: "0 0 32px rgba(29,78,216,0.45), 0 4px 16px rgba(0,0,0,0.5)",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="white" fillOpacity="0.95" />
              <path d="M9 12l2 2 4-4" stroke="#67e8f9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span
            ref={brandRef}
            className="text-3xl font-bold text-white"
            style={{ letterSpacing: "-0.03em" }}
          >
            Illume
          </span>
        </div>
        <span
          ref={subtitleRef}
          className="text-[11px] font-semibold tracking-[0.2em] uppercase text-white/30"
        >
          Student Advisory Services
        </span>
      </div>

      {/* Glass card */}
      <div
        ref={cardRef}
        className="rounded-2xl overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(24px)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(255,255,255,0.05)",
        }}
      >
        {/* Top accent line */}
        <div
          ref={accentRef}
          className="h-px w-full"
          style={{ background: "linear-gradient(90deg, transparent, #3b82f6, #06b6d4, transparent)" }}
        />

        <div className="px-8 py-8">
          {children}
        </div>

        {/* Bottom accent line */}
        <div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)" }} />
      </div>

      <p
        ref={footerRef}
        className="mt-6 text-center text-xs text-white/45"
        style={{ opacity: 0 }}
      >
        &copy; {new Date().getFullYear()} Illume Student Advisory Services. All rights reserved.
      </p>
    </div>
  );
}
