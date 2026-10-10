/**
 * Styling for the white card on the public auth pages.
 *
 * ★ THE FAULT THIS EXISTS TO CLOSE.
 *
 * /reset-password and /change-password draw a hard-coded `bg-white` card on a
 * dark gradient — that is the design, and it does not change with the theme.
 * Everything inside it, however, does. <Label> carries no colour at all, so in
 * dark mode it inherited the near-white page foreground and "New Password" and
 * "Confirm Password" disappeared into the card. <Input> carries
 * `dark:bg-slate-900`, so the fields became black slabs on white.
 *
 * A new joiner setting their password for the first time met two unlabelled
 * black boxes. Nothing was broken enough to notice in code review: both
 * components are correct on their own, and the page is correct in light mode.
 * It only fails where a light card meets dark-mode children.
 *
 * So the card pins its contents to light. These are applied at the call site
 * rather than baked into Input or Label, because the components are right as
 * they are — it is this one context that is the exception, and changing the
 * shared components to suit it would break every dark surface in the
 * dashboard.
 *
 * The `dark:` prefixes beat the component's own because Input composes with
 * cn(), and tailwind-merge lets the later class win.
 */

/** The card itself. Also sets a dark default colour for any bare text in it. */
export const AUTH_CARD =
  "bg-white rounded-2xl shadow-2xl p-8 text-slate-900";

/** Field labels. Without this they inherit, and in dark mode they vanish. */
export const AUTH_LABEL = "text-slate-700";

/** Inputs, held to the light palette whatever the theme says. */
export const AUTH_INPUT = [
  "dark:bg-white",
  "dark:text-slate-900",
  "dark:border-slate-200",
  "dark:placeholder:text-slate-400",
  "dark:focus-visible:ring-[#1E3A5F]",
  "dark:focus-visible:border-[#1E3A5F]",
].join(" ");
