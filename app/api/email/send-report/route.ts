import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";
import { safeSend, wrapEmail } from "@/lib/email";
import { kpiNum, kpiPct, kpiMoney, type PartialKpi } from "@/lib/kpi-format";
import { generatePdfFromHtml } from "@/lib/pdf-generator";
import { hasCapability } from "@/lib/granular-permissions";
import type { Role } from "@/lib/permissions";
import { snapshotName, type SnapshotName } from "@/lib/person-name";
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

// Generates the full PDF-ready HTML (same as the PDF route)
function buildReportHtml(opts: {
  institutionName: string;
  period: string;
  icrName: string;
  regionName: string;
  kpi: PartialKpi;
  leads: Array<SnapshotName & { nationality: string; interestedProgram: string; studyLevel: string; stage: string }>;
  programs: Array<{ program: string; count: number; levels: Record<string, number> }>;
  sources: Array<{ name: string; leads: number; enrolled: number }>;
  events: Array<{ name: string; location: string; cost: number; leadsGenerated: number; roi: number | null }>;
  byType: Map<string, { weeks: Record<number, number>; totalTarget: number }>;
  textSections: Array<{ label: string; value: string }>;
}): string {
  const generated = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  let sectionNum = 1;
  let body = "";

  // KPI
  if (opts.kpi) {
    const k = opts.kpi;
    body += `<h2><span class="sn">${sectionNum++}</span> KPI Summary</h2>
<div class="kpi-grid">
  <div class="kpi-box"><div class="kpi-value" style="color:#1E3A5F;">${kpiNum(k, "totalLeads")}</div><div class="kpi-label">Total Leads</div></div>
  <div class="kpi-box" style="background:#f0fdf4;border-color:#bbf7d0;"><div class="kpi-value" style="color:#22C55E;">${kpiNum(k, "enrolled")}</div><div class="kpi-label">Enrolled</div></div>
  <div class="kpi-box" style="background:#eff6ff;border-color:#bfdbfe;"><div class="kpi-value" style="color:#0369A1;">${kpiPct(k, "conversionRate")}</div><div class="kpi-label">Conversion Rate</div></div>
  <div class="kpi-box"><div class="kpi-value" style="color:#1E3A5F;">${kpiPct(k, "contactRate")}</div><div class="kpi-label">Contact Rate</div></div>
  <div class="kpi-box" style="background:#fefce8;border-color:#fde68a;"><div class="kpi-value" style="color:#F59E0B;">${kpiNum(k, "eventsCount")}</div><div class="kpi-label">Events</div></div>
  <div class="kpi-box"><div class="kpi-value" style="color:#1E3A5F;">${kpiMoney(k, "totalEventCost")}</div><div class="kpi-label">Event Cost</div></div>
</div>`;
  }

  if (opts.leads.length > 0) {
    body += `<h2><span class="sn">${sectionNum++}</span> Leads Collected (${opts.leads.length})</h2><table><thead><tr><th>Name</th><th>Nationality</th><th>Program</th><th>Level</th><th>Stage</th></tr></thead><tbody>`;
    for (const l of opts.leads) body += `<tr><td class="b">${esc(snapshotName(l))}</td><td>${esc(l.nationality)}</td><td>${esc(l.interestedProgram)}</td><td>${l.studyLevel}</td><td>${l.stage.replace(/_/g, " ")}</td></tr>`;
    body += `</tbody></table>`;
  }

  if (opts.programs.length > 0) {
    body += `<h2><span class="sn">${sectionNum++}</span> Program Breakdown</h2><table><thead><tr><th>Program</th><th class="r">Total</th><th class="r">UG</th><th class="r">PG</th><th class="r">Foundation</th><th class="r">Pathway</th></tr></thead><tbody>`;
    for (const p of opts.programs) body += `<tr><td class="b">${esc(p.program)}</td><td class="r" style="font-weight:700;color:#1E3A5F;">${p.count}</td><td class="r">${p.levels?.["UNDERGRADUATE"] ?? 0}</td><td class="r">${p.levels?.["POSTGRADUATE"] ?? 0}</td><td class="r">${p.levels?.["FOUNDATION"] ?? 0}</td><td class="r">${p.levels?.["PATHWAY"] ?? 0}</td></tr>`;
    body += `</tbody></table>`;
  }

  if (opts.sources.length > 0) {
    body += `<h2><span class="sn">${sectionNum++}</span> Source Performance</h2><table><thead><tr><th>Source</th><th class="r">Leads</th><th class="r">Enrolled</th><th class="r">Conversion</th></tr></thead><tbody>`;
    for (const s of opts.sources) { const c = s.leads > 0 ? `${Math.round((s.enrolled / s.leads) * 100)}%` : "—"; body += `<tr><td class="b">${esc(s.name)}</td><td class="r">${s.leads}</td><td class="r" style="color:#22C55E;font-weight:600;">${s.enrolled}</td><td class="r">${c}</td></tr>`; }
    body += `</tbody></table>`;
  }

  if (opts.events.length > 0) {
    body += `<h2><span class="sn">${sectionNum++}</span> Event Activities &amp; ROI</h2><table><thead><tr><th>Event</th><th>Location</th><th class="r">Leads</th><th class="r">Cost</th><th class="r">ROI</th></tr></thead><tbody>`;
    for (const e of opts.events) body += `<tr><td class="b">${esc(e.name)}</td><td>${esc(e.location)}</td><td class="r">${e.leadsGenerated}</td><td class="r">${e.cost > 0 ? "$" + e.cost.toLocaleString() : "—"}</td><td class="r">${e.roi !== null ? e.roi : "—"}</td></tr>`;
    body += `</tbody></table>`;
  }

  if (opts.byType.size > 0) {
    body += `<h2><span class="sn">${sectionNum++}</span> Weekly Activities</h2><table><thead><tr><th>Activity</th><th class="r">Wk 1</th><th class="r">Wk 2</th><th class="r">Wk 3</th><th class="r">Wk 4</th><th class="r">Total</th><th class="r">Target</th></tr></thead><tbody>`;
    for (const type of WEEKLY_ACTIVITY_TYPES) {
      const entry = opts.byType.get(type);
      if (!entry) continue;
      const def = WEEKLY_ACTIVITY_DEFS[type as WeeklyActivityType];
      const w1 = entry.weeks[1] ?? 0, w2 = entry.weeks[2] ?? 0, w3 = entry.weeks[3] ?? 0, w4 = entry.weeks[4] ?? 0;
      const total = w1 + w2 + w3 + w4;
      const met = total >= entry.totalTarget;
      body += `<tr><td class="b">${esc(def.label)}</td><td class="r">${w1}</td><td class="r">${w2}</td><td class="r">${w3}</td><td class="r">${w4}</td><td class="r" style="font-weight:700;color:${met ? "#22C55E" : "#EF4444"};">${total}</td><td class="r">${entry.totalTarget}</td></tr>`;
    }
    body += `</tbody></table>`;
  }

  if (opts.textSections.length > 0) {
    body += `<h2><span class="sn">${sectionNum++}</span> Report Sections</h2>`;
    for (const s of opts.textSections) {
      body += `<div class="ts"><div class="ts-label">${esc(s.label)}</div><p>${esc(s.value)}</p></div>`;
    }
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(opts.institutionName)} — ${opts.period} Monthly Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;line-height:1.5}
.cover{width:100%;min-height:100vh;background:linear-gradient(135deg,#0f2647 0%,#1E3A5F 40%,#0369A1 100%);display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;color:white;page-break-after:always;padding:60px 40px}
.cover h1{font-size:36px;font-weight:800;letter-spacing:-0.5px;margin-bottom:8px}
.cover h2{font-size:20px;font-weight:400;color:rgba(255,255,255,0.7);margin-bottom:40px}
.cover-meta{font-size:14px;color:rgba(255,255,255,0.5)}
.cover-meta span{display:inline-block;margin:0 12px}
.cover-divider{width:60px;height:3px;background:rgba(255,255,255,0.2);border-radius:2px;margin:24px auto}
.content{padding:40px 50px;max-width:900px;margin:0 auto}
h2{font-size:16px;color:#1E3A5F;margin:28px 0 14px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;display:flex;align-items:center;gap:8px}
.sn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#1E3A5F;color:white;border-radius:6px;font-size:11px;font-weight:700}
.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}
.kpi-box{text-align:center;padding:18px 10px;border-radius:10px;border:1px solid #e2e8f0;background:#f8fafc}
.kpi-value{font-size:28px;font-weight:800}
.kpi-label{font-size:10px;color:#94a3b8;margin-top:3px;text-transform:uppercase;letter-spacing:0.5px}
table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
th{background:#1E3A5F;color:white;text-align:left;padding:10px 14px;font-weight:600;font-size:11px}
th.r{text-align:right}
td{padding:9px 14px;border-bottom:1px solid #f1f5f9}
td.r{text-align:right}
td.b{font-weight:600}
tr:nth-child(even){background:#f8fafc}
.ts{border-left:3px solid #1E3A5F;padding:14px 20px;background:#f8fafc;border-radius:0 8px 8px 0;margin-bottom:16px}
.ts-label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:6px}
.ts p{font-size:13px;color:#334155;white-space:pre-wrap;line-height:1.7}
.footer{text-align:center;padding:20px 0;margin-top:40px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8}
</style></head><body>
<div class="cover">
  <div style="width:60px;height:60px;background:rgba(255,255,255,0.12);border-radius:14px;display:flex;align-items:center;justify-content:center;margin:0 auto 28px;">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="white" fill-opacity="0.9"/><path d="M9 12l2 2 4-4" stroke="#7DD3FC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>
  <div style="font-size:14px;font-weight:500;color:rgba(255,255,255,0.4);letter-spacing:3px;text-transform:uppercase;margin-bottom:32px;">Illume Student Advisory Services</div>
  <h1>${esc(opts.institutionName)}</h1>
  <h2>${opts.period} — Monthly Report</h2>
  <div class="cover-divider"></div>
  <div class="cover-meta"><span>ICR: ${esc(opts.icrName)}</span><span>|</span><span>Region: ${esc(opts.regionName)}</span><span>|</span><span>Generated: ${generated}</span></div>
</div>
<div class="content">${body}
<div class="footer"><strong>Illume Student Advisory Services</strong> — Confidential<br>${esc(opts.institutionName)} &middot; ${opts.period} Monthly Report &middot; Generated ${generated}</div>
</div></body></html>`;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { role, id: userId, regionId } = session.user as { role: Role; id: string; regionId: string | null };
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });

    const report = await db.monthlyReport.findFirst({
      where: { id: parsed.data.reportId, deletedAt: null },
      include: {
        icr: { select: { name: true, email: true } },
        institution: { select: { name: true, country: true } },
        region: { select: { name: true } },
      },
    });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const isExec = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS"].includes(role);
    if (role === "ICR" && report.icrId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (role === "REGIONAL_MANAGER" && report.regionId !== regionId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!isExec && role !== "ICR" && role !== "REGIONAL_MANAGER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Being allowed to READ this report is not the same as being allowed to send
    // it out of the building. The payload here is the whole report plus a PDF —
    // every lead's name, nationality, programme and stage — to an arbitrary
    // address. `send-section` has required reports.email_external since it was
    // hardened; it moves strictly less data than this route does, and the
    // coarser action must not be the less guarded one.
    if (!(await hasCapability(role, "reports.email_external"))) {
      return NextResponse.json(
        { error: "Your role is not permitted to email reports externally" },
        { status: 403 }
      );
    }

    const period = `${MONTH_NAMES[report.reportingMonth]} ${report.reportingYear}`;
    const icrName = report.icr.name ?? report.icr.email;
    const senderName = (session.user as { name?: string }).name ?? "An Illume user";

    const kpi = report.kpiSummary as PartialKpi;
    const leads = Array.isArray(report.leadsData) ? (report.leadsData as unknown as Array<SnapshotName & { nationality: string; interestedProgram: string; studyLevel: string; stage: string }>) : [];
    const programs = Array.isArray(report.programBreakdown) ? (report.programBreakdown as Array<{ program: string; count: number; levels: Record<string, number> }>) : [];
    const sources = Array.isArray(report.sourcePerformance) ? (report.sourcePerformance as Array<{ name: string; leads: number; enrolled: number }>) : [];
    const events = Array.isArray(report.eventActivities) ? (report.eventActivities as Array<{ name: string; location: string; cost: number; leadsGenerated: number; roi: number | null }>) : [];

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

    const textSections = [
      { label: "Engagement Notes", value: report.engagementNotes },
      { label: "Challenges & Opportunities", value: report.challengesOpportunities },
      { label: "Success Stories", value: report.successStories },
      { label: "Market Insights", value: report.marketInsights },
      { label: "Next Month Plan", value: report.nextMonthPlan },
    ].filter((s): s is { label: string; value: string } => !!s.value);

    // Generate PDF
    const reportHtml = buildReportHtml({
      institutionName: report.institution.name,
      period,
      icrName,
      regionName: report.region?.name ?? "N/A",
      kpi,
      leads,
      programs,
      sources,
      events,
      byType,
      textSections,
    });

    const pdfBuffer = await generatePdfFromHtml(reportHtml);
    const pdfBase64 = pdfBuffer.toString("base64");

    const fileName = `${report.institution.name.replace(/[^a-zA-Z0-9]/g, "-")}_${period.replace(/ /g, "-")}_Report.pdf`;

    // Send email with PDF attached
    const messageBlock = parsed.data.message
      ? `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">${esc(parsed.data.message)}</p>`
      : "";

    const emailHtml = wrapEmail(`Monthly Report — ${report.institution.name} — ${period}`, `
      <div style="background:linear-gradient(135deg,#1E3A5F 0%,#0369A1 100%);border-radius:12px;padding:24px 28px;margin-bottom:24px;">
        <h1 style="margin:0 0 4px;color:#ffffff;font-size:20px;font-weight:800;">${esc(report.institution.name)}</h1>
        <p style="margin:0;color:rgba(255,255,255,0.7);font-size:13px;">${period} — Monthly Report</p>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.4);font-size:11px;">ICR: ${esc(icrName)} &middot; Region: ${esc(report.region?.name ?? "N/A")}</p>
      </div>

      ${messageBlock}

      <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
        Hi, <strong>${esc(senderName)}</strong> has shared the ${period} monthly report for ${esc(report.institution.name)}. The full report is attached as a PDF.
      </p>

      ${kpi ? `<table cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;">
        <tr>
          <td style="width:33%;padding:4px;"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#1E3A5F;">${kpiNum(kpi, "totalLeads")}</div><div style="font-size:9px;color:#94a3b8;margin-top:2px;">LEADS</div></div></td>
          <td style="width:33%;padding:4px;"><div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#22C55E;">${kpiNum(kpi, "enrolled")}</div><div style="font-size:9px;color:#94a3b8;margin-top:2px;">ENROLLED</div></div></td>
          <td style="width:33%;padding:4px;"><div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#0369A1;">${kpiPct(kpi, "conversionRate")}</div><div style="font-size:9px;color:#94a3b8;margin-top:2px;">CONVERSION</div></div></td>
        </tr>
      </table>` : ""}

      <div style="text-align:center;padding:20px 0;margin-top:8px;">
        <p style="margin:0;font-size:13px;color:#64748b;">📎 <strong>${esc(fileName)}</strong> is attached to this email.</p>
      </div>
    `);

    await safeSend({
      to: parsed.data.to,
      subject: `Monthly Report — ${report.institution.name} — ${period}`,
      html: emailHtml,
      attachments: [{ name: fileName, content: pdfBase64 }],
    });

    // Sends a report PDF outside the organisation. Worth a record of who sent
    // what to which address, given this is an egress path.
    void logActivity(session.user.id, "REPORT_EMAILED_EXTERNAL", "MonthlyReport", report.id, {
      to: parsed.data.to,
    }, req);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[email/send-report] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
