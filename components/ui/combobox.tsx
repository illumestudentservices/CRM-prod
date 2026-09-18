"use client";

/**
 * A single-select dropdown you can type into.
 *
 * Built for the country and nationality boxes on the lead form, where a plain
 * Radix Select would mean scrolling 249 items. Uses the Popover and Input
 * already in this folder rather than adding cmdk or another dependency.
 *
 * Two behaviours are deliberate and worth keeping:
 *
 * 1. IT NEVER DISCARDS A VALUE IT DOES NOT RECOGNISE. Existing leads hold
 *    free-text entries typed before these boxes were dropdowns — "UAE National",
 *    "U.A.E.", misspellings. If the stored value matches no option it is shown
 *    as the current selection and offered at the top of the list, so opening a
 *    student to edit their phone number cannot silently blank their nationality.
 *    A picker that quietly drops what it cannot parse is worse than a text box.
 *
 * 2. The trigger is `role="combobox"`, matching Radix's own Select. Tests in
 *    this repo already look for that role, and `getByRole("button")` does not
 *    find a Radix trigger even though it renders a <button>.
 */

import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
  value: string;
  label: string;
};

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  /** The stored value. May be something not present in `options`. */
  value: string | null | undefined;
  onChange: (value: string) => void;
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string;
  /** Shown in the search box inside the dropdown. */
  searchPlaceholder?: string;
  /** Shown when the search matches nothing. */
  emptyText?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  /** Marks the trigger invalid for screen readers when the field has an error. */
  invalid?: boolean;
  "aria-describedby"?: string;
}

/** Lowercase and strip accents and punctuation so "cote divoire" finds "Côte d'Ivoire". */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Type to search...",
  emptyText = "No match found.",
  id,
  name,
  disabled,
  className,
  invalid,
  "aria-describedby": describedBy,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);

  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const current = value ?? "";
  const selected = React.useMemo(
    () => options.find((o) => o.value === current),
    [options, current]
  );

  /**
   * A stored value with no matching option — see note 1 at the top. Offered
   * first and labelled, so the person editing can see exactly what is on record
   * and choose to keep or replace it.
   */
  const unlisted = current !== "" && !selected ? current : null;

  const filtered = React.useMemo(() => {
    const base: ComboboxOption[] = unlisted
      ? [{ value: unlisted, label: unlisted }, ...options]
      : [...options];
    const q = fold(query);
    if (!q) return base;
    const hits = base.filter((o) => fold(o.label).includes(q));
    // Prefix matches first: typing "in" should surface India before Argentina.
    return hits.sort((a, b) => {
      const ap = fold(a.label).startsWith(q) ? 0 : 1;
      const bp = fold(b.label).startsWith(q) ? 0 : 1;
      return ap !== bp ? ap - bp : a.label.localeCompare(b.label);
    });
  }, [options, query, unlisted]);

  // Opening: clear the last search and highlight whatever is currently selected,
  // so reopening a filled box starts where the value already is.
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    const i = filtered.findIndex((o) => o.value === current);
    setActive(i >= 0 ? i : 0);
    // `filtered` is intentionally not a dependency: this must run on open only,
    // otherwise typing would keep resetting the highlight to the selected item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current]);

  // Typing changes the list, so clamp the highlight back into range.
  React.useEffect(() => {
    setActive((a) => (a >= filtered.length ? 0 : a));
  }, [filtered.length]);

  // Keep the highlighted row visible while arrowing through 249 countries.
  React.useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function commit(option: ComboboxOption) {
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (filtered.length ? (a + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (filtered.length ? (a - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, filtered.length - 1));
    } else if (e.key === "Enter") {
      // Without this the Enter that picks a country would also submit the form.
      e.preventDefault();
      const option = filtered[active];
      if (option) commit(option);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm",
            "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
            "focus:outline-none focus:ring-2 focus:ring-[#1E3A5F] focus:border-[#1E3A5F] dark:focus:ring-sky-500",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span
            className={cn(
              "line-clamp-1 text-left",
              !current && "text-slate-400 dark:text-slate-500"
            )}
          >
            {selected?.label ?? (current || placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        // Explicit var(): Tailwind v4 dropped the bare `w-[--foo]` shorthand.
        // Matching the trigger width keeps long country names from being cut.
        className="w-[var(--radix-popover-trigger-width)] p-0"
        // The search box must take focus, not the first list row.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 dark:border-slate-700">
          <Search className="h-4 w-4 shrink-0 opacity-50" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            aria-autocomplete="list"
            className={cn(
              "h-9 w-full bg-transparent py-2 text-sm outline-none",
              "placeholder:text-slate-400 dark:placeholder:text-slate-500"
            )}
          />
        </div>

        <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
              {emptyText}
            </p>
          )}

          {filtered.map((option, i) => {
            const isSelected = option.value === current;
            const isUnlisted = unlisted !== null && i === 0 && option.value === unlisted;
            return (
              <div
                key={`${option.value}-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                // Mouse down would blur the search input and close the popover
                // before the click landed, so selection happens on mousedown.
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(option);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                  i === active && "bg-slate-100 dark:bg-slate-800"
                )}
              >
                <Check
                  className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                />
                <span className="flex-1 truncate">{option.label}</span>
                {isUnlisted && (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                    On record
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>

      {/* Lets a plain form read the value, and gives tests something to assert on. */}
      {name && <input type="hidden" name={name} value={current} />}
    </Popover>
  );
}
