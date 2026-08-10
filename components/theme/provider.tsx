"use client";

import * as React from "react";

/**
 * Theme provider — three-way (light / dark / system).
 *
 * Design notes:
 *   - We toggle the `dark` class on `<html>` so all Tailwind `dark:` variants
 *     work anywhere in the tree without cascading CSS var overrides.
 *   - Preference is persisted to localStorage under `illume-theme`.
 *   - "system" tracks the OS `prefers-color-scheme` media query and reacts
 *     live if the user switches their OS setting mid-session.
 *   - FOUC prevention: a small inline script (rendered by ThemeInitScript
 *     inside the root <head>) sets the class BEFORE React hydrates. Without
 *     it the page would render in light mode for a frame and then flip.
 *   - The script is defensive against the storage being unavailable (private
 *     Safari, third-party cookie blockers, etc.) and defaults to "system".
 */

type Theme = "light" | "dark" | "system";
const STORAGE_KEY = "illume-theme";

interface ThemeContextValue {
  /** What the user chose. Never inferred from the DOM. */
  theme: Theme;
  /** What's actually applied right now. If theme is "system" this reflects OS. */
  resolvedTheme: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function readInitial(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function applyTheme(theme: Theme): "light" | "dark" {
  const resolved: "light" | "dark" =
    theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  // Also expose to CSS via a data attribute so raw CSS can gate rules if it
  // wants a three-way distinction without duplicating the class check.
  root.dataset.theme = theme;
  root.style.colorScheme = resolved; // native form controls, scrollbars
  return resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Read the initial value once on mount. Because the inline init script has
  // already set the DOM class, the server-rendered HTML for the first paint
  // matches whatever we render here.
  const [theme, setThemeState] = React.useState<Theme>(() => readInitial());
  const [resolvedTheme, setResolved] = React.useState<"light" | "dark">(
    () => (theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme)
  );

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    const applied = applyTheme(next);
    setResolved(applied);
  }, []);

  // React to OS theme changes when theme is "system".
  React.useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const applied = applyTheme("system");
      setResolved(applied);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  // Sync across tabs — if the user changes theme in one tab, the other tabs
  // should follow.
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = (e.newValue as Theme) ?? "system";
      if (next === "light" || next === "dark" || next === "system") {
        setThemeState(next);
        setResolved(applyTheme(next));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    // Fail-safe fallback so hooks used before the provider is in place don't
    // crash the tree. Emits a warning once so it's noticed in dev.
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn("useTheme() called outside ThemeProvider — returning inert value");
    }
    return {
      theme: "system",
      resolvedTheme: "light",
      setTheme: () => {},
    };
  }
  return ctx;
}

/**
 * FOUC-prevention snippet. MUST render inside <head> BEFORE the app's JS.
 * Reads the saved preference and sets the class synchronously so the first
 * paint already matches. Kept small on purpose — this ships to every visitor.
 */
export function ThemeInitScript() {
  const js = `
(function(){try{
  var k='${STORAGE_KEY}';
  var v=localStorage.getItem(k);
  if(v!=='light'&&v!=='dark'&&v!=='system')v='system';
  var d=v==='dark'||(v==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  var r=document.documentElement;
  if(d)r.classList.add('dark');else r.classList.remove('dark');
  r.dataset.theme=v;
  r.style.colorScheme=d?'dark':'light';
}catch(_){}})();`;
  return (
    <script
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: js }}
    />
  );
}
