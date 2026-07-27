"use client";

import { useEffect, useRef } from "react";

/**
 * "Corridors of light" — a slowly rotating wireframe globe tracing the student
 * mobility corridors Illume actually recruits along, with light travelling from
 * origin to destination.
 *
 * Orthographic projection with real great-circle interpolation, so the arcs sit
 * on the sphere the way flight paths do rather than being decorative curves.
 */

type Coord = { lat: number; lon: number; label: string };

/** Real recruitment corridors: origin market → destination market. */
const CORRIDORS: [Coord, Coord][] = [
  [{ lat: 6.5, lon: 3.4, label: "Lagos" }, { lat: 51.5, lon: -0.13, label: "London" }],
  [{ lat: -1.3, lon: 36.8, label: "Nairobi" }, { lat: 43.7, lon: -79.4, label: "Toronto" }],
  [{ lat: 19.1, lon: 72.9, label: "Mumbai" }, { lat: -33.9, lon: 151.2, label: "Sydney" }],
  [{ lat: 25.2, lon: 55.3, label: "Dubai" }, { lat: 53.5, lon: -2.24, label: "Manchester" }],
  [{ lat: 5.6, lon: -0.19, label: "Accra" }, { lat: 53.3, lon: -6.26, label: "Dublin" }],
  [{ lat: 24.9, lon: 67.0, label: "Karachi" }, { lat: -37.8, lon: 145.0, label: "Melbourne" }],
  [{ lat: 23.8, lon: 90.4, label: "Dhaka" }, { lat: 55.9, lon: -3.19, label: "Edinburgh" }],
];

const AMBER: [number, number, number] = [245, 165, 36]; // origin — the student
const CYAN: [number, number, number] = [56, 189, 248]; // destination — the institution

const DEG = Math.PI / 180;

type Vec3 = [number, number, number];

function toVec({ lat, lon }: Coord): Vec3 {
  const la = lat * DEG;
  const lo = lon * DEG;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

function rotateY([x, y, z]: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}

function tiltX([x, y, z]: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}

/** Great-circle interpolation, lifted off the surface so the arc reads as travel. */
function arcPoint(a: Vec3, b: Vec3, t: number, lift: number): Vec3 {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  const so = Math.sin(omega);
  let p: Vec3;
  if (so < 1e-6) {
    p = a;
  } else {
    const wa = Math.sin((1 - t) * omega) / so;
    const wb = Math.sin(t * omega) / so;
    p = [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
  }
  const r = 1 + lift * Math.sin(Math.PI * t);
  return [p[0] * r, p[1] * r, p[2] * r];
}

const rgba = (c: [number, number, number], a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function AuthBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    let R = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // On wide screens the globe sits low and left, cropped by the viewport,
      // so the headline above it stays on clean ground. Centred when stacked.
      if (w >= 1024) {
        cx = w * 0.23;
        cy = h * 0.70;
        R = Math.min(w * 0.235, h * 0.44);
      } else {
        cx = w * 0.5;
        cy = h * 0.42;
        R = Math.min(w * 0.44, h * 0.3);
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const vecs = CORRIDORS.map(([a, b]) => [toVec(a), toVec(b)] as [Vec3, Vec3]);
    const TILT = -18 * DEG;

    // Each corridor carries a pulse; stagger them so arrivals feel continuous.
    const pulses = CORRIDORS.map((_, i) => ({
      t: (i / CORRIDORS.length) * -1,
      speed: 0.0016 + (i % 3) * 0.0004,
    }));

    let raf = 0;
    let spin = 0;
    let running = true;

    const project = (v: Vec3) => {
      const p = tiltX(rotateY(v, spin), TILT);
      return { x: cx + p[0] * R, y: cy - p[1] * R, z: p[2] };
    };

    const drawGraticule = () => {
      ctx.lineWidth = 1;
      // Parallels
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath();
        let started = false;
        for (let lon = -180; lon <= 180; lon += 4) {
          const { x, y, z } = project(toVec({ lat, lon, label: "" }));
          if (z < 0) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "rgba(125,180,230,0.16)";
        ctx.stroke();
      }
      // Meridians
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.beginPath();
        let started = false;
        for (let lat = -90; lat <= 90; lat += 4) {
          const { x, y, z } = project(toVec({ lat, lon, label: "" }));
          if (z < 0) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "rgba(125,180,230,0.12)";
        ctx.stroke();
      }
    };

    const drawLimb = () => {
      // Atmospheric halo
      const g = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.35);
      g.addColorStop(0, "rgba(56,189,248,0.14)");
      g.addColorStop(1, "rgba(56,189,248,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(150,200,245,0.30)";
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const SEGMENTS = 96;

    const drawCorridors = () => {
      vecs.forEach(([a, b], i) => {
        const lift = 0.18;
        const pts = [];
        for (let s = 0; s <= SEGMENTS; s++) {
          pts.push(project(arcPoint(a, b, s / SEGMENTS, lift)));
        }

        // Arc body — colour shifts amber (origin) to cyan (destination)
        for (let s = 0; s < SEGMENTS; s++) {
          const p0 = pts[s];
          const p1 = pts[s + 1];
          if (p0.z < 0 && p1.z < 0) continue;
          const t = s / SEGMENTS;
          const col: [number, number, number] = [
            AMBER[0] + (CYAN[0] - AMBER[0]) * t,
            AMBER[1] + (CYAN[1] - AMBER[1]) * t,
            AMBER[2] + (CYAN[2] - AMBER[2]) * t,
          ];
          // Fade as the segment approaches the limb
          const depth = Math.max(0, Math.min(1, (p0.z + 0.35) / 1.1));
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.strokeStyle = rgba(col, 0.42 * depth);
          ctx.lineWidth = 1.1;
          ctx.stroke();
        }

        // Travelling light
        const pulse = pulses[i];
        if (pulse.t >= 0 && pulse.t <= 1) {
          const head = Math.floor(pulse.t * SEGMENTS);
          const TAIL = 14;
          for (let k = 0; k < TAIL; k++) {
            const s = head - k;
            if (s < 0 || s >= SEGMENTS) continue;
            const p0 = pts[s];
            const p1 = pts[s + 1];
            if (p0.z < 0) continue;
            const fade = (1 - k / TAIL) ** 2;
            const t = s / SEGMENTS;
            const col: [number, number, number] = [
              AMBER[0] + (CYAN[0] - AMBER[0]) * t,
              AMBER[1] + (CYAN[1] - AMBER[1]) * t,
              AMBER[2] + (CYAN[2] - AMBER[2]) * t,
            ];
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.strokeStyle = rgba(col, 0.85 * fade);
            ctx.lineWidth = 2.1 * fade + 0.5;
            ctx.stroke();
          }
          // Glow at the head
          const hp = pts[Math.min(head, SEGMENTS)];
          if (hp && hp.z > 0) {
            const t = pulse.t;
            const col: [number, number, number] = [
              AMBER[0] + (CYAN[0] - AMBER[0]) * t,
              AMBER[1] + (CYAN[1] - AMBER[1]) * t,
              AMBER[2] + (CYAN[2] - AMBER[2]) * t,
            ];
            const g = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, 9);
            g.addColorStop(0, rgba(col, 0.9));
            g.addColorStop(1, rgba(col, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(hp.x, hp.y, 9, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Endpoint markers
        [
          { v: a, col: AMBER },
          { v: b, col: CYAN },
        ].forEach(({ v, col }) => {
          const p = project(v);
          if (p.z <= 0) return;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = rgba(col, 0.95);
          ctx.fill();
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7);
          g.addColorStop(0, rgba(col, 0.35));
          g.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    };

    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      drawLimb();
      drawGraticule();
      drawCorridors();

      if (!reduced) {
        spin += 0.0011;
        pulses.forEach((p) => {
          p.t += p.speed;
          if (p.t > 1.25) p.t = -0.15;
        });
      }
      if (running) raf = requestAnimationFrame(frame);
    };

    frame();

    // Don't burn CPU on a backgrounded tab
    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <>
      {/* Deep navy field with a warm bloom low-left, cool bloom upper-right */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(1100px 700px at 22% 78%, rgba(245,165,36,0.07), transparent 62%)," +
            "radial-gradient(1000px 800px at 78% 18%, rgba(56,189,248,0.10), transparent 60%)," +
            "linear-gradient(160deg, #04080F 0%, #071324 45%, #050C17 100%)",
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {/* Grain — keeps the large flat areas from banding */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.16] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
        }}
      />
      {/* Vignette to seat the form panel */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 50%, transparent 40%, rgba(2,5,10,0.55) 100%)",
        }}
      />
    </>
  );
}
