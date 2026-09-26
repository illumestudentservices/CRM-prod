import { Mail } from "lucide-react";

/**
 * A contactable address, rendered as a `mailto:` so it opens the reader's own
 * mail client.
 *
 * ★ THIS COMPONENT IS FOR COLLEAGUES AND BUSINESS CONTACTS ONLY.
 *
 * It has NO consent gate, and that is deliberate — but it makes the component
 * dangerous in the wrong place. A STUDENT's address must never be rendered
 * through it. Students carry CASL consent on the record (`doNotContact`,
 * `marketingConsent`, three-valued and asked at capture) and have their own
 * component,
 * `app/(dashboard)/students/[id]/_components/email-student-button.tsx`, which
 * blocks or warns accordingly. Using this one for a Lead would silently make a
 * do-not-contact student one click away from being contacted.
 *
 * `kind` exists to keep that reasoning visible at every call site rather than
 * buried here, and to give a future consent field an obvious home:
 *
 *   "colleague"  another Illume user. No consent question arises at all.
 *
 *   "business"   a university contact, partner agent or school counsellor.
 *                None of those models carries consent data today, and under
 *                CASL an existing business relationship carries implied
 *                consent for messages about that relationship — which is the
 *                only reason a rep has the address. If any of those models
 *                ever gains an opt-out, this is where it gets read.
 */
export function EmailLink({
  email,
  kind,
  className,
  showIcon = false,
}: {
  email: string | null | undefined;
  /** Documents WHY no consent gate applies here. See the note above. */
  kind: "colleague" | "business";
  className?: string;
  showIcon?: boolean;
}) {
  if (!email) {
    return <span className={className ?? "text-slate-400 dark:text-slate-600"}>—</span>;
  }

  return (
    <a
      href={`mailto:${encodeURIComponent(email)}`}
      // The row or card around this is often itself a link or a click target;
      // without this, one click opens the record AND the mail client.
      onClick={(e) => e.stopPropagation()}
      title={kind === "colleague" ? `Email ${email}` : `Email ${email}`}
      className={[
        "inline-flex items-center gap-1.5 hover:underline",
        "hover:text-[#1E3A5F] dark:hover:text-sky-400 transition-colors",
        className ?? "",
      ].join(" ")}
    >
      {showIcon && <Mail className="h-3 w-3 shrink-0" aria-hidden />}
      <span className="truncate">{email}</span>
    </a>
  );
}
