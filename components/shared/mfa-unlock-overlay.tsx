"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";

/**
 * Post-MFA success overlay — shield with concentric ripples, then the padlock
 * "clicks open" and the whole thing fades out into the dashboard.
 *
 * Roughly 2.4 seconds end-to-end, matching the tempo of WelcomeOverlay so
 * users on daily logins don't feel it dragging.
 *
 * Portalled to document.body because the sign-in card sets backdrop-filter
 * (fixed-position descendants get contained by that ancestor otherwise).
 */

interface Props {
  name?: string;
  onComplete: () => void;
}

export function MfaUnlockOverlay({ name, onComplete }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const shieldRef = useRef<SVGSVGElement>(null);
  const ring1Ref = useRef<SVGCircleElement>(null);
  const ring2Ref = useRef<SVGCircleElement>(null);
  const ring3Ref = useRef<SVGCircleElement>(null);
  const lockRef = useRef<SVGGElement>(null);
  const unlockedRef = useRef<SVGGElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const subCaptionRef = useRef<HTMLDivElement>(null);

  const goRef = useRef<(() => void) | null>(null);
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    // Same one-shot pattern as WelcomeOverlay — throttled tabs would otherwise
    // strand the user on the overlay forever.
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

    // 1) Backdrop fade-in and shield lifts from below.
    tl.fromTo(rootRef.current, { opacity: 0 }, { opacity: 1, duration: 0.28 })
      .fromTo(
        shieldRef.current,
        { opacity: 0, y: 14, scale: 0.9 },
        { opacity: 1, y: 0, scale: 1, duration: 0.5 },
        "-=0.12"
      );

    // 2) Concentric ripples pulse outward from the shield centre. Each ring
    //    grows from r≈24 to r≈120 while its opacity fades — creates a radar
    //    "verify" feel.
    const rings = [ring1Ref.current, ring2Ref.current, ring3Ref.current].filter(
      Boolean
    ) as SVGCircleElement[];
    tl.addLabel("ripple", "-=0.15");
    for (let i = 0; i < rings.length; i++) {
      tl.fromTo(
        rings[i],
        { attr: { r: 24 }, opacity: 0.7 },
        {
          attr: { r: 120 },
          opacity: 0,
          duration: 1.4,
          ease: "power2.out",
        },
        `ripple+=${i * 0.28}`
      );
    }

    // 3) After the second ripple starts, the padlock "clicks open" — the closed
    //    lock scales down + fades, the unlocked lock scales up + fades in with
    //    a subtle bounce.
    tl.to(
      lockRef.current,
      { opacity: 0, scale: 0.75, duration: 0.28, transformOrigin: "50% 50%" },
      "ripple+=0.6"
    )
      .fromTo(
        unlockedRef.current,
        { opacity: 0, scale: 0.75, transformOrigin: "50% 50%" },
        { opacity: 1, scale: 1, duration: 0.42, ease: "back.out(2)" },
        "<0.05"
      );

    // 4) Caption fades in during the last ripple, holds briefly, then the
    //    whole overlay fades out and hands off to the next screen.
    tl.fromTo(
      captionRef.current,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.35 },
      "ripple+=1.1"
    )
      .fromTo(
        subCaptionRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.3 },
        "<0.05"
      )
      .to({}, { duration: 0.85 })
      .to(rootRef.current, { opacity: 0, duration: 0.4, onComplete: go });

    return () => {
      clearTimeout(failsafe);
      tl.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstName = name?.trim().split(/\s+/)[0];

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
          "radial-gradient(900px 600px at 50% 45%, rgba(34,197,94,0.08), transparent 65%)," +
          "linear-gradient(160deg, #04080F 0%, #071324 50%, #050C17 100%)",
      }}
      title="Click to continue"
    >
      <svg
        ref={shieldRef}
        width={200}
        height={200}
        viewBox="0 0 200 200"
        style={{ opacity: 0, overflow: "visible" }}
        aria-hidden
      >
        <defs>
          <linearGradient id="shield-stroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="55%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#f5a524" />
          </linearGradient>
          <radialGradient id="shield-fill" cx="0.5" cy="0.4" r="0.7">
            <stop offset="0%" stopColor="rgba(34,197,94,0.18)" />
            <stop offset="100%" stopColor="rgba(4,8,15,0)" />
          </radialGradient>
        </defs>

        {/* Ripples emit from the shield centre. */}
        <circle
          ref={ring1Ref}
          cx={100}
          cy={100}
          r={24}
          fill="none"
          stroke="#22c55e"
          strokeWidth={1.5}
          opacity={0}
        />
        <circle
          ref={ring2Ref}
          cx={100}
          cy={100}
          r={24}
          fill="none"
          stroke="#38bdf8"
          strokeWidth={1.5}
          opacity={0}
        />
        <circle
          ref={ring3Ref}
          cx={100}
          cy={100}
          r={24}
          fill="none"
          stroke="#22c55e"
          strokeWidth={1.5}
          opacity={0}
        />

        {/* The shield silhouette itself. Stroke uses the tricolor gradient so it
            picks up the existing brand blue → emerald → amber palette. */}
        <path
          d="M100 30 L152 52 L152 100 C152 132 128 158 100 168 C72 158 48 132 48 100 L48 52 Z"
          fill="url(#shield-fill)"
          stroke="url(#shield-stroke)"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />

        {/* Closed padlock — fades out. */}
        <g ref={lockRef} transform="translate(100 105)" opacity={1}>
          <rect x={-16} y={0} width={32} height={26} rx={4} fill="#0f172a" stroke="#38bdf8" strokeWidth={2} />
          <path
            d="M-10 0 V-8 A10 10 0 0 1 10 -8 V0"
            fill="none"
            stroke="#38bdf8"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <circle cx={0} cy={11} r={2.5} fill="#38bdf8" />
          <line x1={0} y1={11} x2={0} y2={17} stroke="#38bdf8" strokeWidth={2} strokeLinecap="round" />
        </g>

        {/* Open padlock — fades in. Same body, but the shackle is rotated open
            and the whole group tints emerald. */}
        <g ref={unlockedRef} transform="translate(100 105)" opacity={0}>
          <rect x={-16} y={0} width={32} height={26} rx={4} fill="#0f172a" stroke="#22c55e" strokeWidth={2} />
          <path
            d="M-10 0 V-8 A10 10 0 0 1 10 -8"
            fill="none"
            stroke="#22c55e"
            strokeWidth={2.5}
            strokeLinecap="round"
            transform="rotate(30 -10 -8)"
          />
          {/* Green tick inside instead of the keyhole dot. */}
          <path
            d="M-6 12 L-1 17 L7 8"
            fill="none"
            stroke="#22c55e"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>

      <div
        ref={captionRef}
        className="mt-6 text-white text-center"
        style={{
          opacity: 0,
          fontFamily: "var(--font-display), Georgia, serif",
          fontWeight: 600,
          fontSize: "clamp(1.4rem, 3vw, 2rem)",
          letterSpacing: "-0.01em",
        }}
      >
        {firstName ? `You're in, ${firstName}` : "Two-factor verified"}
      </div>

      <div
        ref={subCaptionRef}
        className="mt-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-300/70"
        style={{ opacity: 0 }}
      >
        Two-factor authentication complete
      </div>
    </div>,
    document.body
  );
}
