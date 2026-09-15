"use client";

import * as React from "react";
import type { RequirementTarget } from "./lead-gate";

/**
 * "Take me to the thing that is blocking this student."
 *
 * ── WHY A BROWSER EVENT AND NOT A CONTEXT ───────────────────────────────────
 *
 * The student page is a server component that renders six sibling cards, each
 * its own client island: the stage selector, the activities panel, the journeys
 * panel, the applications panel, the checklist, and the edit dialog (which
 * lives in the header). A requirement raised in the first has to be answered in
 * any of the others.
 *
 * Wrapping them in a context provider would mean making a client component the
 * parent of all six — which pulls the whole page across the server/client
 * boundary and hands the browser data it currently never sees. A single
 * `window` event costs nothing, needs no common ancestor, and the panels stay
 * independently mountable, which is how they are used elsewhere.
 *
 * The trade-off, stated plainly: this is fire-and-forget. If no panel is
 * listening — a requirement pointing at a card that is not on screen — the
 * click does nothing. `LEAD_FOCUS_HANDLED` is the acknowledgement that lets the
 * caller notice and say so, rather than leaving a button that silently fails.
 */

export const LEAD_FOCUS_EVENT = "illume:lead-focus";

/** Dispatched back by whichever panel acted on a request. */
export const LEAD_FOCUS_HANDLED = "illume:lead-focus-handled";

export function requestLeadFocus(target: RequirementTarget): void {
  window.dispatchEvent(new CustomEvent(LEAD_FOCUS_EVENT, { detail: target }));
}

export function acknowledgeLeadFocus(target: RequirementTarget): void {
  window.dispatchEvent(new CustomEvent(LEAD_FOCUS_HANDLED, { detail: target }));
}

/**
 * Runs `handler` for every focus request.
 *
 * The handler is held in a ref so that a panel does not have to memoise it —
 * passing a fresh closure each render would otherwise detach and reattach the
 * listener on every render, and a request arriving in that window is lost.
 */
export function useLeadFocus(handler: (target: RequirementTarget) => void): void {
  const ref = React.useRef(handler);
  ref.current = handler;

  React.useEffect(() => {
    const onEvent = (e: Event) => {
      const target = (e as CustomEvent<RequirementTarget>).detail;
      if (target) ref.current(target);
    };
    window.addEventListener(LEAD_FOCUS_EVENT, onEvent);
    return () => window.removeEventListener(LEAD_FOCUS_EVENT, onEvent);
  }, []);
}

/**
 * Scrolls a field into view, focuses it and flashes a ring around it.
 *
 * ── WHY IT RETRIES ──────────────────────────────────────────────────────────
 *
 * Every caller is opening something at the same moment: a dialog that mounts on
 * the next frame, or a collapsed section that has to fetch before it renders
 * its inputs. The element is reliably absent when the request arrives, so a
 * single `querySelector` finds nothing and the button appears to do nothing.
 * Polling briefly is what makes "click the requirement, land on the field" work
 * in all three cases without each caller inventing its own wait.
 *
 * Returns a cleanup function; callers in an effect should use it, or a pending
 * poll will touch an unmounted tree.
 */
export function focusFieldWhenReady(
  field: string,
  options: { timeoutMs?: number; root?: () => ParentNode | null } = {}
): () => void {
  const { timeoutMs = 2500, root } = options;
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const attempt = () => {
    if (cancelled) return;
    const scope = root?.() ?? document;
    const el = scope.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // The wrapper carries the marker; the control inside it takes the cursor.
      const control = el.matches("input, select, textarea, button")
        ? el
        : el.querySelector<HTMLElement>("input, select, textarea, [role='combobox'], button");
      // `preventScroll` because focus() would otherwise jump instantly and
      // fight the smooth scroll above, landing the field at the very top.
      control?.focus({ preventScroll: true });
      el.setAttribute("data-field-flash", "true");
      timer = setTimeout(() => el.removeAttribute("data-field-flash"), 2000);
      return;
    }
    if (Date.now() - started > timeoutMs) return;
    timer = setTimeout(attempt, 60);
  };

  attempt();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
