"use client";

import { useEffect, useState } from "react";

/**
 * Theme-aware colours for recharts.
 *
 * Charts are the one place Tailwind's `dark:` variants can't help: recharts
 * takes colours as props and inline style objects, not classes. Every chart in
 * the app therefore had literal light hex values — a near-white grid
 * (`#f1f5f9`) that vanishes on a dark card, slate-500 tick labels that go
 * unreadable, and a tooltip with no background at all, which renders as a
 * white box in dark mode.
 *
 * Reading the theme in JS is the only way to fix that. We watch the `dark`
 * class on <html> rather than a media query, because the app's toggle is
 * class-based and supports an explicit light choice on a dark OS.
 */

export interface ChartTheme {
  isDark: boolean;
  /** Cartesian grid lines — must be visible but never compete with the data. */
  grid: string;
  /** Axis lines and tick text. */
  axis: string;
  axisText: string;
  /** Tooltip surface. */
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  /** Reference lines, target markers, and other neutral annotations. */
  reference: string;
  /**
   * Fill for a series carrying no meaning of its own — the grey "allocated"
   * bar behind a coloured "used" bar, a progress-ring track. Brand-coloured
   * series are deliberately left alone, since those encode meaning.
   */
  neutralSeries: string;
  /** Ready-made recharts prop objects, so call sites stay short. */
  tickStyle: { fontSize: number; fill: string };
  tooltipContentStyle: React.CSSProperties;
  /** For <Legend formatter> spans, which recharts renders as raw JSX. */
  legendStyle: React.CSSProperties;
}

type Palette = Omit<
  ChartTheme,
  "isDark" | "tickStyle" | "tooltipContentStyle" | "legendStyle"
>;

const LIGHT: Palette = {
  grid: "#e2e8f0",
  axis: "#cbd5e1",
  axisText: "#64748b",
  tooltipBg: "#ffffff",
  tooltipBorder: "#e2e8f0",
  tooltipText: "#1e293b",
  reference: "#94a3b8",
  neutralSeries: "#cbd5e1",
};

const DARK: Palette = {
  // One step lighter than the card so the grid reads without dominating.
  grid: "#1e293b",
  axis: "#334155",
  // slate-400: passes contrast on slate-900 without glowing.
  axisText: "#94a3b8",
  tooltipBg: "#0f172a",
  tooltipBorder: "#334155",
  tooltipText: "#e2e8f0",
  reference: "#475569",
  // slate-300 read as a bright bar on a dark card; slate-600 keeps it clearly
  // secondary to whatever colour sits in front of it.
  neutralSeries: "#475569",
};

export function useChartTheme(): ChartTheme {
  // Default to light on the server pass; the effect corrects it before paint
  // matters, and guessing dark would flash the wrong colours for light users.
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setIsDark(root.classList.contains("dark"));
    read();

    // The toggle mutates the class list on <html>, so observe that rather than
    // polling or listening for a custom event.
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const base = isDark ? DARK : LIGHT;

  return {
    isDark,
    ...base,
    tickStyle: { fontSize: 11, fill: base.axisText },
    tooltipContentStyle: {
      fontSize: 12,
      borderRadius: 8,
      backgroundColor: base.tooltipBg,
      border: `1px solid ${base.tooltipBorder}`,
      color: base.tooltipText,
      // Recharts applies its own inline colour to labels; this wins it back.
      boxShadow: isDark
        ? "0 4px 12px rgba(0,0,0,0.5)"
        : "0 4px 12px rgba(15,23,42,0.08)",
    },
    legendStyle: { fontSize: 11, color: base.axisText },
  };
}
