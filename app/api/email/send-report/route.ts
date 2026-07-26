import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { safeSend } from "@/lib/email";
import type { Role } from "@/lib/permissions";
import {
  WEEKLY_ACTIVITY_DEFS,
  WEEKLY_ACTIVITY_TYPES,
  type WeeklyActivityType,
} from "@/lib/weekly-activities";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const schema = z.object({
  reportId: z.string().min(1),
  to: z.string().email(),
  message: z.string().max(2000).optional(),
});

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "<br>");
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user as {
      role: Role; id: string; regionId: string | null;
    };

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }

    const report = await db.monthlyReport.findFirst({
      where: { id: parsed.data.reportId, deletedAt: null },
      include: {
        icr: { select: { name: true, email: true } },
        institution: { select: { name: true, country: true } },
        region: { select: { name: true } },
      },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const isExec = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS"].includes(role);
    if (role === "ICR" && report.icrId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (role === "REGIONAL_MANAGER" && report.regionId !== regionId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!isExec && role !== "ICR" && role !== "REGIONAL_MANAGER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const period = `${MONTH_NAMES[report.reportingMonth]} ${report.reportingYear}`;
    const icrName = report.icr.name ?? report.icr.email;
    const senderName = (session.user as { name?: string }).name ?? "An Illume user";

    const kpi = report.kpiSummary as { totalLeads: number; enrolled: number; conversionRate: number; contactRate: number; eventsCount: number; totalEventCost: number } | null;
    const leads = Array.isArray(report.leadsData) ? (report.leadsData as Array<{ fullName: string; nationality: string; interestedProgram: string; studyLevel: string; stage: string }>) : [];
    const programs = Array.isArray(report.programBreakdown) ? (report.programBreakdown as Array<{ program: string; count: number; levels: Record<string, number> }>) : [];
    const sources = Array.isArray(report.sourcePerformance) ? (report.sourcePerformance as Array<{ name: string; leads: number; enrolled: number }>) : [];
    const events = Array.isArray(report.eventActivities) ? (report.eventActivities as Array<{ name: string; location: string; cost: number; leadsGenerated: number; roi: number | null }>) : [];

    // Weekly activities
    const weeklyActivities = await db.weeklyActivity.findMany({
      where: { icrId: report.icrId, year: report.reportingYear, month: report.reportingMonth },
      orderBy: [{ type: "asc" }, { weekOfMonth: "asc" }],
    });
    const byType = new Map<string, { weeks: Record<number, number>; totalTarget: number }>();
    for (const wa of weeklyActivities) {
      let entry = byType.get(wa.type);
      if (!entry) { entry = { weeks: {}, totalTarget: 0 }; byType.set(wa.type, entry); }
      entry.weeks[wa.weekOfMonth] = (entry.weeks[wa.weekOfMonth] ?? 0) + wa.completed;
      entry.totalTarget += wa.target;
    }

    const TH = 'style="background:#1E3A5F;color:#ffffff;text-align:left;padding:8px 12px;font-size:11px;font-weight:600;"';
    const TH_R = 'style="background:#1E3A5F;color:#ffffff;text-align:right;padding:8px 12px;font-size:11px;font-weight:600;"';
    const TD = 'style="padding:8px 12px;font-size:12px;color:#1e293b;border-bottom:1px solid #f1f5f9;"';
    const TD_R = 'style="padding:8px 12px;font-size:12px;color:#1e293b;border-bottom:1px solid #f1f5f9;text-align:right;"';
    const TD_B = 'style="padding:8px 12px;font-size:12px;color:#1e293b;border-bottom:1px solid #f1f5f9;font-weight:600;"';
    const TABLE = 'cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:8px;"';

    // Build HTML sections
    let reportBody = "";

    // Message from sender
    if (parsed.data.message) {
      reportBody += `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:13px;color:#0369A1;line-height:1.6;"><strong>${esc(senderName)}</strong> says: ${esc(parsed.data.message)}</p>
      </div>`;
    }

    // KPI
    if (kpi) {
      function kpiBox(val: string, label: string, bg = "#f8fafc", border = "#e2e8f0", color = "#1E3A5F") {
        return `<td style="width:33%;padding:6px;"><div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:800;color:${color};">${val}</div><div style="font-size:9px;color:#94a3b8;margin-top:3px;text-transform:uppercase;letter-spacing:0.5px;">${label}</div></div></td>`;
      }
      reportBody += `<h2 style="color:#1E3A5F;font-size:16px;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">KPI Summary</h2>
      <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:20px;">
        <tr>${kpiBox(String(kpi.totalLeads), "Total Leads")}${kpiBox(String(kpi.enrolled), "Enrolled", "#f0fdf4", "#bbf7d0", "#22C55E")}${kpiBox(`${kpi.conversionRate}%`, "Conversion", "#eff6ff", "#bfdbfe", "#0369A1")}</tr>
        <tr>${kpiBox(`${kpi.contactRate}%`, "Contact Rate")}${kpiBox(String(kpi.eventsCount), "Events", "#fefce8", "#fde68a", "#F59E0B")}${kpiBox(`$${(kpi.totalEventCost ?? 0).toLocaleString()}`, "Event Cost")}</tr>
      </table>`;
    }

    // Leads
    if (leads.length > 0) {
      let rows = leads.slice(0, 30).map((l, i) =>
        `<tr style="background:${i % 2 === 0 ? "#fff" : "#f8fafc"};"><td ${TD_B}>${esc(l.fullName)}</td><td ${TD}>${esc(l.nationality)}</td><td ${TD}>${esc(l.interestedProgram)}</td><td ${TD}>${l.studyLevel}</td><td ${TD}>${l.stage.replace(/_/g, " ")}</td></tr>`
      ).join("");
      if (leads.length > 30) rows += `<tr><td colspan="5" style="padding:6px 12px;font-size:11px;color:#94a3b8;text-align:center;background:#f8fafc;">+ ${leads.length - 30} more leads</td></tr>`;
      reportBody += `<h2 style="color:#1E3A5F;font-size:16px;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">Leads Collected (${leads.length})</h2>
      <table ${TABLE}><thead><tr><th ${TH}>Name</th><th ${TH}>Nationality</th><th ${TH}>Program</th><th ${TH}>Level</th><th ${TH}>Stage</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    // Programs
    if (programs.length > 0) {
      const rows = programs.map((p, i) =>
        `<tr style="background:${i % 2 === 0 ? "#fff" : "#f8fafc"};"><td ${TD_B}>${esc(p.program)}</td><td ${TD_R} style="padding:8px 12px;font-size:12px;color:#1E3A5F;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;">${p.count}</td><td ${TD_R}>${p.levels?.["UNDERGRADUATE"] ?? 0}</td><td ${TD_R}>${p.levels?.["POSTGRADUATE"] ?? 0}</td><td ${TD_R}>${p.levels?.["FOUNDATION"] ?? 0}</td><td ${TD_R}>${p.levels?.["PATHWAY"] ?? 0}</td></tr>`
      ).join("");
      reportBody += `<h2 style="color:#1E3A5F;font-size:16px;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">Program Breakdown</h2>
      <table ${TABLE}><thead><tr><th ${TH}>Program</th><th ${TH_R}>Total</th><th ${TH_R}>UG</th><th ${TH_R}>PG</th><th ${TH_R}>Foundation</th><th ${TH_R}>Pathway</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    // Sources
    if (sources.length > 0) {
      const rows = sources.map((s, i) => {
        const conv = s.leads > 0 ? `${Math.round((s.enrolled / s.leads) * 100)}%` : "—";
        return `<tr style="background:${i % 2 === 0 ? "#fff" : "#f8fafc"};"><td ${TD_B}>${esc(s.name)}</td><td ${TD_R}>${s.leads}</td><td ${TD_R} style="padding:8px 12px;font-size:12px;color:#22C55E;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${s.enrolled}</td><td ${TD_R}>${conv}</td></tr>`;
      }).join("");
      reportBody += `<h2 style="color:#1E3A5F;font-size:16px;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">Source Performance</h2>
      <table ${TABLE}><thead><tr><th ${TH}>Source</th><th ${TH_R}>Leads</th><th ${TH_R}>Enrolled</th><th ${TH_R}>Conversion</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    // Events
    if (events.length > 0) {
      const rows = events.map((e, i) =>
        `<tr style="background:${i % 2 === 0 ? "#fff" : "#f8fafc"};"><td ${TD_B}>${esc(e.name)}</td><td ${TD}>${esc(e.location)}</td><td ${TD_R}>${e.leadsGenerated}</td><td ${TD_R}>${e.cost > 0 ? "$" + e.cost.toLocaleString() : "—"}</td><td ${TD_R}>${e.roi !== null ? e.roi : "—"}</td></tr>`
      ).join("");
      reportBody += `<h2 style="color:#1E3A5F;font-size:16px;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">Event Activities &amp; ROI</h2>
      <table ${TABLE}><thead><tr><th ${TH}>Event</th><th ${TH}>Location</th><th ${TH_R}>Leads</th><th ${TH_R}>Cost</th><th ${TH_R}>ROI</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    // Weekly Activities
    if (byType.size > 0) {
      let rows = "";
      let i = 0;
      for (const type of WEEKLY_ACTIVITY_TYPES) {
        const entry = byType.get(type);
        if (!entry) continue;
        const def = WEEKLY_ACTIVITY_DEFS[type as WeeklyActivityType];
        const w1 = entry.weeks[1] ?? 0, w2 = entry.weeks[2] ?? 0, w3 = entry.weeks[3] ?? 0, w4 = entry.weeks[4] ?? 0;
        const total = w1 + w2 + w3 + w4;
        const met = total >= entry.totalTarget;
        rows += `<tr style="background:${i % 2 === 0 ? "#fff" : "#f8fafc"};"><td ${TD_B}>${esc(def.label)}</td><td ${TD_R}>${w1}</td><td ${TD_R}>${w2}</td><td ${TD_R}>${w3}</td><td ${TD_R}>${w4}</td><td style="padding:8px 12px;font-size:12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;color:${met ? "#22C55E" : "#EF4444"};">${total}</td><td ${TD_R}>${entry.totalTarget}</td></tr>`;
        i++;
      }
      reportBody += `<h2 style="color:#1E3A5F;font-size:16px;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">Weekly Activities</h2>
      <table ${TABLE}><thead><tr><th ${TH}>Activity</th><th ${TH_R}>Wk 1</th><th ${TH_R}>Wk 2</th><th ${TH_R}>Wk 3</th><th ${TH_R}>Wk 4</th><th ${TH_R}>Total</th><th ${TH_R}>Target</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    // Text sections
    const textSections = [
      { label: "Engagement Notes", value: report.engagementNotes },
      { label: "Challenges & Opportunities", value: report.challengesOpportunities },
      { label: "Success Stories", value: report.successStories },
      { label: "Market Insights", value: report.marketInsights },
      { label: "Next Month Plan", value: report.nextMonthPlan },
    ].filter(s => s.value);

    if (textSections.length > 0) {
      reportBody += `<h2 style="color:#1E3A5F;font-size:16px;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">Report Sections</h2>`;
      for (const s of textSections) {
        reportBody += `<div style="border-left:3px solid #1E3A5F;padding:12px 18px;background:#f8fafc;border-radius:0 8px 8px 0;margin-bottom:12px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">${esc(s.label)}</div>
          <p style="margin:0;font-size:13px;color:#334155;line-height:1.7;white-space:pre-wrap;">${esc(s.value!)}</p>
        </div>`;
      }
    }

    // Full email HTML
    const generated = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;"><tr><td align="center">
<table width="700" cellpadding="0" cellspacing="0" style="max-width:700px;width:100%;">
  <tr><td style="background:linear-gradient(135deg,#0f2647 0%,#1E3A5F 40%,#0369A1 100%);border-radius:14px 14px 0 0;padding:36px 40px;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;padding-right:10px;">
        <div style="width:38px;height:38px;background:rgba(255,255,255,0.15);border-radius:10px;text-align:center;line-height:38px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;"><path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="white" fill-opacity="0.9"/><path d="M9 12l2 2 4-4" stroke="#7DD3FC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </td>
      <td style="vertical-align:middle;">
        <div style="color:white;font-size:18px;font-weight:700;">Illume</div>
        <div style="color:rgba(255,255,255,0.55);font-size:9px;letter-spacing:2.5px;text-transform:uppercase;">Student Advisory Services</div>
      </td>
    </tr></table>
    <div style="margin-top:24px;">
      <h1 style="margin:0 0 4px;color:#ffffff;font-size:24px;font-weight:800;">${esc(report.institution.name)}</h1>
      <p style="margin:0;color:rgba(255,255,255,0.7);font-size:14px;">${period} — Monthly Report</p>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.4);font-size:12px;">ICR: ${esc(icrName)} &middot; Region: ${esc(report.region?.name ?? "N/A")} &middot; ${generated}</p>
    </div>
  </td></tr>
  <tr><td style="background:#ffffff;padding:32px 40px;border-radius:0 0 14px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.08);">
    ${reportBody}
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="margin:0;font-size:10px;color:#94a3b8;"><strong>Illume Student Advisory Services</strong> — Confidential</p>
      <p style="margin:4px 0 0;font-size:10px;color:#cbd5e1;">${esc(report.institution.name)} &middot; ${period} Monthly Report &middot; Generated ${generated}</p>
    </div>
  </td></tr>
  <tr><td style="padding:20px 0;text-align:center;">
    <p style="color:#94a3b8;font-size:11px;margin:0;">&copy; 2026 Illume Student Advisory Services. All rights reserved.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

    await safeSend({
      to: parsed.data.to,
      subject: `Monthly Report — ${report.institution.name} — ${period}`,
      html,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[email/send-report] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
