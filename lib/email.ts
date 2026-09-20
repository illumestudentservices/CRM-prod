import { stageHex, stageLabel } from "@/lib/lead-pipeline";
import { kpiNum, kpiPct, kpiMoney, type PartialKpi } from "@/lib/kpi-format";

const BREVO_API_KEY = process.env.BREVO_API_KEY ?? "";
const FROM_EMAIL = process.env.EMAIL_FROM_ADDRESS ?? "noreply@illumestudentservices.cloud";
const FROM_NAME = process.env.EMAIL_FROM_NAME ?? "Illume Student Advisory Services";
const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

// ─── Safe send wrapper (Brevo Transactional API) ──────────────────────────────

/**
 * Returns whether the mail was accepted by the provider.
 *
 * The name is the contract: this never throws, so a failed notification cannot
 * take down the request that triggered it. Almost every caller wants exactly
 * that and ignores the return value.
 *
 * A caller that is telling the user "we have sent you something" — the MFA code
 * is the one that matters — MUST check it. Saying "check your email" when
 * nothing left the building strands someone on a screen waiting for a code that
 * is never coming, and before this returned anything there was no way to tell.
 */
export async function safeSend(opts: {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: Array<{ name: string; content: string }>;
}): Promise<boolean> {
  if (!BREVO_API_KEY) {
    console.log(`[email] Skipped (no BREVO_API_KEY) — to: ${opts.to}, subject: ${opts.subject}`);
    return false;
  }
  let allAccepted = true;
  try {
    const toArr = Array.isArray(opts.to) ? opts.to : [opts.to];
    for (const recipient of toArr) {
      const payload: Record<string, unknown> = {
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: recipient }],
        subject: opts.subject,
        htmlContent: opts.html,
      };
      if (opts.attachments?.length) {
        payload.attachment = opts.attachments.map((a) => ({
          name: a.name,
          content: a.content,
        }));
      }
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error(`[email] Brevo error (${res.status}):`, err);
        allAccepted = false;
      }
    }
  } catch (err) {
    console.error("[email] Send failed:", err);
    allAccepted = false;
  }
  return allAccepted;
}

// ─── Shared primitives ─────────────────────────────────────────────────────────

/**
 * ─── HOUSE RULES FOR EVERY TEMPLATE BELOW ───────────────────────────────────
 *
 * Email is not the web. Outlook on Windows renders with the WORD engine, and
 * Gmail strips much of what a browser accepts. Everything here obeys:
 *
 *   NO <svg>            — Gmail strips it outright; Outlook cannot draw it.
 *   NO linear-gradient  — unsupported in Outlook; a gradient behind white text
 *                         collapses to a white background and the text vanishes.
 *   NO box-shadow       — silently dropped, so it must never carry meaning.
 *   NO 8-digit hex      — "#1E3A5F20" is invalid in Outlook and several others.
 *   NO opacity fades    — rgba() on a background is unreliable; a "faded" logo
 *                         is exactly what that produces.
 *   bgcolor ALONGSIDE   — Outlook honours the HTML attribute more reliably than
 *   the CSS background    the CSS property, so colour-critical cells carry both.
 *   Absolute image URLs — a relative /logo.png resolves against the mail client,
 *                         not the app, and renders as a broken image.
 *
 * Fonts are a stack ending in a generic family: Outlook falls back to Times if
 * the list has no serif/sans-serif terminator, which is where "unprofessional"
 * usually comes from.
 */
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const NAVY = "#1E3A5F";
const INK = "#0F172A";
const BODY_TEXT = "#475569";
const MUTED = "#64748B";
const HAIRLINE = "#E2E8F0";
const PANEL = "#F8FAFC";

/**
 * A status pill.
 *
 * `background:${color}20` used to append an alpha pair to the hex. That is a
 * CSS Color 4 notation Outlook does not implement, so the declaration was
 * dropped and the pill lost its fill. A solid panel with a coloured border and
 * coloured text reads the same everywhere and cannot fail that way.
 */
export function badge(text: string, color: string) {
  return `<span style="display:inline-block;background:${PANEL};color:${color};font-family:${FONT};font-size:12px;font-weight:600;line-height:1;padding:5px 11px;border-radius:100px;border:1px solid ${color};mso-line-height-rule:exactly;">${text}</span>`;
}

export function infoRow(label: string, value: string) {
  return `<tr>
    <td style="padding:11px 16px;font-family:${FONT};font-size:13px;color:${MUTED};font-weight:600;white-space:nowrap;border-bottom:1px solid ${HAIRLINE};vertical-align:top;">${label}</td>
    <td style="padding:11px 16px;font-family:${FONT};font-size:13px;color:${INK};border-bottom:1px solid ${HAIRLINE};vertical-align:top;">${value}</td>
  </tr>`;
}

export function infoTable(rows: [string, string][]) {
  // `overflow:hidden` to clip the corner radius does nothing in most clients,
  // so the border is put on the table itself rather than relying on the clip.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${PANEL}" style="background:${PANEL};border-radius:10px;width:100%;margin:18px 0 26px;border:1px solid ${HAIRLINE};border-collapse:separate;">
    <tbody>${rows.map(([l, v]) => infoRow(l, v)).join("")}</tbody>
  </table>`;
}

/**
 * A bulletproof call-to-action.
 *
 * Built as a table with `bgcolor` on the cell, not a styled <a>. Outlook
 * ignores padding and background on an inline anchor, which turned the button
 * into a bare blue link — the single most common way a transactional email
 * looks amateurish.
 */
export function ctaButton(text: string, href: string, color = NAVY) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 6px;">
    <tr>
      <td align="center" bgcolor="${color}" style="background:${color};border-radius:8px;">
        <a href="${href}" style="display:inline-block;padding:14px 34px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;mso-padding-alt:14px 34px;">${text}</a>
      </td>
    </tr>
  </table>`;
}

// ─── Standard branded wrapper ──────────────────────────────────────────────────

/**
 * The shared frame every email in this file is built on.
 *
 * ★ WHY THE LOGO LOOKED FADED, AND WHY THE HEADER IS NOW WHITE.
 *
 * The old header stacked four separate problems:
 *
 *   1. It was NOT the Illume logo. It was a generic shield-and-tick drawn
 *      inline, so nothing recognisably Illume ever reached the recipient.
 *   2. That shield carried `fill-opacity="0.9"`, sitting on an
 *      `rgba(255,255,255,0.18)` tile, beside a tagline at 60% white. Literally
 *      faded, three times over.
 *   3. It was an inline <svg>. GMAIL STRIPS SVG ENTIRELY and Outlook cannot
 *      render it, so for most recipients the mark was simply absent — an empty
 *      translucent square where a logo should be.
 *   4. The band behind it was a `linear-gradient`, which OUTLOOK DOES NOT
 *      SUPPORT. The declaration is dropped, the cell falls back to white, and
 *      the white wordmark on top becomes invisible.
 *
 * The fix is to stop fighting the constraint. `public/logo.png` is dark navy
 * on transparent — it is drawn for a LIGHT background, which is also why the
 * app rebuilt it as SVG for its dark sidebar. So the header band is now white
 * and carries the real asset as a hosted PNG with explicit width and height.
 * Brand presence comes from a navy rule beneath it, which every client can draw.
 *
 * The URL must be absolute: a relative path resolves against the mail client,
 * not the app. It is publicly reachable — proxy.ts's matcher excludes image
 * extensions, so an anonymous fetch from an inbox returns 200.
 */
export function wrapEmail(title: string, body: string, preheader?: string): string {
  const logoUrl = `${BASE_URL}/logo.png`;
  const year = new Date().getFullYear();

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${title}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, a { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style type="text/css">
    /* Stops iOS turning dates and phone numbers into unstyled blue links. */
    a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
    @media only screen and (max-width:620px) {
      .wrap { width:100% !important; }
      .pad  { padding:24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:${FONT};-webkit-font-smoothing:antialiased;">
  <!-- Inbox preview line. Hidden in the body, shown beside the subject. Without
       it, clients pull the first words of the content, which is usually "Hi". -->
  <div style="display:none;font-size:1px;color:#F1F5F9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader ?? title}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F1F5F9" style="background:#F1F5F9;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

          <!-- Header: white, so the navy wordmark is legible everywhere. -->
          <tr>
            <td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:12px 12px 0 0;padding:26px 36px 20px;border:1px solid ${HAIRLINE};border-bottom:none;">
              <img src="${logoUrl}" width="150" height="44" alt="Illume Student Advisory Services"
                   style="display:block;border:0;outline:none;text-decoration:none;height:44px;width:150px;max-width:150px;" />
            </td>
          </tr>
          <!-- Brand rule. A solid cell, not a gradient, so Outlook draws it. -->
          <tr>
            <td bgcolor="${NAVY}" style="background:${NAVY};height:3px;line-height:3px;font-size:0;">&nbsp;</td>
          </tr>

          <tr>
            <td class="pad" bgcolor="#FFFFFF" style="background:#FFFFFF;padding:32px 36px 36px;border:1px solid ${HAIRLINE};border-top:none;border-radius:0 0 12px 12px;color:${BODY_TEXT};font-family:${FONT};font-size:15px;line-height:1.65;">
              ${body}
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:22px 16px 0;font-family:${FONT};">
              <p style="color:${MUTED};font-size:12px;line-height:1.6;margin:0;">
                &copy; ${year} Illume Student Advisory Services
              </p>
              <p style="color:#94A3B8;font-size:11px;line-height:1.6;margin:6px 0 0;">
                This is an automated message — please do not reply to this address.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── 1. ONBOARDING EMAIL (fancy) ───────────────────────────────────────────────

export async function sendWelcomeEmail(opts: {
  to: string;
  name: string;
  employeeId: string;
  jobTitle: string;
  magicLinkUrl: string;
}) {
  const firstName = opts.name.split(" ")[0];

  /**
   * Built on wrapEmail like every other template.
   *
   * This used to be a SECOND bespoke document, repeating the gradient header,
   * the inline-SVG logo and the rgba fades — so a fix to the shared frame left
   * the onboarding email, the first thing a new joiner ever sees, still broken.
   * It also used `${color}15` step markers: an 8-digit hex Outlook drops, which
   * left the numbers unreadable on white.
   */
  const steps: [string, string, string][] = [
    ["1", "Set your password", "Use the secure link above to create your own password."],
    ["2", "Sign in to your account", "Use your email address and new password to sign in."],
    ["3", "Complete your profile", "Add your photo and fill in any missing details."],
    ["4", "Explore the platform", "Check your dashboard and tasks, and get familiar with your workspace."],
  ];

  const html = wrapEmail(
    "Welcome to Illume",
    `
      <h1 style="margin:0 0 10px;font-family:${FONT};font-size:24px;font-weight:700;color:${INK};line-height:1.3;">
        Welcome to Illume, ${firstName}
      </h1>
      <p style="margin:0 0 24px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BODY_TEXT};">
        Your account has been created. Set a password below and you can sign in straight away.
      </p>

      ${infoTable([
        ["Employee ID", opts.employeeId],
        ["Job title", opts.jobTitle],
        ["Email", opts.to],
      ])}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F0F9FF" style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;margin:0 0 28px;">
        <tr>
          <td align="center" style="padding:26px 24px;font-family:${FONT};">
            <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0C4A6E;">Set your password</p>
            <p style="margin:0 0 4px;font-size:13px;line-height:1.6;color:#0369A1;">
              This link expires in 72 hours.
            </p>
            ${ctaButton("Set My Password", opts.magicLinkUrl)}
          </td>
        </tr>
      </table>

      <p style="margin:0 0 14px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};">
        Getting started
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;">
        ${steps.map(([num, title, desc]) => `
        <tr>
          <td width="32" valign="top" style="padding:0 0 16px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="26" height="26" align="center" valign="middle" bgcolor="${NAVY}"
                    style="background:${NAVY};border-radius:13px;font-family:${FONT};font-size:12px;font-weight:700;color:#ffffff;line-height:26px;mso-line-height-rule:exactly;">${num}</td>
              </tr>
            </table>
          </td>
          <td valign="top" style="padding:0 0 16px 12px;font-family:${FONT};">
            <div style="font-size:14px;font-weight:600;color:${INK};margin-bottom:2px;">${title}</div>
            <div style="font-size:13px;line-height:1.55;color:${MUTED};">${desc}</div>
          </td>
        </tr>`).join("")}
      </table>

      <p style="margin:0;font-family:${FONT};font-size:12px;color:${MUTED};">
        Having trouble? Contact your HR manager for assistance.
      </p>
    `,
    `Set your password and sign in — your Illume account is ready.`
  );

  await safeSend({
    to: opts.to,
    // No emoji in the subject: it reads as marketing, and several corporate
    // filters score it accordingly. This is an account-credentials email.
    subject: `Welcome to Illume — set your password, ${firstName}`,
    html,
  });
}

// ─── 2. PASSWORD RESET ────────────────────────────────────────────────────────
//
// sendPasswordResetEmail was removed 2026-08-18. It put the new password in the
// body of the email in plaintext, which leaves a working credential sitting in
// a mailbox and in every relay that handled it, with no expiry and no way to
// revoke it. Nothing called it — both admin resets and self-service go through
// sendMagicLinkEmail, which sends a single-use, expiring link and lets the user
// choose their own password. Left as a note so it does not get reintroduced by
// someone looking for "the password reset email".

// ─── 3. SECURITY ALERT ────────────────────────────────────────────────────────

export async function sendSecurityAlertEmail(opts: {
  to: string | string[];
  alertType:
    | "ROLE_CHANGED"
    | "ACCOUNT_DEACTIVATED"
    | "ACCOUNT_REACTIVATED"
    | "USER_CREATED"
    | "PASSWORD_RESET"
    | "MFA_ENABLED";
  targetName: string;
  targetEmail: string;
  changedBy: string;
  details?: Record<string, string>;
  actionUrl?: string;
}) {
  const configs = {
    ROLE_CHANGED: {
      subject: `Security Alert: Role Changed — ${opts.targetName}`,
      title: "User Role Changed",
      icon: "🔑",
      color: "#F59E0B",
      description: `A user's system role has been modified.`,
    },
    ACCOUNT_DEACTIVATED: {
      subject: `Security Alert: Account Deactivated — ${opts.targetName}`,
      title: "Account Deactivated",
      icon: "🚫",
      color: "#EF4444",
      description: `A user account has been deactivated and can no longer sign in.`,
    },
    ACCOUNT_REACTIVATED: {
      subject: `Security Alert: Account Reactivated — ${opts.targetName}`,
      title: "Account Reactivated",
      icon: "✅",
      color: "#22C55E",
      description: `A previously deactivated user account has been reactivated.`,
    },
    USER_CREATED: {
      subject: `Security Alert: New User Created — ${opts.targetName}`,
      title: "New User Account Created",
      icon: "👤",
      color: "#0EA5E9",
      description: `A new user account has been created on the platform.`,
    },
    PASSWORD_RESET: {
      subject: `Security Alert: Password Reset — ${opts.targetName}`,
      title: "Password Reset",
      icon: "🔒",
      color: "#8B5CF6",
      description: `A user's password has been reset by an administrator.`,
    },
    // Spec pentest H-2 (2026-08-10) — MFA enrolment is a high-value security
    // event; the account owner must see a record of it even when they were
    // the enroller, because a stolen session is otherwise silent.
    MFA_ENABLED: {
      subject: `Security Alert: Two-factor authentication enabled — ${opts.targetName}`,
      title: "Two-Factor Authentication Enabled",
      icon: "🛡️",
      color: "#10B981",
      description: `Two-factor authentication was just enabled on this account. If this wasn't you, contact your administrator immediately — your password may be compromised.`,
    },
  };

  const cfg = configs[opts.alertType];
  const timestamp = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  await safeSend({
    to: opts.to,
    subject: cfg.subject,
    html: wrapEmail(
      cfg.title,
      `
      <!-- Alert banner.
           The fill and border were written as an 8-digit hex (colour plus two
           alpha digits). Outlook does not parse that, so the banner lost both
           and the alert stopped looking like an alert. It also used
           display:flex, which Outlook ignores entirely, dropping the icon and
           the text onto separate lines. A two-cell table does the same job
           everywhere, with a solid tint and a full-strength border. -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PANEL}" style="background:${PANEL};border:1px solid ${cfg.color};border-radius:10px;margin:0 0 28px;">
        <tr>
          <td width="34" valign="top" style="padding:16px 0 16px 18px;font-size:22px;line-height:1.1;">${cfg.icon}</td>
          <td valign="top" style="padding:16px 20px 16px 10px;font-family:${FONT};">
            <div style="font-size:15px;font-weight:700;color:${cfg.color};margin-bottom:3px;">${cfg.title}</div>
            <div style="font-size:13px;line-height:1.55;color:${MUTED};">${cfg.description}</div>
          </td>
        </tr>
      </table>

      <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">
        The following security event was recorded on the Illume platform. Please review and take action if this was not authorised.
      </p>

      ${infoTable([
        ["Affected User", `<strong>${opts.targetName}</strong>`],
        ["Email", opts.targetEmail],
        ["Action By", opts.changedBy],
        ["Timestamp", timestamp],
        // A blank row per detail used to be spread in here from a leftover
        // `detailRows.map(() => ["", ""])`, directly above the real details —
        // so every alert rendered an empty stripe for each field it reported.
        ...(opts.details ? (Object.entries(opts.details) as [string, string][]) : []),
      ])}

      ${opts.actionUrl ? ctaButton("Review in Admin Panel", opts.actionUrl, cfg.color) : ""}

      <div style="margin-top:24px;padding:14px 18px;background:#f8fafc;border-radius:8px;border-left:3px solid ${cfg.color};font-size:12px;color:#64748b;line-height:1.6;">
        <strong style="color:#475569;">This is an automated security notification.</strong><br/>
        If you did not authorise this action, please investigate immediately and consider suspending the responsible account.
      </div>
      `
    ),
  });
}

// ─── 3. LEAD STAGE CHANGE ─────────────────────────────────────────────────────

export async function sendLeadStageChangeEmail(opts: {
  to: string;
  icrName: string;
  leadName: string;
  previousStage: string;
  newStage: string;
  changedBy: string;
  note?: string;
  leadUrl: string;
}) {
  // Labels and colours come from lib/lead-pipeline.ts.
  const color = stageHex(opts.newStage);

  await safeSend({
    to: opts.to,
    subject: `Lead Update: ${opts.leadName} moved to ${stageLabel(opts.newStage)}`,
    html: wrapEmail("Lead Stage Update", `
      <h2 style="color:#1E3A5F;font-size:22px;font-weight:700;margin:0 0 8px;">Lead Stage Updated</h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${opts.icrName}, a lead assigned to you has had their stage updated.</p>
      ${infoTable([
        ["Student", opts.leadName],
        ["Previous Stage", stageLabel(opts.previousStage)],
        ["New Stage", badge(stageLabel(opts.newStage), color)],
        ["Updated By", opts.changedBy],
        ...(opts.note ? [["Note", opts.note] as [string, string]] : []),
      ])}
      ${ctaButton("View Lead", opts.leadUrl)}
    `),
  });
}

// ─── 4. REPORT SUBMITTED ──────────────────────────────────────────────────────

export async function sendReportSubmittedEmail(opts: {
  to: string;
  rmName: string;
  icrName: string;
  institutionName: string;
  period: string;
  reportUrl: string;
}) {
  await safeSend({
    to: opts.to,
    subject: `Report Submitted for Review — ${opts.icrName} / ${opts.period}`,
    html: wrapEmail("Report Submitted", `
      <h2 style="color:#1E3A5F;font-size:22px;font-weight:700;margin:0 0 8px;">New Report Ready for Review</h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${opts.rmName}, a monthly report has been submitted and is awaiting your review.</p>
      ${infoTable([
        ["ICR", opts.icrName],
        ["Institution", opts.institutionName],
        ["Period", opts.period],
        ["Status", badge("Pending Review", "#f59e0b")],
      ])}
      ${ctaButton("Review Report", opts.reportUrl)}
    `),
  });
}

// ─── 5. REPORT STATUS ─────────────────────────────────────────────────────────

export async function sendReportStatusEmail(opts: {
  to: string;
  icrName: string;
  institutionName: string;
  period: string;
  action: "REGIONAL_APPROVED" | "FINAL_APPROVED" | "RETURNED";
  comment?: string;
  reportUrl: string;
}) {
  const configs = {
    REGIONAL_APPROVED: {
      subject: `Report Regionally Approved — ${opts.period}`,
      title: "Report Regionally Approved",
      body: `Your monthly report for <strong>${opts.institutionName}</strong> (${opts.period}) has been approved by your Regional Manager and forwarded to HQ for final review.`,
      statusBadge: badge("Regionally Approved", "#3b82f6"),
    },
    FINAL_APPROVED: {
      subject: `Report Finally Approved — ${opts.period}`,
      title: "Report Finally Approved",
      body: `Great news, ${opts.icrName}! Your monthly report for <strong>${opts.institutionName}</strong> (${opts.period}) has received final approval from HQ.`,
      statusBadge: badge("Finally Approved", "#22c55e"),
    },
    RETURNED: {
      subject: `Report Returned for Revision — ${opts.period}`,
      title: "Report Needs Revision",
      body: `Your monthly report for <strong>${opts.institutionName}</strong> (${opts.period}) has been returned and requires revision before resubmission.`,
      statusBadge: badge("Returned", "#ef4444"),
    },
  };

  const cfg = configs[opts.action];

  await safeSend({
    to: opts.to,
    subject: cfg.subject,
    html: wrapEmail(cfg.title, `
      <h2 style="color:#1E3A5F;font-size:22px;font-weight:700;margin:0 0 8px;">${cfg.title}</h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${opts.icrName},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">${cfg.body}</p>
      ${infoTable([
        ["Institution", opts.institutionName],
        ["Period", opts.period],
        ["Status", cfg.statusBadge],
        ...(opts.comment ? [["Reviewer Comment", opts.comment] as [string, string]] : []),
      ])}
      ${ctaButton("View Report", opts.reportUrl)}
    `),
  });
}

// ─── 5b. ICR MONTHLY REPORT (rep-wise) ────────────────────────────────────────
//
// Separate from the two senders above because those name an institution in the
// subject and the body, and the ICR monthly report does not have one — it is
// the rep's whole month across every school they cover. Reusing them would mean
// emailing a manager about an institution called "All institutions".

export async function sendIcrReportSubmittedEmail(opts: {
  to: string;
  rmName: string;
  icrName: string;
  period: string;
  institutionCount: number;
  reportUrl: string;
}) {
  await safeSend({
    to: opts.to,
    subject: `ICR Monthly Report Submitted — ${opts.icrName} / ${opts.period}`,
    html: wrapEmail("ICR Monthly Report Submitted", `
      <h2 style="color:#1E3A5F;font-size:22px;font-weight:700;margin:0 0 8px;">Monthly Report Ready for Review</h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${opts.rmName}, ${opts.icrName} has submitted their monthly report and it is awaiting your review.</p>
      ${infoTable([
        ["ICR", opts.icrName],
        ["Period", opts.period],
        ["Institutions covered", String(opts.institutionCount)],
        ["Status", badge("Pending Review", "#f59e0b")],
      ])}
      ${ctaButton("Review Report", opts.reportUrl)}
    `),
  });
}

export async function sendIcrReportStatusEmail(opts: {
  to: string;
  icrName: string;
  period: string;
  action: "APPROVED" | "RETURNED";
  comment?: string;
  reportUrl: string;
}) {
  const approved = opts.action === "APPROVED";
  const title = approved ? "Monthly Report Approved" : "Monthly Report Needs Revision";
  const body = approved
    ? `Your monthly report for <strong>${opts.period}</strong> has been approved by your Regional Manager.`
    : `Your monthly report for <strong>${opts.period}</strong> has been returned and needs revision before you resubmit it.`;

  await safeSend({
    to: opts.to,
    subject: approved
      ? `Monthly Report Approved — ${opts.period}`
      : `Monthly Report Returned — ${opts.period}`,
    html: wrapEmail(title, `
      <h2 style="color:#1E3A5F;font-size:22px;font-weight:700;margin:0 0 8px;">${title}</h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${opts.icrName},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">${body}</p>
      ${infoTable([
        ["Period", opts.period],
        ["Status", approved ? badge("Approved", "#22c55e") : badge("Returned", "#ef4444")],
        ...(opts.comment ? [["Manager's comment", opts.comment] as [string, string]] : []),
      ])}
      ${ctaButton("View Report", opts.reportUrl)}
    `),
  });
}

// ─── 6. LEAVE DECISION ────────────────────────────────────────────────────────

export async function sendLeaveDecisionEmail(opts: {
  to: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  action: "APPROVED" | "REJECTED";
  note?: string;
  leaveUrl: string;
}) {
  const approved = opts.action === "APPROVED";
  await safeSend({
    to: opts.to,
    subject: `Leave Request ${approved ? "Approved" : "Rejected"} — ${opts.leaveType} Leave`,
    html: wrapEmail(`Leave ${approved ? "Approved" : "Rejected"}`, `
      <h2 style="color:#1E3A5F;font-size:22px;font-weight:700;margin:0 0 8px;">Leave Request ${approved ? "Approved" : "Rejected"}</h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${opts.employeeName}, your leave request has been ${approved ? "approved" : "rejected"}.</p>
      ${infoTable([
        ["Leave Type", opts.leaveType.replace(/_/g, " ")],
        ["From", opts.startDate],
        ["To", opts.endDate],
        ["Duration", `${opts.days} day${opts.days !== 1 ? "s" : ""}`],
        ["Decision", badge(approved ? "Approved" : "Rejected", approved ? "#22c55e" : "#ef4444")],
        ...(opts.note ? [["Reason", opts.note] as [string, string]] : []),
      ])}
      ${ctaButton("View Leave Details", opts.leaveUrl)}
    `),
  });
}

// ─── Leave applied — notify manager ───────────────────────────────────────────

export async function sendLeaveAppliedEmail(opts: {
  to: string;
  managerName: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string;
  leaveUrl: string;
}) {
  await safeSend({
    to: opts.to,
    subject: `Leave Request from ${opts.employeeName} — Action Required`,
    html: wrapEmail("Leave Request Pending Review", `
      <h2 style="color:#1E3A5F;font-size:22px;font-weight:700;margin:0 0 8px;">Leave Request — Action Required</h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${opts.managerName}, <strong>${opts.employeeName}</strong> has submitted a leave request that requires your review.</p>
      ${infoTable([
        ["Employee", opts.employeeName],
        ["Leave Type", opts.leaveType.replace(/_/g, " ")],
        ["From", opts.startDate],
        ["To", opts.endDate],
        ["Duration", `${opts.days} day${opts.days !== 1 ? "s" : ""}`],
        ["Status", badge("Pending Approval", "#f59e0b")],
        ...(opts.reason ? [["Reason", opts.reason] as [string, string]] : []),
      ])}
      ${ctaButton("Review Leave Request", opts.leaveUrl)}
    `),
  });
}

// ─── Account Locked ────────────────────────────────────────────────────────────

export async function sendAccountLockedEmail(opts: {
  to: string | string[];
  name: string;
  lockUntil: Date;
  isAdminAlert?: boolean;
  targetEmail?: string;
}) {
  const unlockTime = opts.lockUntil.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  if (opts.isAdminAlert) {
    await safeSend({
      to: opts.to,
      subject: `Security Alert: Account Locked — ${opts.name}`,
      html: wrapEmail("Account Locked — Security Alert", `
        <div style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:10px;padding:16px 20px;margin-bottom:28px;">
          <div style="font-size:20px;margin-bottom:6px;">🔒</div>
          <div style="font-size:15px;font-weight:700;color:#dc2626;margin-bottom:2px;">Account Temporarily Locked</div>
          <div style="font-size:13px;color:#991b1b;">An account has been locked due to ${MAX_FAILED_ATTEMPTS} consecutive failed login attempts.</div>
        </div>
        ${infoTable([
          ["Account", opts.name],
          ["Email", opts.targetEmail ?? ""],
          ["Locked Until", unlockTime],
          ["Reason", "Too many failed login attempts"],
        ])}
        <div style="padding:12px 16px;background:#f8fafc;border-radius:8px;border-left:3px solid #dc2626;font-size:12px;color:#64748b;line-height:1.6;">
          <strong>If this was not the account owner</strong>, an unauthorised party may be attempting to access this account. Consider reviewing recent activity.
        </div>
      `),
    });
  } else {
    await safeSend({
      to: opts.to,
      subject: `Your Illume account has been temporarily locked`,
      html: wrapEmail("Account Locked", `
        <div style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:10px;padding:16px 20px;margin-bottom:28px;">
          <div style="font-size:20px;margin-bottom:6px;">🔒</div>
          <div style="font-size:15px;font-weight:700;color:#dc2626;margin-bottom:2px;">Your account has been temporarily locked</div>
          <div style="font-size:13px;color:#991b1b;">Too many failed login attempts were detected.</div>
        </div>
        <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 20px;">
          Hi ${opts.name.split(" ")[0]}, your Illume account has been locked for 30 minutes after ${MAX_FAILED_ATTEMPTS} consecutive failed login attempts.
        </p>
        ${infoTable([
          ["Locked Until", unlockTime],
          ["Action Required", "Wait for the lockout to expire, then sign in with the correct password."],
        ])}
        <div style="padding:12px 16px;background:#fef9ec;border-radius:8px;border-left:3px solid #f59e0b;font-size:12px;color:#78350f;line-height:1.6;margin-top:16px;">
          <strong>Wasn't you?</strong> If you did not make these login attempts, your account credentials may be compromised. Contact your administrator immediately.
        </div>
      `),
    });
  }
}

const MAX_FAILED_ATTEMPTS = 5;

// ─── Magic Link (set password) ────────────────────────────────────────────────

export async function sendMagicLinkEmail(opts: {
  to: string;
  name: string;
  magicLinkUrl: string;
  expiryHours?: number;
  resetBy?: string;
}) {
  const firstName = opts.name.split(" ")[0];
  const expiry = opts.expiryHours ?? 24;

  await safeSend({
    to: opts.to,
    subject: opts.resetBy
      ? `Set your new Illume password`
      : `You're invited — set your Illume password`,
    html: wrapEmail("Set Your Password", `
      <div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px;padding:16px 20px;margin-bottom:28px;">
        <div style="font-size:20px;margin-bottom:6px;">🔗</div>
        <div style="font-size:15px;font-weight:700;color:#1d4ed8;margin-bottom:2px;">
          ${opts.resetBy ? "Password Reset Requested" : "Welcome to Illume"}
        </div>
        <div style="font-size:13px;color:#1e40af;">
          ${opts.resetBy
            ? `Your password was reset by <strong>${opts.resetBy}</strong>. Click the button below to set a new password.`
            : `Your account has been created. Click the button below to set your password and get started.`
          }
        </div>
      </div>

      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Hi ${firstName}, use the secure link below to set your password. This link is one-time use and expires in <strong>${expiry} hours</strong>.
      </p>

      <div style="text-align:center;padding:24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:28px;">
        <p style="margin:0 0 16px;font-size:13px;color:#64748b;">Click the button to set your password securely:</p>
        <!-- Was a styled <a> with a gradient: Outlook ignores both the
             background and the padding on an inline anchor, so the one action
             in a password email rendered as a bare blue link. -->
        ${ctaButton("Set My Password", opts.magicLinkUrl)}
        <p style="margin:14px 0 0;font-size:11px;color:#94a3b8;">
          Or copy this link: <span style="font-family:monospace;font-size:10px;word-break:break-all;">${opts.magicLinkUrl}</span>
        </p>
      </div>

      <div style="padding:12px 16px;background:#fef9ec;border-radius:8px;border-left:3px solid #f59e0b;font-size:12px;color:#78350f;line-height:1.6;">
        ⚠️ &nbsp;This link expires in ${expiry} hours and can only be used once. If you did not expect this email, contact your administrator.
      </div>
    `),
  });
}

// ─── MFA CODE ────────────────────────────────────────────────────────────────

/**
 * The sign-in code for accounts on the EMAIL second factor.
 *
 * Returns whether it was actually sent, because the caller tells the user to go
 * and look for it. Deliberately plainer than the rest of these templates: it is
 * read in a hurry, often on a phone, and the only thing that matters is the six
 * digits being big and unmistakable.
 *
 * There is NO link and no button, on purpose. Training people to click through
 * from a "security" email is how phishing lands, and this address receives a
 * password-reset link too — the two must not look alike.
 */
export async function sendMfaCodeEmail(opts: {
  to: string;
  name: string;
  code: string;
  expiryMinutes: number;
  ip?: string | null;
}): Promise<boolean> {
  const firstName = opts.name.split(" ")[0];
  return safeSend({
    to: opts.to,
    // The code is NOT in the subject: subjects show on a lock screen, and that
    // would put the second factor on the outside of a locked phone.
    subject: "Your Illume CRM sign-in code",
    html: wrapEmail("Sign-in code", `
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Hi ${firstName}, someone is signing in to Illume CRM with your email address and password. Enter this code to finish:
      </p>

      <div style="text-align:center;padding:28px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:28px;">
        <div style="font-family:'SFMono-Regular',Consolas,monospace;font-size:38px;font-weight:700;letter-spacing:0.18em;color:#1E3A5F;">
          ${opts.code}
        </div>
        <p style="margin:14px 0 0;font-size:12px;color:#64748b;">
          Expires in ${opts.expiryMinutes} minutes and can only be used once.
        </p>
      </div>

      ${opts.ip ? `<p style="margin:0 0 20px;font-size:12px;color:#64748b;">Requested from IP address ${opts.ip}.</p>` : ""}

      <div style="padding:12px 16px;background:#fef2f2;border-radius:8px;border-left:3px solid #ef4444;font-size:12px;color:#7f1d1d;line-height:1.6;">
        ⚠️ &nbsp;<strong>If you are not signing in right now, someone else has your password.</strong>
        Do not enter this code. Contact IT at
        <a href="mailto:it@illumestudentservices.ca" style="color:#7f1d1d;">it@illumestudentservices.ca</a>
        straight away and change your password.
      </div>

      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
        Illume will never ask you for this code by phone, email or message. Nobody at Illume needs it.
      </p>
    `),
  });
}

// ─── SEND SECTION EMAIL ──────────────────────────────────────────────────────

export async function sendSectionEmail(opts: {
  to: string;
  subject: string;
  sectionTitle: string;
  sectionHtml: string;
  message?: string;
  senderName?: string;
}) {
  const messageBlock = opts.message
    ? `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:13px;color:#0369A1;line-height:1.6;">${opts.senderName ? `<strong>${opts.senderName}</strong> says: ` : ""}${opts.message.replace(/\n/g, "<br>")}</p>
      </div>`
    : "";

  await safeSend({
    to: opts.to,
    subject: opts.subject,
    html: wrapEmail(opts.subject, `
      <h2 style="color:#1E3A5F;font-size:20px;font-weight:700;margin:0 0 16px;">${opts.sectionTitle}</h2>
      ${messageBlock}
      ${opts.sectionHtml}
    `),
  });
}

// ─── SEND FULL REPORT EMAIL ─────────────────────────────────────────────────

export async function sendFullReportEmail(opts: {
  to: string | string[];
  senderName?: string;
  icrName: string;
  institutionName: string;
  period: string;
  regionName: string;
  kpi: PartialKpi;
  engagementSummary?: string;
  successHighlight?: string;
  reportUrl: string;
  message?: string;
}) {
  const kpiGrid = opts.kpi
    ? `<table cellpadding="0" cellspacing="0" style="width:100%;margin:20px 0 24px;">
        <tr>
          <td style="width:33%;padding:8px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#1E3A5F;">${kpiNum(opts.kpi, "totalLeads")}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Total Leads</div>
            </div>
          </td>
          <td style="width:33%;padding:8px;">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#22C55E;">${kpiNum(opts.kpi, "enrolled")}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Enrolled</div>
            </div>
          </td>
          <td style="width:33%;padding:8px;">
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#0369A1;">${kpiPct(opts.kpi, "conversionRate")}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Conversion</div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="width:33%;padding:8px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#1E3A5F;">${kpiPct(opts.kpi, "contactRate")}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Contact Rate</div>
            </div>
          </td>
          <td style="width:33%;padding:8px;">
            <div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#F59E0B;">${kpiNum(opts.kpi, "eventsCount")}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Events</div>
            </div>
          </td>
          <td style="width:33%;padding:8px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#1E3A5F;">${kpiMoney(opts.kpi, "totalEventCost")}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Event Cost</div>
            </div>
          </td>
        </tr>
      </table>`
    : "";

  const messageBlock = opts.message
    ? `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:13px;color:#0369A1;line-height:1.6;">${opts.senderName ? `<strong>${opts.senderName}</strong> says: ` : ""}${opts.message.replace(/\n/g, "<br>")}</p>
      </div>`
    : "";

  const excerpts: string[] = [];
  if (opts.engagementSummary) {
    const text = opts.engagementSummary.length > 200 ? opts.engagementSummary.slice(0, 200) + "..." : opts.engagementSummary;
    excerpts.push(`<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">Engagement Highlights</div><p style="margin:0;font-size:13px;color:#475569;line-height:1.6;">${text}</p></div>`);
  }
  if (opts.successHighlight) {
    const text = opts.successHighlight.length > 200 ? opts.successHighlight.slice(0, 200) + "..." : opts.successHighlight;
    excerpts.push(`<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">Success Stories</div><p style="margin:0;font-size:13px;color:#475569;line-height:1.6;">${text}</p></div>`);
  }

  await safeSend({
    to: opts.to,
    subject: `Monthly Report — ${opts.institutionName} — ${opts.period}`,
    html: wrapEmail(`Monthly Report — ${opts.period}`, `
      <!-- SOLID navy with a bgcolor attribute, not a gradient. This block is
           partner-facing, and in Outlook an unsupported gradient falls back to
           white — which left the client's own name in white text on white.
           The rgba() greys are now solid tints for the same reason. -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${NAVY}" style="background:${NAVY};border-radius:12px;margin:0 0 28px;">
        <tr>
          <td style="padding:26px 30px;font-family:${FONT};">
            <h1 style="margin:0 0 5px;color:#ffffff;font-size:21px;font-weight:700;line-height:1.3;">${opts.institutionName}</h1>
            <p style="margin:0;color:#CBD5E1;font-size:14px;">${opts.period} Monthly Report</p>
            <p style="margin:9px 0 0;color:#94A3B8;font-size:12px;">ICR: ${opts.icrName} &middot; Region: ${opts.regionName}</p>
          </td>
        </tr>
      </table>

      ${messageBlock}

      ${kpiGrid}

      ${excerpts.length > 0 ? `<div style="border-top:1px solid #e2e8f0;padding-top:20px;margin-top:8px;">${excerpts.join("")}</div>` : ""}

      ${ctaButton("View Full Report", opts.reportUrl)}

      <p style="margin:20px 0 0;font-size:11px;color:#94a3b8;text-align:center;">
        This report was shared from the Illume CRM platform.
      </p>
    `),
  });
}

// ─── New account request — notify IT ──────────────────────────────────────────

export async function sendAccountRequestEmail(opts: {
  to: string | string[];
  fullName: string;
  /**
   * The joiner's PERSONAL address.
   *
   * Named personalEmail rather than `email` deliberately: while it was just
   * `email`, the template rendered it under a "Work email" heading long after
   * migration 025 renamed the column, so IT was shown a Gmail address labelled as
   * the work one. Offboarding is the mirror — there the address IS the work
   * mailbox, because it still exists and is about to be closed.
   */
  personalEmail: string;
  jobTitle: string;
  requestedRole: string;
  employmentType: string;
  startDate: string;
  region: string | null;
  department: string | null;
  phone: string | null;
  justification: string;
  requestedByName: string;
  requestedByEmail: string;
  reviewUrl: string;
}) {
  const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  await safeSend({
    to: opts.to,
    subject: `Account Request: ${opts.fullName} (${opts.jobTitle}) — Action Required`,
    html: wrapEmail("New Account Request", `
      <h2 style="color:#1E3A5F;font-size:22px;font-weight:700;margin:0 0 8px;">New Account Request</h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        <strong>${opts.requestedByName}</strong> has requested a portal account for a new joiner.
        Nothing has been created — review the details below and set the account up if you approve.
        Send the new credentials to the <strong>personal</strong> address below: their Illume
        mailbox does not exist yet, because creating it is the point of this request.
      </p>
      ${infoTable([
        ["Full name", opts.fullName],
        // Kept short: infoRow's label cell is `white-space:nowrap`, so a long
        // label widens the column and squeezes the value on a phone. The
        // "credentials go here" guidance lives in the prose above instead.
        ["Personal email", opts.personalEmail],
        ["Job title", opts.jobTitle],
        ["Requested role", label(opts.requestedRole)],
        ["Employment type", label(opts.employmentType)],
        ["Start date", opts.startDate],
        ...(opts.region ? [["Region", opts.region] as [string, string]] : []),
        ...(opts.department ? [["Department", opts.department] as [string, string]] : []),
        ...(opts.phone ? [["Phone", opts.phone] as [string, string]] : []),
        ["Requested by", `${opts.requestedByName} (${opts.requestedByEmail})`],
        ["Status", badge("Pending Review", "#f59e0b")],
      ])}
      <p style="color:#475569;font-size:14px;line-height:1.6;margin:16px 0 4px;"><strong>Justification</strong></p>
      <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;white-space:pre-wrap;">${opts.justification}</p>
      ${ctaButton("Review Request", opts.reviewUrl)}
    `),
  });
}

// ─── Account request decision — notify the requesting manager ─────────────────

export async function sendAccountRequestDecisionEmail(opts: {
  to: string;
  requesterName: string;
  candidateName: string;
  approved: boolean;
  notes?: string;
  requestUrl: string;
}) {
  await safeSend({
    to: opts.to,
    subject: `Account Request ${opts.approved ? "Approved" : "Declined"}: ${opts.candidateName}`,
    html: wrapEmail(`Account Request ${opts.approved ? "Approved" : "Declined"}`, `
      <h2 style="color:#1E3A5F;font-size:22px;font-weight:700;margin:0 0 8px;">
        Account Request ${opts.approved ? "Approved" : "Declined"}
      </h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Hi ${opts.requesterName}, your request for <strong>${opts.candidateName}</strong>
        ${opts.approved
          ? "has been approved. IT will create the account and the new joiner will receive their own onboarding email."
          : "has been declined."}
      </p>
      ${infoTable([
        ["New joiner", opts.candidateName],
        ["Decision", opts.approved ? badge("Approved", "#22c55e") : badge("Declined", "#ef4444")],
        ...(opts.notes ? [["Notes", opts.notes] as [string, string]] : []),
      ])}
      ${ctaButton("View Request", opts.requestUrl)}
    `),
  });
}

// ─── Offboarding request — notify IT ──────────────────────────────────────────

export async function sendOffboardingRequestEmail(opts: {
  to: string | string[];
  employeeName: string;
  employeeCode: string;
  workEmail: string;
  jobTitle: string;
  role: string;
  department: string | null;
  region: string | null;
  reason: string;
  lastWorkingDay: string;
  forwardingEmail: string | null;
  notes: string;
  revocationSteps: readonly string[];
  requestedByName: string;
  requestedByEmail: string;
  reviewUrl: string;
}) {
  const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  await safeSend({
    to: opts.to,
    subject: `Offboarding Request: ${opts.employeeName} — last day ${opts.lastWorkingDay}`,
    html: wrapEmail("Offboarding Request", `
      <h2 style="color:#1E3A5F;font-size:22px;font-weight:700;margin:0 0 8px;">Offboarding Request</h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        <strong>${opts.requestedByName}</strong> has raised a departure for a member of staff.
        No access has been changed — review the details below, then revoke it yourself if you approve.
      </p>
      ${infoTable([
        ["Employee", `${opts.employeeName} (${opts.employeeCode})`],
        ["Work email", opts.workEmail],
        ["Job title", opts.jobTitle],
        ["Portal role", label(opts.role)],
        ...(opts.department ? [["Department", opts.department] as [string, string]] : []),
        ...(opts.region ? [["Region", opts.region] as [string, string]] : []),
        ["Reason", label(opts.reason)],
        ["Last working day", opts.lastWorkingDay],
        ...(opts.forwardingEmail ? [["Forwarding email", opts.forwardingEmail] as [string, string]] : []),
        ["Requested by", `${opts.requestedByName} (${opts.requestedByEmail})`],
        ["Status", badge("Pending Review", "#f59e0b")],
      ])}
      <p style="color:#475569;font-size:14px;line-height:1.6;margin:16px 0 4px;"><strong>Context</strong></p>
      <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;white-space:pre-wrap;">${opts.notes}</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;margin:16px 0 4px;"><strong>Still to do by hand after approving</strong></p>
      <ul style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 16px;padding-left:20px;">
        ${opts.revocationSteps.map((s) => `<li>${s}</li>`).join("")}
      </ul>
      ${ctaButton("Review Request", opts.reviewUrl)}
    `),
  });
}

// ─── Offboarding decision — notify the requesting manager ─────────────────────

export async function sendOffboardingRequestDecisionEmail(opts: {
  to: string;
  requesterName: string;
  employeeName: string;
  lastWorkingDay: string;
  approved: boolean;
  notes?: string;
  requestUrl: string;
}) {
  await safeSend({
    to: opts.to,
    subject: `Offboarding Request ${opts.approved ? "Approved" : "Declined"}: ${opts.employeeName}`,
    html: wrapEmail(`Offboarding Request ${opts.approved ? "Approved" : "Declined"}`, `
      <h2 style="color:#1E3A5F;font-size:22px;font-weight:700;margin:0 0 8px;">
        Offboarding Request ${opts.approved ? "Approved" : "Declined"}
      </h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Hi ${opts.requesterName}, the departure you raised for <strong>${opts.employeeName}</strong>
        ${opts.approved
          ? "has been approved. IT will revoke their access and close the employee record."
          : "has been declined, so their access is unchanged."}
      </p>
      ${infoTable([
        ["Employee", opts.employeeName],
        ["Last working day", opts.lastWorkingDay],
        ["Decision", opts.approved ? badge("Approved", "#22c55e") : badge("Declined", "#ef4444")],
        ...(opts.notes ? [["Notes", opts.notes] as [string, string]] : []),
      ])}
      ${ctaButton("View Request", opts.requestUrl)}
    `),
  });
}

// ─── NEW STUDENT CAPTURED ─────────────────────────────────────────────────────

/**
 * Sent when an ICR captures a student, to the ICR and to their manager.
 *
 * ONE email covers the whole batch. A booth upload of forty students sends one
 * message listing forty, not forty messages — the useful signal is "work has
 * arrived", and repeating it forty times only teaches people to filter it.
 *
 * `isManagerCopy` changes only the greeting and the subject, so neither
 * recipient receives an email that reads as though it were written for the
 * other one.
 */
export async function sendNewLeadEmail(opts: {
  to: string;
  recipientName: string;
  icrName: string;
  isManagerCopy: boolean;
  /// Pre-formatted rows, so this template does no date or name logic itself.
  leads: Array<{
    name: string;
    detail: [string, string][];
    url: string;
    possibleDuplicate: boolean;
  }>;
  /// Present only for a booth upload, where individual rows can fail.
  batch?: { submitted: number; created: number; failed: number };
  listUrl: string;
}) {
  const n = opts.leads.length;
  if (n === 0) return;

  const single = n === 1;
  const who = opts.isManagerCopy ? `${opts.icrName} has` : "You have";
  const subject = single
    ? (opts.isManagerCopy
        ? `New student added by ${opts.icrName}: ${opts.leads[0].name}`
        : `New student added: ${opts.leads[0].name}`)
    : (opts.isManagerCopy
        ? `${n} new students added by ${opts.icrName}`
        : `${n} new students added`);

  // One student gets the full detail table. A batch gets a compact list —
  // forty stacked tables is not something anyone reads on a phone.
  const body = single
    ? `
      ${infoTable(opts.leads[0].detail)}
      ${opts.leads[0].possibleDuplicate
        ? `<p style="color:#966a0b;font-size:14px;margin:0 0 8px;">${badge("Possible duplicate", "#966a0b")} This student looks like one already on the system. Worth checking before any follow-up.</p>`
        : ""}
      ${ctaButton("View Student", opts.leads[0].url)}
    `
    : `
      ${opts.batch && opts.batch.failed > 0
        ? `<p style="color:#966a0b;font-size:14px;line-height:1.6;margin:0 0 16px;">${opts.batch.created} of ${opts.batch.submitted} students were saved. ${opts.batch.failed} could not be saved and are still on the device to send again.</p>`
        : ""}
      <table cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0 20px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <tbody>
          ${opts.leads.map((l, i) => `
            <tr style="background:${i % 2 ? "#ffffff" : "#f8fafc"};">
              <td style="padding:10px 14px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">
                <a href="${l.url}" style="color:#1E3A5F;text-decoration:none;font-weight:600;">${l.name}</a>
                ${l.possibleDuplicate ? ` ${badge("Possible duplicate", "#966a0b")}` : ""}
                <div style="color:#64748b;font-size:12.5px;margin-top:3px;">
                  ${l.detail.slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" &nbsp;·&nbsp; ")}
                </div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${ctaButton("View All Students", opts.listUrl)}
    `;

  await safeSend({
    to: opts.to,
    subject,
    html: wrapEmail("New Student Captured", `
      <h2 style="color:#1E3A5F;font-size:22px;font-weight:700;margin:0 0 8px;">
        ${single ? "New student captured" : `${n} new students captured`}
      </h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Hi ${opts.recipientName}, ${who} added ${single ? "a new student" : `${n} new students`} to the pipeline.
      </p>
      ${body}
    `),
  });
}

// ─── PUBLIC HOLIDAY REMINDER ──────────────────────────────────────────────────

/**
 * Advance notice that the office is closed.
 *
 * The date is spelled out in full rather than shown as a number. This goes to
 * India, Malaysia, Nigeria, China and the UK among others, where 12/07 reads as
 * two different days, and a closure notice is the worst place for that.
 */
export async function sendHolidayReminderEmail(opts: {
  to: string;
  recipientName: string;
  holidayName: string;
  /// Already formatted by lib/holiday-reminders.ts, so this template does no
  /// date logic of its own.
  holidayDate: string;
  daysAway: number;
  /// "Company-wide", or the region's name.
  scope: string;
  description?: string;
}) {
  await safeSend({
    to: opts.to,
    subject: `${opts.holidayName} — office closed on ${opts.holidayDate.replace(/^\w+,\s*/, "")}`,
    html: wrapEmail(
      "Upcoming Public Holiday",
      `
      <h1 style="margin:0 0 10px;font-family:${FONT};font-size:23px;font-weight:700;color:${INK};line-height:1.3;">
        ${opts.holidayName}
      </h1>
      <p style="margin:0 0 6px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BODY_TEXT};">
        Hi ${opts.recipientName}, this is a reminder that
        <strong style="color:${INK};">${opts.holidayDate}</strong> is a public holiday
        — ${opts.daysAway} days from today.
      </p>

      ${infoTable([
        ["Holiday", opts.holidayName],
        ["Date", opts.holidayDate],
        ["Applies to", opts.scope],
        ...(opts.description ? [["Details", opts.description] as [string, string]] : []),
      ])}

      <p style="margin:0 0 6px;font-family:${FONT};font-size:14px;line-height:1.65;color:${BODY_TEXT};">
        If you have anything due that day, please plan around it now — deadlines,
        student follow-ups and interviews will all need moving.
      </p>
      ${ctaButton("View the Holiday Calendar", `${BASE_URL}/hr`)}
      `,
      `${opts.holidayName} is ${opts.daysAway} days away — plan any deadlines around it.`
    ),
  });
}

// ─── DAILY REMINDER DIGEST ────────────────────────────────────────────────────

/**
 * One morning email listing everything in an area that needs a person.
 *
 * Deliberately a LIST, not one email per item. See lib/reminder-digest.ts for
 * why: the alternative delivers an ICR's entire backlog one message at a time
 * on the first run, and teaches them to filter the sender.
 *
 * The subject carries the count, so the inbox line is useful unopened —
 * "Student pipeline: 6 need attention" tells you whether to open it now.
 */
export async function sendReminderDigestEmail(opts: {
  to: string;
  recipientName: string;
  /// The area: "Student pipeline", "Tasks", "Clients".
  heading: string;
  /// One sentence explaining why this arrived.
  intro: string;
  items: Array<{ title: string; detail: string; url: string; urgent: boolean }>;
}) {
  const n = opts.items.length;
  if (n === 0) return;

  const urgent = opts.items.filter((i) => i.urgent).length;
  const subject =
    n === 1
      ? `${opts.heading}: 1 item needs attention`
      : `${opts.heading}: ${n} items need attention`;

  await safeSend({
    to: opts.to,
    subject,
    html: wrapEmail(
      opts.heading,
      `
      <h1 style="margin:0 0 10px;font-family:${FONT};font-size:23px;font-weight:700;color:${INK};line-height:1.3;">
        ${opts.heading}
      </h1>
      <p style="margin:0 0 4px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BODY_TEXT};">
        Hi ${opts.recipientName}, ${opts.intro}
      </p>
      ${urgent > 0
        ? `<p style="margin:0 0 4px;font-family:${FONT};font-size:14px;line-height:1.6;color:#B45309;">
             <strong>${urgent} of these ${urgent === 1 ? "is" : "are"} time-critical</strong> and ${urgent === 1 ? "is" : "are"} listed first.
           </p>`
        : ""}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px;border:1px solid ${HAIRLINE};border-radius:10px;">
        <tbody>
          ${opts.items.map((i, idx) => `
          <tr>
            <td bgcolor="${idx % 2 ? "#FFFFFF" : PANEL}" style="background:${idx % 2 ? "#FFFFFF" : PANEL};padding:12px 16px;border-bottom:1px solid ${HAIRLINE};font-family:${FONT};">
              <a href="${BASE_URL}${i.url}" style="color:${i.urgent ? "#B45309" : NAVY};text-decoration:none;font-size:14px;font-weight:600;">
                ${i.urgent ? "&#9679; " : ""}${i.title}
              </a>
              <div style="color:${MUTED};font-size:13px;line-height:1.5;margin-top:3px;">${i.detail}</div>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>

      <p style="margin:14px 0 0;font-family:${FONT};font-size:12px;color:${MUTED};">
        Each line links straight to the record. This summary is sent once a day,
        and only when there is something on it.
      </p>
      `,
      `${n} item${n === 1 ? "" : "s"} in ${opts.heading.toLowerCase()} need${n === 1 ? "s" : ""} attention.`
    ),
  });
}

// ─── ADMIN ALERT (serious, hard-to-undo actions) ──────────────────────────────

/**
 * Sent to every super admin when something consequential happens.
 *
 * Distinct from `sendSecurityAlertEmail`, which covers account and identity
 * events. This one covers data being destroyed, moved in bulk, or
 * re-permissioned — see lib/admin-alerts.ts for why that list is short.
 *
 * The wording leads with WHAT HAPPENED and WHY IT MATTERS, because the useful
 * question on receiving one of these at 21:00 is "do I need to act tonight",
 * and a bare action name does not answer it.
 */
export async function sendAdminAlertEmail(opts: {
  to: string;
  recipientName: string;
  title: string;
  why: string;
  summary: string;
  actorName: string;
  actorEmail: string;
  detail: [string, string][];
  link?: string;
  ip?: string | null;
}) {
  const when = new Date().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  await safeSend({
    to: opts.to,
    subject: `[Admin] ${opts.title} — by ${opts.actorName}`,
    html: wrapEmail(
      opts.title,
      `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PANEL}" style="background:${PANEL};border:1px solid #B45309;border-radius:10px;margin:0 0 24px;">
        <tr>
          <td style="padding:16px 20px;font-family:${FONT};">
            <div style="font-size:15px;font-weight:700;color:#B45309;margin-bottom:4px;">${opts.title}</div>
            <div style="font-size:13px;line-height:1.55;color:${MUTED};">${opts.why}</div>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 4px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BODY_TEXT};">
        Hi ${opts.recipientName}, ${opts.summary}
      </p>

      ${infoTable([
        ["Performed by", `${opts.actorName} (${opts.actorEmail})`],
        ["When", when],
        ...(opts.ip ? [["From", opts.ip] as [string, string]] : []),
        ...opts.detail,
      ])}

      ${opts.link ? ctaButton("Review in the app", `${BASE_URL}${opts.link}`) : ""}

      <p style="margin:18px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
        You are receiving this because you are a super administrator. If this
        was not expected, check the activity log and consider suspending the
        account that performed it.
      </p>
      `,
      `${opts.title} by ${opts.actorName} — ${opts.summary}`
    ),
  });
}

// ─── Helper: fetch all super admin emails ─────────────────────────────────────

export async function getSuperAdminEmails(): Promise<string[]> {
  const { db } = await import("@/lib/db");
  const admins = await db.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
    select: { email: true },
  });
  return admins.map((a) => a.email);
}
