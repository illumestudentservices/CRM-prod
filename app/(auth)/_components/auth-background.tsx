"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseOpacity: number;
  phase: number;
  phaseSpeed: number;
  isNode: boolean;
  color: [number, number, number];
}

interface Pulse {
  from: Particle;
  to: Particle;
  progress: number;
  speed: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
  color: [number, number, number];
}

const PALETTE: [number, number, number][] = [
  [255, 255, 255],  // white
  [96,  165, 250],  // blue-400
  [167, 139, 250],  // violet-400
  [34,  211, 238],  // cyan-400
];

const CONNECT_DIST = 160;
const TOTAL       = 70;
const NODE_COUNT  = 9;

export function AuthBackground() {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const glowARef   = useRef<HTMLDivElement>(null);
  const glowBRef   = useRef<HTMLDivElement>(null);

  // Ambient glow drift with GSAP
  useEffect(() => {
    gsap.to(glowARef.current, {
      x: 60, y: 40, duration: 9, ease: "sine.inOut", yoyo: true, repeat: -1,
    });
    gsap.to(glowBRef.current, {
      x: -50, y: -30, duration: 12, ease: "sine.inOut", yoyo: true, repeat: -1,
    });
  }, []);

  // Canvas animation
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx    = canvas.getContext("2d")!;
    let raf: number;

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    // Build particles
    const particles: Particle[] = Array.from({ length: TOTAL }, (_, i) => {
      const isNode = i < NODE_COUNT;
      const color  = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      return {
        x:           Math.random() * canvas.width,
        y:           Math.random() * canvas.height,
        vx:          (Math.random() - 0.5) * (isNode ? 0.12 : 0.22),
        vy:          (Math.random() - 0.5) * (isNode ? 0.12 : 0.22),
        radius:      isNode ? Math.random() * 2 + 2.5 : Math.random() * 1.2 + 0.6,
        baseOpacity: isNode ? 0.75 : Math.random() * 0.4 + 0.15,
        phase:       Math.random() * Math.PI * 2,
        phaseSpeed:  Math.random() * 0.012 + 0.004,
        isNode,
        color,
      };
    });

    const pulses:  Pulse[]  = [];
    const ripples: Ripple[] = [];
    let lastPulse = 0;
    let lastRipple = 0;

    function spawnPulse(now: number) {
      if (now - lastPulse < 1800) return;
      lastPulse = now;
      const nodes = particles.filter(p => p.isNode);
      const from  = nodes[Math.floor(Math.random() * nodes.length)];
      const near  = nodes.filter(n => {
        if (n === from) return false;
        const dx = from.x - n.x, dy = from.y - n.y;
        return Math.hypot(dx, dy) < CONNECT_DIST * 2;
      });
      if (near.length) {
        pulses.push({
          from,
          to:       near[Math.floor(Math.random() * near.length)],
          progress: 0,
          speed:    0.007 + Math.random() * 0.007,
        });
      }
    }

    function spawnRipple(now: number) {
      if (now - lastRipple < 2600) return;
      lastRipple = now;
      const nodes = particles.filter(p => p.isNode);
      const src   = nodes[Math.floor(Math.random() * nodes.length)];
      ripples.push({
        x:         src.x,
        y:         src.y,
        radius:    src.radius,
        maxRadius: 40 + Math.random() * 30,
        opacity:   0.5,
        color:     src.color,
      });
    }

    function draw(now: number) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Move particles
      for (const p of particles) {
        p.x    += p.vx;
        p.y    += p.vy;
        p.phase += p.phaseSpeed;
        if (p.x < -20)               p.x = canvas.width  + 20;
        if (p.x > canvas.width  + 20) p.x = -20;
        if (p.y < -20)               p.y = canvas.height + 20;
        if (p.y > canvas.height + 20) p.y = -20;
      }

      // Connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist > CONNECT_DIST) continue;
          const alpha    = (1 - dist / CONNECT_DIST);
          const isStrong = a.isNode || b.isNode;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(255,255,255,${alpha * (isStrong ? 0.22 : 0.07)})`;
          ctx.lineWidth   = isStrong ? 0.7 : 0.35;
          ctx.stroke();
        }
      }

      // Ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.radius  += 0.6;
        r.opacity -= 0.008;
        if (r.opacity <= 0) { ripples.splice(i, 1); continue; }
        const [rr, rg, rb] = r.color;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rr},${rg},${rb},${r.opacity})`;
        ctx.lineWidth   = 1;
        ctx.stroke();
      }

      // Particles
      for (const p of particles) {
        const pulse = Math.sin(p.phase) * 0.2 + 0.8;
        const op    = p.baseOpacity * pulse;
        const [r, g, b] = p.color;

        if (p.isNode) {
          // Halo glow
          const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 9);
          halo.addColorStop(0,   `rgba(${r},${g},${b},${op * 0.35})`);
          halo.addColorStop(0.5, `rgba(${r},${g},${b},${op * 0.08})`);
          halo.addColorStop(1,   `rgba(${r},${g},${b},0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 9, 0, Math.PI * 2);
          ctx.fillStyle = halo;
          ctx.fill();
        }

        // Core dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * pulse, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${op})`;
        ctx.fill();
      }

      // Pulses (energy dots racing along connections)
      spawnPulse(now);
      for (let i = pulses.length - 1; i >= 0; i--) {
        const pl = pulses[i];
        pl.progress += pl.speed;
        if (pl.progress >= 1) { pulses.splice(i, 1); continue; }

        const t    = pl.progress;
        const fade = t < 0.1 ? t / 0.1 : t > 0.85 ? (1 - t) / 0.15 : 1;
        const px   = pl.from.x + (pl.to.x - pl.from.x) * t;
        const py   = pl.from.y + (pl.to.y - pl.from.y) * t;

        // Glow
        const pg = ctx.createRadialGradient(px, py, 0, px, py, 7);
        pg.addColorStop(0, `rgba(255,255,255,${fade * 0.85})`);
        pg.addColorStop(0.4, `rgba(96,165,250,${fade * 0.3})`);
        pg.addColorStop(1, `rgba(96,165,250,0)`);
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fillStyle = pg;
        ctx.fill();

        // Bright core
        ctx.beginPath();
        ctx.arc(px, py, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${fade})`;
        ctx.fill();
      }

      // Ripple spawner
      spawnRipple(now);

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Pure black */}
      <div className="absolute inset-0" style={{ background: "#020202" }} />

      {/* Drifting ambient glows */}
      <div
        ref={glowARef}
        className="absolute -top-40 -right-20 w-[700px] h-[700px] rounded-full"
        style={{
          background: "radial-gradient(ellipse, rgba(29,78,216,0.07) 0%, transparent 65%)",
          filter: "blur(60px)",
        }}
      />
      <div
        ref={glowBRef}
        className="absolute -bottom-40 -left-20 w-[600px] h-[600px] rounded-full"
        style={{
          background: "radial-gradient(ellipse, rgba(124,58,237,0.06) 0%, transparent 65%)",
          filter: "blur(60px)",
        }}
      />

      {/* Horizon sweep */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          height: "30%",
          background:
            "radial-gradient(ellipse 90% 60% at 50% 100%, rgba(255,255,255,0.022) 0%, transparent 100%)",
        }}
      />

      {/* Particle canvas */}
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
