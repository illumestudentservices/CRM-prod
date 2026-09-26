"use client";

import * as React from "react";
import { Mail, AlertTriangle, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * Opens the rep's OWN mail client with the student's address filled in.
 *
 * ★ DELIBERATELY NOT SENT BY THE APP.
 *
 * A `mailto:` hands the message to Outlook or Apple Mail, which means it leaves
 * from the rep's own mailbox: the student replies to a human rather than to
 * noreply@, the thread lands in that rep's Sent folder where they can find it,
 * and Illume's transactional sending domain is never used for one-to-one
 * conversation. Sending it server-side would cost all three.
 *
 * ★ THE CONSENT GATE IS THE POINT OF THIS COMPONENT.
 *
 * The obvious build is a one-line `<a href={mailto}>`. That is the version that
 * gets someone in trouble. This is a Canadian business emailing prospective
 * students, and the schema already records — carefully, three-valued — whether
 * each person agreed to be contacted:
 *
 *   doNotContact === true      a blanket instruction across every channel.
 *                              HARD BLOCK. Nothing here should make it one
 *                              click to ignore that.
 *
 *   marketingConsent === false they were asked about commercial email and said
 *                              no. WARN, do not block: CASL separates a
 *                              commercial message from answering someone who
 *                              approached you, and a rep replying about an
 *                              application is the service the student asked
 *                              for. The rep is told, and decides.
 *
 *   marketingConsent === null  nobody ever asked. No warning — a warning here
 *                              would be false, and warnings that are usually
 *                              wrong get clicked through, including the real
 *                              one above.
 */

export type EmailStudentProps = {
  email: string | null;
  studentName: string;
  doNotContact: boolean;
  /** Three-valued: null means the question was never put to them. */
  marketingConsent: boolean | null;
  /** Prefills the subject so a reply thread is identifiable later. */
  reference?: string | null;
};

export function EmailStudentButton({
  email,
  studentName,
  doNotContact,
  marketingConsent,
  reference,
}: EmailStudentProps) {
  const [confirming, setConfirming] = React.useState(false);

  // No address is a different state from "not allowed", and saying so saves a
  // rep opening the record to find out why the button did nothing.
  if (!email) {
    return (
      <Button variant="outline" size="sm" disabled className="w-full justify-start gap-2">
        <Mail className="h-3.5 w-3.5" />
        No email address on file
      </Button>
    );
  }

  if (doNotContact) {
    return (
      <div className="space-y-1.5">
        <Button variant="outline" size="sm" disabled className="w-full justify-start gap-2">
          <Ban className="h-3.5 w-3.5" />
          Do not contact
        </Button>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {studentName} has asked not to be contacted. Remove the instruction on
          their record first if that has genuinely changed.
        </p>
      </div>
    );
  }

  const subject = reference
    ? `Your application with Illume — ${reference}`
    : "Your enquiry with Illume";

  // encodeURIComponent, not a template literal: an ampersand or a hash in the
  // subject would otherwise be read as another mailto parameter and truncate it.
  const href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}`;

  const declined = marketingConsent === false;

  return (
    <>
      {/* A real anchor, not a button with `window.location = href`.
          Three reasons, and the first version had none of them: a link is
          reachable by keyboard and announced as a link; it can be
          right-clicked to copy the address; and its destination is visible in
          the DOM, so a test can assert WHERE it goes rather than only that a
          control exists. No target="_blank" — that is what would have left an
          empty tab behind once the mail handler takes over. */}
      {declined ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => setConfirming(true)}
        >
          <Mail className="h-3.5 w-3.5" />
          Email {studentName.split(" ")[0]}
          <AlertTriangle className="h-3.5 w-3.5 ml-auto text-amber-600" />
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm" className="w-full justify-start gap-2">
          <a href={href}>
            <Mail className="h-3.5 w-3.5" />
            Email {studentName.split(" ")[0]}
          </a>
        </Button>
      )}

      {declined && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
          They declined marketing email. Replies about their own application are
          still fine.
        </p>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>They declined marketing email</DialogTitle>
            <DialogDescription className="space-y-2 pt-1">
              <span className="block">
                {studentName} was asked whether Illume could send them marketing
                email and said no.
              </span>
              <span className="block">
                Replying about their own enquiry or application is still
                appropriate — that is the service they came to us for. Sending
                them promotional material is not.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button asChild size="sm">
              <a href={href} onClick={() => setConfirming(false)}>
                Open my email app
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The same rules, as an inline address for a table cell.
 *
 * The email column already showed the address as plain text, so making THAT
 * the affordance beats adding an actions column: the thing you click is the
 * thing you are acting on, and the table keeps its width.
 *
 * `stopPropagation` matters — the row itself navigates to the student, and
 * without it a click would open the record and the mail client at once.
 */
export function EmailStudentLink({
  email,
  doNotContact,
  marketingConsent,
}: {
  email: string | null;
  doNotContact: boolean;
  marketingConsent: boolean | null;
}) {
  if (!email) {
    return <span className="text-sm text-slate-400 dark:text-slate-600">—</span>;
  }

  // Shown, but not clickable. Hiding the address would be worse: a rep needs to
  // know who the record belongs to, they just must not one-click contact them.
  if (doNotContact) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 dark:text-slate-500 line-through decoration-slate-300"
        title="This student has asked not to be contacted"
      >
        <Ban className="h-3 w-3 shrink-0" />
        <span className="truncate">{email}</span>
      </span>
    );
  }

  const declined = marketingConsent === false;

  return (
    <a
      href={`mailto:${encodeURIComponent(email)}`}
      onClick={(e) => e.stopPropagation()}
      title={
        declined
          ? "They declined marketing email. Replies about their own application are still fine."
          : `Email ${email}`
      }
      className={[
        "inline-flex items-center gap-1.5 text-sm truncate hover:underline",
        declined
          ? "text-amber-700 dark:text-amber-400"
          : "text-slate-600 dark:text-slate-400 hover:text-[#1E3A5F] dark:hover:text-sky-400",
      ].join(" ")}
    >
      {declined && <AlertTriangle className="h-3 w-3 shrink-0" />}
      <span className="truncate">{email}</span>
    </a>
  );
}
