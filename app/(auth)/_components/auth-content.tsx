"use client";

import { IllumeMark } from "./illume-mark";

/**
 * Split editorial composition: the mission and the globe on the left, the form
 * on the right. Below lg it collapses to a compact brand header above the card,
 * since a login on a phone should be reachable without scrolling.
 */
export function AuthContent({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-10 w-full min-h-screen flex items-center justify-center px-5 py-10">
      <style>{`
        @keyframes illume-rise {
          from { opacity: 0; transform: translateY(14px); filter: blur(6px); }
          to   { opacity: 1; transform: translateY(0);    filter: blur(0);   }
        }
        .rise { animation: illume-rise .7s cubic-bezier(.22,.7,.24,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .rise { animation: none; opacity: 1; transform: none; filter: none; }
        }
      `}</style>

      <div className="w-full max-w-6xl grid lg:grid-cols-[1.05fr_minmax(0,420px)] gap-12 lg:gap-20 items-center">
        {/* ── Brand / mission ── */}
        <div className="hidden lg:block relative">
          {/* Scrim so the headline stays legible over the globe's upper limb */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-16 -inset-y-20 -z-10"
            style={{
              background:
                "radial-gradient(60% 55% at 30% 45%, rgba(4,8,15,0.82), rgba(4,8,15,0.35) 55%, transparent 78%)",
            }}
          />
          <div className="rise" style={{ animationDelay: "80ms" }}>
            <div className="flex items-center gap-3.5">
              <IllumeMark size={52} />
              <div>
                <div
                  className="text-[2.6rem] leading-none text-white"
                  style={{
                    fontFamily: "var(--font-display), Georgia, serif",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                  }}
                >
                  Illume
                </div>
                <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-sky-300/45">
                  Student Advisory Services
                </div>
              </div>
            </div>
          </div>

          <h1
            className="rise mt-11 text-[2.15rem] leading-[1.22] text-white/92 max-w-[19ch]"
            style={{
              fontFamily: "var(--font-display), Georgia, serif",
              fontWeight: 400,
              letterSpacing: "-0.015em",
              animationDelay: "200ms",
            }}
          >
            Guiding students from first enquiry to{" "}
            <span className="relative whitespace-nowrap">
              <span className="relative z-10 text-amber-300/95 italic">first lecture</span>
              <span
                className="absolute inset-x-0 bottom-1 h-[6px] -z-0"
                style={{
                  background: "linear-gradient(90deg, rgba(245,165,36,0.28), transparent)",
                }}
              />
            </span>
            .
          </h1>

          <p
            className="rise mt-5 text-sm leading-relaxed text-white/40 max-w-[46ch]"
            style={{ animationDelay: "320ms" }}
          >
            Every arc on the globe is a recruitment corridor we work — origin
            market to partner institution.
          </p>

          {/* Legend ties the visual back to the business */}
          <div
            className="rise mt-9 flex items-center gap-7 text-[11px] text-white/35"
            style={{ animationDelay: "430ms" }}
          >
            <span className="inline-flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "#F5A524", boxShadow: "0 0 9px rgba(245,165,36,.85)" }}
              />
              Origin market
            </span>
            <span className="h-px w-14 bg-gradient-to-r from-amber-400/45 to-sky-400/45" />
            <span className="inline-flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "#38BDF8", boxShadow: "0 0 9px rgba(56,189,248,.85)" }}
              />
              Partner institution
            </span>
          </div>
        </div>

        {/* ── Form panel ── */}
        <div className="w-full max-w-md mx-auto lg:mx-0">
          {/* Compact brand header, small screens only */}
          <div className="lg:hidden flex flex-col items-center mb-8 rise">
            <IllumeMark size={46} />
            <div
              className="mt-3 text-[2rem] leading-none text-white"
              style={{
                fontFamily: "var(--font-display), Georgia, serif",
                fontWeight: 600,
                letterSpacing: "-0.02em",
              }}
            >
              Illume
            </div>
            <div className="mt-1.5 text-[9px] font-semibold uppercase tracking-[0.26em] text-sky-300/45">
              Student Advisory Services
            </div>
          </div>

          <div
            className="rise rounded-2xl overflow-hidden"
            style={{
              background: "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.022))",
              border: "1px solid rgba(255,255,255,0.09)",
              backdropFilter: "blur(26px)",
              WebkitBackdropFilter: "blur(26px)",
              boxShadow:
                "0 40px 90px -20px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.07)",
              animationDelay: "260ms",
            }}
          >
            {/* Warm-to-cool hairline: the same origin→destination idea as the arcs */}
            <div
              className="h-px w-full"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgba(245,165,36,.75), rgba(56,189,248,.75), transparent)",
              }}
            />
            <div className="px-7 sm:px-8 py-8">{children}</div>
          </div>

          <p
            className="rise mt-6 text-center text-[11px] text-white/25"
            style={{ animationDelay: "420ms" }}
          >
            &copy; {new Date().getFullYear()} Illume Student Advisory Services
          </p>
        </div>
      </div>
    </div>
  );
}
