"use client";

import * as React from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "./provider";
import { cn } from "@/lib/utils";

/**
 * Segmented three-way theme toggle: light / system / dark.
 *
 * Chosen over a two-state switch because "system" is the most respectful
 * default — a user who changes their OS theme after dark shouldn't have to
 * come back here to match it. The segmented control makes all three modes
 * visible at once so no one is left guessing what the current state is.
 *
 * Kept keyboard-navigable: each segment is a real <button>, so tab-through
 * and Enter/Space activation work without any extra wiring.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  const options: Array<{
    value: "light" | "system" | "dark";
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = [
    { value: "light", label: "Light mode", Icon: Sun },
    { value: "system", label: "Match system", Icon: Monitor },
    { value: "dark", label: "Dark mode", Icon: Moon },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-100/80 p-0.5",
        "dark:border-slate-700 dark:bg-slate-800/80",
        className
      )}
    >
      {options.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
              active
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
