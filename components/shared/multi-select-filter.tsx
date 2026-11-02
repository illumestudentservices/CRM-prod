"use client";

import * as React from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  /** Trigger text when nothing is picked, e.g. "All Stages". */
  allLabel: string;
  /** Plural noun used in the count, e.g. "stages" → "3 stages". */
  noun: string;
  options: MultiSelectOption[];
  /** Currently-picked values. Empty array means "all" (no filter). */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Width utility class for the trigger, e.g. "w-[160px]". */
  className?: string;
  ariaLabel?: string;
}

/**
 * A dropdown filter that lets several options be ticked at once. Empty
 * selection means "no filter" (show everything). Kept deliberately like the
 * single-value <Select> filters it sits beside: same height, border and dark
 * styling, so a row of them reads as one control strip.
 */
export function MultiSelectFilter({
  allLabel,
  noun,
  options,
  selected,
  onChange,
  className,
  ariaLabel,
}: MultiSelectFilterProps) {
  const [open, setOpen] = React.useState(false);
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);

  function toggle(value: string) {
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // Emit in the options' own order so the selection stays stable.
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  }

  const triggerLabel =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? `1 ${noun}`
        : `${selected.length} ${noun}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "flex h-8 items-center justify-between gap-2 rounded-md border px-3 text-sm bg-white dark:bg-slate-900",
            selected.length > 0
              ? "border-[#1E3A5F]/50 text-slate-900 dark:text-slate-100"
              : "border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-300",
            className
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <div className="max-h-64 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-slate-400">No options</p>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Checkbox checked={selectedSet.has(opt.value)} className="pointer-events-none" tabIndex={-1} />
                <span className="truncate">{opt.label}</span>
              </button>
            ))
          )}
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            Clear {noun}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
