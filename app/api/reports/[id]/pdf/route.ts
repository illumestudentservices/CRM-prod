import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
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

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    const { id } = await params;

    const report = await db.monthlyReport.findFirst({
      where: { id, deletedAt: null },
      include: {
        icr: { select: { name: true, email: true } },
        institution: { select: { name: true, country: true } },
        region: { select: { name: true } },
      },
    });

    if (!report) {
      return new NextResponse("Report not found", { status: 404 });
    }

    const isExec = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS"].includes(role);
    if (role === "ICR" && report.icrId !== userId) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    if (role === "REGIONAL_MANAGER" && report.regionId !== regionId) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    if (!isExec && role !== "ICR" && role !== "REGIONAL_MANAGER" && role !== "INSTITUTION_CLIENT") {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const period = `${MONTH_NAMES[report.reportingMonth]} ${report.reportingYear}`;
    const icrName = report.icr.name ?? report.icr.email;
    const generated = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

    // Fetch weekly activities
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

    // Fetch previous month for trends
    const prevMonth = report.reportingMonth === 1 ? 12 : report.reportingMonth - 1;
    const prevYear = report.reportingMonth === 1 ? report.reportingYear - 1 : report.reportingYear;
    const prevReport = await db.monthlyReport.findFirst({
      where: { icrId: report.icrId, institutionId: report.institutionId, reportingMonth: prevMonth, reportingYear: prevYear, deletedAt: null },
      select: { kpiSummary: true },
    });

    const kpi = report.kpiSummary as { totalLeads: number; enrolled: number; conversionRate: number; contactRate: number; eventsCount: number; totalEventCost: number } | null;
    const prevKpi = prevReport?.kpiSummary as typeof kpi | null;

    const leads = Array.isArray(report.leadsData) ? (report.leadsData as Array<{ fullName: string; nationality: string; interestedProgram: string; studyLevel: string; stage: string }>) : [];
    const programs = Array.isArray(report.programBreakdown) ? (report.programBreakdown as Array<{ program: string; count: number; levels: Record<string, number> }>) : [];
    const sources = Array.isArray(report.sourcePerformance) ? (report.sourcePerformance as Array<{ name: string; leads: number; enrolled: number }>) : [];
    const events = Array.isArray(report.eventActivities) ? (report.eventActivities as Array<{ name: string; type: string; location: string; cost: number; leadsGenerated: number; roi: number | null }>) : [];

    function trend(current: number, prev: number | undefined): string {
      if (prev === undefined || prev === 0) return "";
      const pct = ((current - prev) / prev) * 100;
      const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "—";
      const color = pct > 0 ? "#22C55E" : pct < 0 ? "#EF4444" : "#94a3b8";
      return `<div style="font-size:10px;color:${color};margin-top:2px;">${arrow} ${Math.abs(pct).toFixed(1)}% vs prev</div>`;
    }

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(report.institution.name)} — ${period} Monthly Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; line-height: 1.5; }
  .cover { width: 100%; min-height: 100vh; background: linear-gradient(135deg, #0f2647 0%, #1E3A5F 40%, #0369A1 100%); display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; color: white; page-break-after: always; padding: 60px 40px; }
  .cover-logo { width: 60px; height: 60px; background: rgba(255,255,255,0.12); border-radius: 14px; display: flex; align-items: center; justify-content: center; margin: 0 auto 28px; }
  .cover h1 { font-size: 36px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
  .cover h2 { font-size: 20px; font-weight: 400; color: rgba(255,255,255,0.7); margin-bottom: 40px; }
  .cover-meta { font-size: 14px; color: rgba(255,255,255,0.5); }
  .cover-meta span { display: inline-block; margin: 0 12px; }
  .cover-divider { width: 60px; height: 3px; background: rgba(255,255,255,0.2); border-radius: 2px; margin: 24px auto; }
  .content { padding: 40px 50px; max-width: 900px; margin: 0 auto; }
  h2 { font-size: 16px; color: #1E3A5F; margin: 28px 0 14px; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; display: flex; align-items: center; gap: 8px; }
  h2 .section-num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #1E3A5F; color: white; border-radius: 6px; font-size: 11px; font-weight: 700; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
  .kpi-box { text-align: center; padding: 18px 10px; border-radius: 10px; border: 1px solid #e2e8f0; }
  .kpi-value { font-size: 28px; font-weight: 800; }
  .kpi-label { font-size: 10px; color: #94a3b8; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  th { background: #1E3A5F; color: white; text-align: left; padding: 10px 14px; font-weight: 600; font-size: 11px; letter-spacing: 0.3px; }
  th.r { text-align: right; }
  td { padding: 9px 14px; border-bottom: 1px solid #f1f5f9; }
  td.r { text-align: right; }
  td.b { font-weight: 600; }
  tr:nth-child(even) { background: #f8fafc; }
  .text-section { border-left: 3px solid #1E3A5F; padding: 14px 20px; background: #f8fafc; border-radius: 0 8px 8px 0; margin-bottom: 16px; }
  .text-section-label { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #94a3b8; margin-bottom: 6px; }
  .text-section p { font-size: 13px; color: #334155; white-space: pre-wrap; line-height: 1.7; }
  .footer { text-align: center; padding: 20px 0; margin-top: 40px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; }
  .met { color: #22C55E; font-weight: 700; }
  .missed { color: #EF4444; font-weight: 700; }
  .print-btn { position: fixed; top: 16px; right: 16px; padding: 10px 20px; background: #1E3A5F; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; z-index: 100; }
  .print-btn:hover { background: #152d4a; }
  @media print {
    .print-btn { display: none; }
    .cover { min-height: 100vh; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: avoid; }
    .text-section { page-break-inside: avoid; }
    .footer { position: running(footer); }
    @page { margin: 20mm 15mm; @bottom-center { content: "Illume Student Advisory Services — Confidential"; font-size: 9px; color: #94a3b8; } }
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>

<!-- COVER PAGE -->
<div class="cover">
  <div class="cover-logo">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="white" fill-opacity="0.9"/><path d="M9 12l2 2 4-4" stroke="#7DD3FC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>
  <div style="font-size:14px;font-weight:500;color:rgba(255,255,255,0.4);letter-spacing:3px;text-transform:uppercase;margin-bottom:32px;">Illume Student Advisory Services</div>
  <h1>${esc(report.institution.name)}</h1>
  <h2>${period} — Monthly Report</h2>
  <div class="cover-divider"></div>
  <div class="cover-meta">
    <span>ICR: ${esc(icrName)}</span>
    <span>|</span>
    <span>Region: ${esc(report.region?.name ?? "N/A")}</span>
    <span>|</span>
    <span>Generated: ${generated}</span>
  </div>
</div>

<div class="content">
`;

    // KPI Summary
    let sectionNum = 1;
    if (kpi) {
      html += `<h2><span class="section-num">${sectionNum++}</span> KPI Summary</h2>
<div class="kpi-grid">
  <div class="kpi-box" style="background:#f8fafc;"><div class="kpi-value" style="color:#1E3A5F;">${kpi.totalLeads}</div><div class="kpi-label">Total Leads</div>${trend(kpi.totalLeads, prevKpi?.totalLeads)}</div>
  <div class="kpi-box" style="background:#f0fdf4;border-color:#bbf7d0;"><div class="kpi-value" style="color:#22C55E;">${kpi.enrolled}</div><div class="kpi-label">Enrolled</div>${trend(kpi.enrolled, prevKpi?.enrolled)}</div>
  <div class="kpi-box" style="background:#eff6ff;border-color:#bfdbfe;"><div class="kpi-value" style="color:#0369A1;">${kpi.conversionRate}%</div><div class="kpi-label">Conversion Rate</div>${prevKpi ? trend(kpi.conversionRate, prevKpi.conversionRate) : ""}</div>
  <div class="kpi-box" style="background:#f8fafc;"><div class="kpi-value" style="color:#1E3A5F;">${kpi.contactRate}%</div><div class="kpi-label">Contact Rate</div>${prevKpi ? trend(kpi.contactRate, prevKpi.contactRate) : ""}</div>
  <div class="kpi-box" style="background:#fefce8;border-color:#fde68a;"><div class="kpi-value" style="color:#F59E0B;">${kpi.eventsCount}</div><div class="kpi-label">Events</div>${trend(kpi.eventsCount, prevKpi?.eventsCount)}</div>
  <div class="kpi-box" style="background:#f8fafc;"><div class="kpi-value" style="color:#1E3A5F;">$${kpi.totalEventCost.toLocaleString()}</div><div class="kpi-label">Event Cost</div></div>
</div>`;
    }

    // Leads
    if (leads.length > 0) {
      html += `<h2><span class="section-num">${sectionNum++}</span> Leads Collected (${leads.length})</h2>
<table><thead><tr><th>Name</th><th>Nationality</th><th>Program</th><th>Level</th><th>Stage</th></tr></thead><tbody>`;
      for (const lead of leads) {
        html += `<tr><td class="b">${esc(lead.fullName)}</td><td>${esc(lead.nationality)}</td><td>${esc(lead.interestedProgram)}</td><td>${lead.studyLevel}</td><td>${lead.stage.replace(/_/g, " ")}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    // Programs
    if (programs.length > 0) {
      html += `<h2><span class="section-num">${sectionNum++}</span> Program Breakdown</h2>
<table><thead><tr><th>Program</th><th class="r">Total</th><th class="r">UG</th><th class="r">PG</th><th class="r">Foundation</th><th class="r">Pathway</th></tr></thead><tbody>`;
      for (const prog of programs) {
        html += `<tr><td class="b">${esc(prog.program)}</td><td class="r" style="font-weight:700;color:#1E3A5F;">${prog.count}</td><td class="r">${prog.levels?.["UNDERGRADUATE"] ?? 0}</td><td class="r">${prog.levels?.["POSTGRADUATE"] ?? 0}</td><td class="r">${prog.levels?.["FOUNDATION"] ?? 0}</td><td class="r">${prog.levels?.["PATHWAY"] ?? 0}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    // Sources
    if (sources.length > 0) {
      html += `<h2><span class="section-num">${sectionNum++}</span> Source Performance</h2>
<table><thead><tr><th>Source</th><th class="r">Leads</th><th class="r">Enrolled</th><th class="r">Conversion</th></tr></thead><tbody>`;
      for (const src of sources) {
        const conv = src.leads > 0 ? `${Math.round((src.enrolled / src.leads) * 100)}%` : "—";
        html += `<tr><td class="b">${esc(src.name)}</td><td class="r">${src.leads}</td><td class="r" style="color:#22C55E;font-weight:600;">${src.enrolled}</td><td class="r">${conv}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    // Events
    if (events.length > 0) {
      html += `<h2><span class="section-num">${sectionNum++}</span> Event Activities &amp; ROI</h2>
<table><thead><tr><th>Event</th><th>Location</th><th class="r">Leads</th><th class="r">Cost</th><th class="r">ROI</th></tr></thead><tbody>`;
      for (const event of events) {
        html += `<tr><td class="b">${esc(event.name)}</td><td>${esc(event.location)}</td><td class="r">${event.leadsGenerated}</td><td class="r">${event.cost > 0 ? "$" + event.cost.toLocaleString() : "—"}</td><td class="r">${event.roi !== null ? event.roi : "—"}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    // Weekly Activities
    if (byType.size > 0) {
      html += `<h2><span class="section-num">${sectionNum++}</span> Weekly Activities Summary</h2>
<table><thead><tr><th>Activity</th><th class="r">Wk 1</th><th class="r">Wk 2</th><th class="r">Wk 3</th><th class="r">Wk 4</th><th class="r">Total</th><th class="r">Target</th></tr></thead><tbody>`;
      for (const type of WEEKLY_ACTIVITY_TYPES) {
        const entry = byType.get(type);
        if (!entry) continue;
        const def = WEEKLY_ACTIVITY_DEFS[type as WeeklyActivityType];
        const w1 = entry.weeks[1] ?? 0;
        const w2 = entry.weeks[2] ?? 0;
        const w3 = entry.weeks[3] ?? 0;
        const w4 = entry.weeks[4] ?? 0;
        const total = w1 + w2 + w3 + w4;
        const met = total >= entry.totalTarget;
        html += `<tr><td class="b">${esc(def.label)}</td><td class="r">${w1}</td><td class="r">${w2}</td><td class="r">${w3}</td><td class="r">${w4}</td><td class="r ${met ? "met" : "missed"}">${total}</td><td class="r">${entry.totalTarget}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    // Text sections
    const sections = [
      { label: "Engagement Notes", value: report.engagementNotes },
      { label: "Challenges & Opportunities", value: report.challengesOpportunities },
      { label: "Success Stories", value: report.successStories },
      { label: "Market Insights", value: report.marketInsights },
      { label: "Next Month Plan", value: report.nextMonthPlan },
    ].filter((s) => s.value);

    if (sections.length > 0) {
      html += `<h2><span class="section-num">${sectionNum++}</span> Report Sections</h2>`;
      for (const section of sections) {
        html += `<div class="text-section"><div class="text-section-label">${esc(section.label)}</div><p>${esc(section.value!)}</p></div>`;
      }
    }

    html += `
<div class="footer">
  <strong>Illume Student Advisory Services</strong> — Confidential<br>
  ${esc(report.institution.name)} &middot; ${period} Monthly Report &middot; Generated ${generated}
</div>

</div>

<script>
  window.addEventListener('load', function() {
    setTimeout(function() { window.print(); }, 500);
  });
</script>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    console.error("[reports/id/pdf] GET error:", error);
    return new NextResponse("Internal server error", { status: 500 });
  }
}
