"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";

interface Props {
  name: string;
  onComplete: () => void;
}

export function WelcomeOverlay({ name, onComplete }: Props) {
  const rootRef     = useRef<HTMLDivElement>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);
  const nameRowRef  = useRef<HTMLDivElement>(null);
  const shimmerRef  = useRef<HTMLDivElement>(null);
  const glowRef     = useRef<HTMLDivElement>(null);
  const lineRef     = useRef<HTMLDivElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const goRef       = useRef<(() => void) | null>(null);
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const firstName = name.split(" ")[0];

  useEffect(() => {
    const chars = nameRowRef.current?.querySelectorAll<HTMLElement>(".ch") ?? [];

    // Navigation must happen exactly once, even if the animation stalls.
    // GSAP is driven by requestAnimationFrame, which browsers throttle to ~1fps
    // in background tabs — without this guard a user who switches tabs mid-login
    // would never be redirected.
    let navigated = false;
    const go = () => {
      if (navigated) return;
      navigated = true;
      onComplete();
    };
    goRef.current = go;
    const failsafe = setTimeout(go, 4000);
    failsafeRef.current = failsafe;

    // Sparkle burst
    function burst() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      const ctx = canvas.getContext("2d")!;
      const cx = canvas.width / 2, cy = canvas.height / 2;
      const COLS: [number, number, number][] = [
        [255,255,255],[96,165,250],[167,139,250],[250,204,21],[34,211,238],
      ];
      const pts = Array.from({ length: 100 }, () => {
        const a = Math.random() * Math.PI * 2, s = Math.random() * 10 + 3;
        return { x: cx, y: cy, vx: Math.cos(a)*s, vy: Math.sin(a)*s - Math.random()*3,
          size: Math.random()*2.4+0.5, op: 1, decay: Math.random()*0.016+0.009,
          col: COLS[Math.floor(Math.random()*COLS.length)] };
      });
      let raf = 0;
      function tick() {
        ctx.clearRect(0, 0, canvas!.width, canvas!.height);
        let alive = false;
        for (const p of pts) {
          if (p.op <= 0) continue; alive = true;
          p.x+=p.vx; p.y+=p.vy; p.vx*=0.96; p.vy*=0.96; p.vy+=0.09; p.op-=p.decay;
          const [r,g,b] = p.col;
          const g2 = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.size*5);
          g2.addColorStop(0,`rgba(${r},${g},${b},${p.op*0.7})`);
          g2.addColorStop(1,`rgba(${r},${g},${b},0)`);
          ctx.beginPath(); ctx.arc(p.x,p.y,p.size*5,0,Math.PI*2); ctx.fillStyle=g2; ctx.fill();
          ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2);
          ctx.fillStyle=`rgba(${r},${g},${b},${p.op})`; ctx.fill();
        }
        if (alive) raf = requestAnimationFrame(tick);
      }
      raf = requestAnimationFrame(tick);
    }

    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

    tl
      .fromTo(rootRef.current,
        { clipPath: "circle(12% at 50% 48%)" },
        { clipPath: "circle(150% at 50% 48%)", duration: 0.45, ease: "power3.inOut" }
      )
      .fromTo(lineRef.current,
        { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.3, ease: "power2.inOut" }, "-=0.1"
      )
      .fromTo(subtitleRef.current,
        { y: 16, opacity: 0, filter: "blur(8px)" }, { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.3 }, "-=0.15"
      )
      .fromTo(chars,
        { y: 55, opacity: 0, filter: "blur(14px)" },
        { y: 0,  opacity: 1, filter: "blur(0px)", duration: 0.4, stagger: 0.03 }, "-=0.2"
      )
      .fromTo(glowRef.current,
        { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "power2.out" }, "-=0.35"
      )
      .fromTo(shimmerRef.current,
        { x: "-115%" }, { x: "120%", duration: 0.6, ease: "power2.inOut" }, "-=0.25"
      )
      .call(() => burst(), undefined, "-=0.45")
      .to({}, { duration: 0.25 })
      // Fade everything out, then navigate
      .to(rootRef.current, { opacity: 0, duration: 0.35, ease: "power2.inOut", onComplete: go });

    return () => { clearTimeout(failsafe); tl.kill(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      ref={rootRef}
      onClick={() => { clearTimeout(failsafeRef.current); goRef.current?.(); }}
      className="fixed inset-0 z-[999] flex flex-col items-center justify-center cursor-pointer"
      style={{ background: "#020202", clipPath: "circle(12% at 50% 48%)" }}
      title="Click to continue"
    >
      {/* Ambient glow */}
      <div ref={glowRef} className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: 0 }}>
        <div style={{
          width: 700, height: 400, borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(59,130,246,0.2) 0%, rgba(124,58,237,0.12) 50%, transparent 72%)",
          filter: "blur(50px)",
        }} />
      </div>

      {/* Sparkles */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center select-none px-6 text-center">
        <div ref={lineRef} style={{
          width: 48, height: 1, marginBottom: 28,
          background: "linear-gradient(90deg, transparent, rgba(96,165,250,0.85), transparent)",
          transformOrigin: "center", opacity: 0,
        }} />

        <div ref={subtitleRef} style={{
          opacity: 0, fontSize: 11, letterSpacing: "0.28em",
          textTransform: "uppercase" as const,
          color: "rgba(255,255,255,0.35)", fontWeight: 500, marginBottom: 20,
        }}>
          Welcome back
        </div>

        <div style={{ position: "relative", overflow: "visible" }}>
          <div ref={nameRowRef} style={{
            fontSize: "clamp(2.8rem, 8vw, 5.5rem)", fontWeight: 700,
            color: "#ffffff", letterSpacing: "-0.025em", lineHeight: 1,
            display: "flex", flexWrap: "nowrap", whiteSpace: "nowrap",
          }}>
            {firstName.split("").map((ch, i) => (
              <span key={i} className="ch" style={{
                display: "inline-block", opacity: 0,
                textShadow: "0 0 50px rgba(96,165,250,0.65), 0 0 100px rgba(96,165,250,0.2)",
              }}>
                {ch}
              </span>
            ))}
          </div>
          <div ref={shimmerRef} style={{
            position: "absolute", top: 0, left: "-30%", width: "160%", height: "100%",
            background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)",
            transform: "translateX(-115%)", pointerEvents: "none",
          }} />
        </div>
      </div>
    </div>,
    document.body
  );
}
