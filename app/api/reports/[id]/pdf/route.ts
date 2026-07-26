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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

/**
 * GET /api/reports/[id]/pdf
 *
 * Returns a print-ready HTML page for the monthly report.
 * The client can use window.print() to produce a PDF.
 */
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

    // Access control
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

    const weeklyActivities = await db.weeklyActivity.findMany({
      where: {
        icrId: report.icrId,
        year: report.reportingYear,
        month: report.reportingMonth,
      },
      orderBy: [{ type: "asc" }, { weekOfMonth: "asc" }],
    });

    const kpi = report.kpiSummary as {
      totalLeads: number;
      enrolled: number;
      conversionRate: number;
      contactRate: number;
      eventsCount: number;
      totalEventCost: number;
    } | null;

    const leads = Array.isArray(report.leadsData)
      ? (report.leadsData as Array<{
          fullName: string;
          nationality: string;
          interestedProgram: string;
          studyLevel: string;
          stage: string;
        }>)
      : [];

    const programs = Array.isArray(report.programBreakdown)
      ? (report.programBreakdown as Array<{
          program: string;
          count: number;
          levels: Record<string, number>;
        }>)
      : [];

    const sources = Array.isArray(report.sourcePerformance)
      ? (report.sourcePerformance as Array<{
          name: string;
          leads: number;
          enrolled: number;
        }>)
      : [];

    const events = Array.isArray(report.eventActivities)
      ? (report.eventActivities as Array<{
          name: string;
          type: string;
          location: string;
          cost: number;
          leadsGenerated: number;
          roi: number | null;
        }>)
      : [];

    // Build the HTML
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(report.institution.name)} — ${period} Monthly Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; line-height: 1.5; padding: 40px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 22px; color: #1E3A5F; margin-bottom: 4px; }
  h2 { font-size: 16px; color: #1E3A5F; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; }
  h3 { font-size: 14px; color: #475569; margin: 16px 0 8px; }
  .subtitle { font-size: 13px; color: #64748b; margin-bottom: 20px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
  .kpi-box { text-align: center; padding: 16px 8px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
  .kpi-value { font-size: 24px; font-weight: 700; color: #1E3A5F; }
  .kpi-label { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
  th { background: #f1f5f9; text-align: left; padding: 8px 12px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
  .text-right { text-align: right; }
  .section-text { font-size: 13px; color: #334155; white-space: pre-wrap; margin-bottom: 12px; }
  .section-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .status-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .print-btn { position: fixed; top: 16px; right: 16px; padding: 10px 20px; background: #1E3A5F; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; z-index: 100; }
  .print-btn:hover { background: #152d4a; }
  @media print {
    body { padding: 20px; }
    .print-btn { display: none; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>

<h1>${escapeHtml(report.institution.name)}</h1>
<p class="subtitle">${period} Monthly Report &middot; ICR: ${escapeHtml(icrName)} &middot; Region: ${escapeHtml(report.region?.name ?? "N/A")}</p>
`;

    // KPI Summary
    if (kpi) {
      html += `<h2>KPI Summary</h2>
<div class="kpi-grid">
  <div class="kpi-box"><div class="kpi-value">${kpi.totalLeads}</div><div class="kpi-label">Total Leads</div></div>
  <div class="kpi-box"><div class="kpi-value">${kpi.enrolled}</div><div class="kpi-label">Enrolled</div></div>
  <div class="kpi-box"><div class="kpi-value">${kpi.conversionRate}%</div><div class="kpi-label">Conversion Rate</div></div>
  <div class="kpi-box"><div class="kpi-value">${kpi.contactRate}%</div><div class="kpi-label">Contact Rate</div></div>
  <div class="kpi-box"><div class="kpi-value">${kpi.eventsCount}</div><div class="kpi-label">Events</div></div>
  <div class="kpi-box"><div class="kpi-value">$${kpi.totalEventCost.toLocaleString()}</div><div class="kpi-label">Event Cost</div></div>
</div>`;
    }

    // Leads table
    if (leads.length > 0) {
      html += `<h2>Leads Collected (${leads.length})</h2>
<table>
<thead><tr><th>Name</th><th>Nationality</th><th>Program</th><th>Level</th><th>Stage</th></tr></thead>
<tbody>`;
      for (const lead of leads) {
        html += `<tr><td>${escapeHtml(lead.fullName)}</td><td>${escapeHtml(lead.nationality)}</td><td>${escapeHtml(lead.interestedProgram)}</td><td>${lead.studyLevel}</td><td>${lead.stage.replace(/_/g, " ")}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    // Program breakdown
    if (programs.length > 0) {
      html += `<h2>Program Breakdown</h2>
<table>
<thead><tr><th>Program</th><th class="text-right">Total</th><th class="text-right">UG</th><th class="text-right">PG</th><th class="text-right">Foundation</th><th class="text-right">Pathway</th></tr></thead>
<tbody>`;
      for (const prog of programs) {
        html += `<tr><td>${escapeHtml(prog.program)}</td><td class="text-right">${prog.count}</td><td class="text-right">${prog.levels?.["UNDERGRADUATE"] ?? 0}</td><td class="text-right">${prog.levels?.["POSTGRADUATE"] ?? 0}</td><td class="text-right">${prog.levels?.["FOUNDATION"] ?? 0}</td><td class="text-right">${prog.levels?.["PATHWAY"] ?? 0}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    // Source performance
    if (sources.length > 0) {
      html += `<h2>Source Performance</h2>
<table>
<thead><tr><th>Source</th><th class="text-right">Leads</th><th class="text-right">Enrolled</th><th class="text-right">Conversion</th></tr></thead>
<tbody>`;
      for (const src of sources) {
        const conv = src.leads > 0 ? `${Math.round((src.enrolled / src.leads) * 100)}%` : "—";
        html += `<tr><td>${escapeHtml(src.name)}</td><td class="text-right">${src.leads}</td><td class="text-right">${src.enrolled}</td><td class="text-right">${conv}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    // Events
    if (events.length > 0) {
      html += `<h2>Event Activities &amp; ROI</h2>
<table>
<thead><tr><th>Event</th><th>Location</th><th class="text-right">Leads</th><th class="text-right">Cost</th><th class="text-right">ROI</th></tr></thead>
<tbody>`;
      for (const event of events) {
        html += `<tr><td>${escapeHtml(event.name)}</td><td>${escapeHtml(event.location)}</td><td class="text-right">${event.leadsGenerated}</td><td class="text-right">${event.cost > 0 ? "$" + event.cost.toLocaleString() : "—"}</td><td class="text-right">${event.roi !== null ? event.roi : "—"}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    // Weekly Activities rollup
    if (weeklyActivities.length > 0) {
      const byType = new Map<string, { weeks: Record<number, number>; totalTarget: number }>();
      for (const wa of weeklyActivities) {
        let entry = byType.get(wa.type);
        if (!entry) {
          entry = { weeks: {}, totalTarget: 0 };
          byType.set(wa.type, entry);
        }
        entry.weeks[wa.weekOfMonth] = (entry.weeks[wa.weekOfMonth] ?? 0) + wa.completed;
        entry.totalTarget += wa.target;
      }

      html += `<h2>Weekly Activities Summary</h2>
<table>
<thead><tr><th>Activity</th><th class="text-right">Wk 1</th><th class="text-right">Wk 2</th><th class="text-right">Wk 3</th><th class="text-right">Wk 4</th><th class="text-right">Total</th><th class="text-right">Target</th></tr></thead>
<tbody>`;
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
        html += `<tr><td>${escapeHtml(def.label)}</td><td class="text-right">${w1}</td><td class="text-right">${w2}</td><td class="text-right">${w3}</td><td class="text-right">${w4}</td><td class="text-right" style="font-weight:700;color:${met ? "#22C55E" : "#EF4444"}">${total}</td><td class="text-right">${entry.totalTarget}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    // Report sections
    const sections: Array<{ label: string; value: string | null }> = [
      { label: "Engagement Notes", value: report.engagementNotes },
      { label: "Challenges & Opportunities", value: report.challengesOpportunities },
      { label: "Success Stories", value: report.successStories },
      { label: "Market Insights", value: report.marketInsights },
      { label: "Next Month Plan", value: report.nextMonthPlan },
    ];

    const hasSections = sections.some((s) => s.value);
    if (hasSections) {
      html += `<h2>Report Sections</h2>`;
      for (const section of sections) {
        if (section.value) {
          html += `<div style="margin-bottom:16px"><div class="section-label">${escapeHtml(section.label)}</div><div class="section-text">${escapeHtml(section.value)}</div></div>`;
        }
      }
    }

    html += `
<script>
  // Auto-trigger print dialog when opened
  window.addEventListener('load', function() {
    // Small delay to ensure styles are rendered
    setTimeout(function() { window.print(); }, 500);
  });
</script>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("[reports/id/pdf] GET error:", error);
    return new NextResponse("Internal server error", { status: 500 });
  }
}
