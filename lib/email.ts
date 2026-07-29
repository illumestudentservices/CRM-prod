import { stageHex, stageLabel } from "@/lib/lead-pipeline";

const BREVO_API_KEY = process.env.BREVO_API_KEY ?? "";
const FROM_EMAIL = process.env.EMAIL_FROM_ADDRESS ?? "noreply@illumestudentservices.cloud";
const FROM_NAME = process.env.EMAIL_FROM_NAME ?? "Illume Student Advisory Services";
const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

// ─── Safe send wrapper (Brevo Transactional API) ──────────────────────────────

export async function safeSend(opts: {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: Array<{ name: string; content: string }>;
}) {
  if (!BREVO_API_KEY) {
    console.log(`[email] Skipped (no BREVO_API_KEY) — to: ${opts.to}, subject: ${opts.subject}`);
    return;
  }
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
      }
    }
  } catch (err) {
    console.error("[email] Send failed:", err);
  }
}

// ─── Shared primitives ─────────────────────────────────────────────────────────

export function badge(text: string, color: string) {
  return `<span style="display:inline-block;background:${color}20;color:${color};font-size:12px;font-weight:600;padding:3px 10px;border-radius:100px;border:1px solid ${color}40;">${text}</span>`;
}

export function infoRow(label: string, value: string) {
  return `<tr>
    <td style="padding:10px 14px;font-size:13px;color:#64748b;font-weight:500;white-space:nowrap;border-bottom:1px solid #f1f5f9;">${label}</td>
    <td style="padding:10px 14px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${value}</td>
  </tr>`;
}

export function infoTable(rows: [string, string][]) {
  return `<table cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;width:100%;margin:16px 0 24px;border:1px solid #e2e8f0;overflow:hidden;">
    <tbody>${rows.map(([l, v]) => infoRow(l, v)).join("")}</tbody>
  </table>`;
}

export function ctaButton(text: string, href: string, color = "#1E3A5F") {
  return `<div style="margin:28px 0 8px;">
    <a href="${href}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:13px 32px;border-radius:9px;letter-spacing:0.01em;">${text}</a>
  </div>`;
}

// ─── Standard branded wrapper ──────────────────────────────────────────────────

export function wrapEmail(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background:linear-gradient(135deg,#1E3A5F 0%,#0369A1 100%);border-radius:12px 12px 0 0;padding:24px 36px;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:middle;padding-right:10px;">
                <div style="width:34px;height:34px;background:rgba(255,255,255,0.18);border-radius:8px;text-align:center;line-height:34px;">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="white" fill-opacity="0.9"/>
                    <path d="M9 12l2 2 4-4" stroke="#7DD3FC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </td>
              <td style="vertical-align:middle;">
                <div style="color:white;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Illume</div>
                <div style="color:rgba(255,255,255,0.6);font-size:9px;letter-spacing:2.5px;text-transform:uppercase;font-weight:500;">Student Advisory Services</div>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px;border-radius:0 0 12px 12px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 0 0;text-align:center;">
            <p style="color:#94a3b8;font-size:11px;margin:0;">&copy; ${new Date().getFullYear()} Illume Student Advisory Services. All rights reserved.</p>
            <p style="color:#cbd5e1;font-size:10px;margin:5px 0 0;">This is an automated message — please do not reply directly to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
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

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Illume</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HERO HEADER -->
        <tr>
          <td style="border-radius:14px 14px 0 0;overflow:hidden;background:linear-gradient(135deg,#0f2647 0%,#1E3A5F 40%,#0369A1 100%);padding:48px 40px 40px;">
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td>
                  <!-- Logo -->
                  <table cellpadding="0" cellspacing="0"><tr>
                    <td style="vertical-align:middle;padding-right:10px;">
                      <div style="width:38px;height:38px;background:rgba(255,255,255,0.15);border-radius:10px;text-align:center;line-height:38px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;">
                          <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="white" fill-opacity="0.9"/>
                          <path d="M9 12l2 2 4-4" stroke="#7DD3FC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      </div>
                    </td>
                    <td style="vertical-align:middle;">
                      <div style="color:white;font-size:18px;font-weight:700;">Illume</div>
                      <div style="color:rgba(255,255,255,0.55);font-size:9px;letter-spacing:2.5px;text-transform:uppercase;">Student Advisory Services</div>
                    </td>
                  </tr></table>

                  <!-- Welcome text -->
                  <div style="margin-top:32px;">
                    <div style="display:inline-block;background:rgba(14,165,233,0.25);color:#7DD3FC;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;padding:4px 12px;border-radius:100px;border:1px solid rgba(125,211,252,0.3);margin-bottom:16px;">
                      You're officially onboard
                    </div>
                    <h1 style="margin:0 0 10px;color:#ffffff;font-size:30px;font-weight:800;letter-spacing:-0.5px;line-height:1.2;">
                      Welcome, ${firstName}! 👋
                    </h1>
                    <p style="margin:0;color:rgba(255,255,255,0.7);font-size:15px;line-height:1.6;max-width:420px;">
                      Your account has been created. Set your password to get started on the Illume platform.
                    </p>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- MAIN BODY -->
        <tr>
          <td style="background:#ffffff;padding:40px;border-radius:0 0 14px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.08);">

            <!-- ACCOUNT INFO CARD -->
            <div style="background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:32px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:16px;">Your Account Details</div>
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#64748b;width:140px;">Employee ID</td>
                  <td style="padding:6px 0;font-size:13px;font-weight:600;color:#1e293b;">${opts.employeeId}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#64748b;">Job Title</td>
                  <td style="padding:6px 0;font-size:13px;font-weight:600;color:#1e293b;">${opts.jobTitle}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#64748b;">Email</td>
                  <td style="padding:6px 0;font-size:13px;font-weight:600;color:#0369A1;">${opts.to}</td>
                </tr>
              </table>
            </div>

            <!-- SET PASSWORD CTA -->
            <div style="text-align:center;padding:28px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;margin-bottom:28px;">
              <div style="font-size:32px;margin-bottom:12px;">🔐</div>
              <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#0c4a6e;">Set Your Password</p>
              <p style="margin:0 0 20px;font-size:13px;color:#0369A1;line-height:1.5;">Click the button below to create your secure password. This link expires in 72 hours.</p>
              <a href="${opts.magicLinkUrl}" style="display:inline-block;background:linear-gradient(135deg,#1E3A5F,#0369A1);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:15px 40px;border-radius:10px;letter-spacing:0.02em;box-shadow:0 4px 14px rgba(30,58,95,0.35);">
                Set My Password &rarr;
              </a>
            </div>

            <!-- GETTING STARTED -->
            <div style="margin-bottom:24px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:18px;">Getting Started</div>
              <table cellpadding="0" cellspacing="0" width="100%">
                ${[
                  ["1", "#0EA5E9", "Set your password", "Use the secure link above to create your own password."],
                  ["2", "#22C55E", "Sign in to your account", "Use your email and new password to access the platform."],
                  ["3", "#8B5CF6", "Complete your profile", "Add your photo and fill in any missing details."],
                  ["4", "#F59E0B", "Explore the platform", "Check your dashboard, tasks, and get familiar with your workspace."],
                ].map(([num, color, title, desc]) => `
                <tr>
                  <td style="padding:0 0 16px;vertical-align:top;width:36px;">
                    <div style="width:28px;height:28px;background:${color}15;border:2px solid ${color}30;border-radius:50%;text-align:center;line-height:24px;font-size:12px;font-weight:800;color:${color};">${num}</div>
                  </td>
                  <td style="padding:0 0 16px 12px;vertical-align:top;">
                    <div style="font-size:14px;font-weight:600;color:#1e293b;margin-bottom:2px;">${title}</div>
                    <div style="font-size:13px;color:#64748b;line-height:1.5;">${desc}</div>
                  </td>
                </tr>`).join("")}
              </table>
            </div>

            <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
              Having trouble? Contact your HR manager for assistance.
            </p>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:24px 0 0;text-align:center;">
            <p style="color:#94a3b8;font-size:11px;margin:0;">&copy; ${new Date().getFullYear()} Illume Student Advisory Services. All rights reserved.</p>
            <p style="color:#cbd5e1;font-size:10px;margin:5px 0 0;">This is an automated message — please do not reply directly to this email.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await safeSend({
    to: opts.to,
    subject: `🎉 Welcome to Illume, ${firstName}! Set your password to get started`,
    html,
  });
}

// ─── 2. PASSWORD RESET EMAIL ───────────────────────────────────────────────────

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  password: string;
  resetBy: string;
  loginUrl: string;
}) {
  const firstName = opts.name.split(" ")[0];

  await safeSend({
    to: opts.to,
    subject: `Your Illume password has been reset`,
    html: wrapEmail("Password Reset", `
      <!-- Alert banner -->
      <div style="background:#fef3c7;border:1.5px solid #fde68a;border-radius:10px;padding:16px 20px;margin-bottom:28px;">
        <div style="font-size:20px;margin-bottom:6px;">🔐</div>
        <div style="font-size:15px;font-weight:700;color:#92400e;margin-bottom:2px;">Your password has been reset</div>
        <div style="font-size:13px;color:#78350f;">This action was performed by an administrator: <strong>${opts.resetBy}</strong></div>
      </div>

      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 20px;">
        Hi ${firstName}, your login credentials for the Illume platform have been updated. Use the new password below to sign in.
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:28px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:16px;">Updated Credentials</div>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:6px 0;font-size:13px;color:#64748b;width:120px;">Email</td>
            <td style="padding:6px 0;font-size:13px;font-weight:600;color:#0369A1;">${opts.to}</td>
          </tr>
          <tr>
            <td style="padding:10px 0 6px;font-size:13px;color:#64748b;vertical-align:top;">New Password</td>
            <td style="padding:10px 0 6px;">
              <code style="background:#1E3A5F;color:#7DD3FC;font-size:14px;font-weight:700;padding:6px 14px;border-radius:7px;letter-spacing:0.5px;font-family:monospace;">${opts.password}</code>
            </td>
          </tr>
        </table>
        <div style="margin-top:16px;padding:10px 14px;background:#fef9ec;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e;">
          ⚠️ &nbsp;Change this password immediately after signing in. If you did not request this reset, contact your administrator.
        </div>
      </div>

      <div style="text-align:center;padding:20px 0 8px;border-top:1px solid #f1f5f9;">
        <a href="${opts.loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#1E3A5F,#0369A1);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 36px;border-radius:10px;letter-spacing:0.02em;box-shadow:0 4px 14px rgba(30,58,95,0.3);">
          Sign In Now &rarr;
        </a>
        <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;">
          If you didn't expect this reset, contact your HR manager immediately.
        </p>
      </div>
    `),
  });
}

// ─── 3. SECURITY ALERT ────────────────────────────────────────────────────────

export async function sendSecurityAlertEmail(opts: {
  to: string | string[];
  alertType: "ROLE_CHANGED" | "ACCOUNT_DEACTIVATED" | "ACCOUNT_REACTIVATED" | "USER_CREATED" | "PASSWORD_RESET";
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
  };

  const cfg = configs[opts.alertType];
  const timestamp = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  const detailRows = opts.details
    ? Object.entries(opts.details).map(([k, v]) => infoRow(k, v))
    : [];

  await safeSend({
    to: opts.to,
    subject: cfg.subject,
    html: wrapEmail(
      cfg.title,
      `
      <!-- Alert banner -->
      <div style="background:${cfg.color}10;border:1.5px solid ${cfg.color}30;border-radius:10px;padding:16px 20px;margin-bottom:28px;display:flex;align-items:center;gap:12px;">
        <span style="font-size:24px;line-height:1;">${cfg.icon}</span>
        <div>
          <div style="font-size:15px;font-weight:700;color:${cfg.color};margin-bottom:2px;">${cfg.title}</div>
          <div style="font-size:13px;color:#64748b;">${cfg.description}</div>
        </div>
      </div>

      <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">
        The following security event was recorded on the Illume platform. Please review and take action if this was not authorised.
      </p>

      ${infoTable([
        ["Affected User", `<strong>${opts.targetName}</strong>`],
        ["Email", opts.targetEmail],
        ["Action By", opts.changedBy],
        ["Timestamp", timestamp],
        ...detailRows.map((): [string, string] => ["", ""]).slice(0),
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
        <a href="${opts.magicLinkUrl}"
           style="display:inline-block;background:linear-gradient(135deg,#1E3A5F,#0369A1);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:10px;letter-spacing:0.02em;box-shadow:0 4px 14px rgba(30,58,95,0.3);">
          Set My Password &rarr;
        </a>
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
  kpi: {
    totalLeads: number;
    enrolled: number;
    conversionRate: number;
    contactRate: number;
    eventsCount: number;
    totalEventCost: number;
  } | null;
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
              <div style="font-size:28px;font-weight:800;color:#1E3A5F;">${opts.kpi.totalLeads}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Total Leads</div>
            </div>
          </td>
          <td style="width:33%;padding:8px;">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#22C55E;">${opts.kpi.enrolled}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Enrolled</div>
            </div>
          </td>
          <td style="width:33%;padding:8px;">
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#0369A1;">${opts.kpi.conversionRate}%</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Conversion</div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="width:33%;padding:8px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#1E3A5F;">${opts.kpi.contactRate}%</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Contact Rate</div>
            </div>
          </td>
          <td style="width:33%;padding:8px;">
            <div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#F59E0B;">${opts.kpi.eventsCount}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Events</div>
            </div>
          </td>
          <td style="width:33%;padding:8px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#1E3A5F;">$${opts.kpi.totalEventCost.toLocaleString()}</div>
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
      <div style="background:linear-gradient(135deg,#1E3A5F 0%,#0369A1 100%);border-radius:12px;padding:28px 32px;margin-bottom:28px;">
        <h1 style="margin:0 0 4px;color:#ffffff;font-size:22px;font-weight:800;">${opts.institutionName}</h1>
        <p style="margin:0;color:rgba(255,255,255,0.7);font-size:14px;">${opts.period} Monthly Report</p>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.5);font-size:12px;">ICR: ${opts.icrName} &middot; Region: ${opts.regionName}</p>
      </div>

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

// ─── Helper: fetch all super admin emails ─────────────────────────────────────

export async function getSuperAdminEmails(): Promise<string[]> {
  const { db } = await import("@/lib/db");
  const admins = await db.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
    select: { email: true },
  });
  return admins.map((a) => a.email);
}
