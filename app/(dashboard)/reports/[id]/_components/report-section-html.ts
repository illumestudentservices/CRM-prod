import { snapshotName, type SnapshotName } from "@/lib/person-name";

const TH = 'style="background:#1E3A5F;color:#ffffff;text-align:left;padding:10px 14px;font-size:12px;font-weight:600;letter-spacing:0.3px;"';
const TH_R ='style="background:#1E3A5F;color:#ffffff;text-align:right;padding:10px 14px;font-size:12px;font-weight:600;letter-spacing:0.3px;"';
const TD = 'style="padding:10px 14px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;"';
const TD_R = 'style="padding:10px 14px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;text-align:right;"';
const TD_BOLD = 'style="padding:10px 14px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;font-weight:600;"';
const TABLE = 'cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;"';

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kpiBox(value: string, label: string, bg = "#f8fafc", border = "#e2e8f0", color = "#1E3A5F"): string {
  return `<td style="width:33%;padding:6px;">
    <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:14px 8px;text-align:center;">
      <div style="font-size:24px;font-weight:800;color:${color};">${value}</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:3px;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
    </div>
  </td>`;
}

export function renderKpiHtml(kpi: {
  totalLeads: number;
  enrolled: number;
  conversionRate: number;
  contactRate: number;
  eventsCount: number;
  totalEventCost: number;
}): string {
  return `<table cellpadding="0" cellspacing="0" style="width:100%;">
    <tr>
      ${kpiBox(String(kpi.totalLeads), "Total Leads")}
      ${kpiBox(String(kpi.enrolled), "Enrolled", "#f0fdf4", "#bbf7d0", "#22C55E")}
      ${kpiBox(`${kpi.conversionRate}%`, "Conversion", "#eff6ff", "#bfdbfe", "#0369A1")}
    </tr>
    <tr>
      ${kpiBox(`${kpi.contactRate}%`, "Contact Rate")}
      ${kpiBox(String(kpi.eventsCount), "Events", "#fefce8", "#fde68a", "#F59E0B")}
      ${kpiBox(`$${kpi.totalEventCost.toLocaleString()}`, "Event Cost")}
    </tr>
  </table>`;
}

export function renderLeadsHtml(leads: Array<SnapshotName & {
  nationality: string;
  interestedProgram: string;
  studyLevel: string;
  stage: string;
}>): string {
  if (leads.length === 0) return '<p style="color:#94a3b8;font-size:13px;">No leads recorded.</p>';
  const rows = leads.slice(0, 25).map((l, i) =>
    `<tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"};">
      <td ${TD_BOLD}>${esc(snapshotName(l))}</td>
      <td ${TD}>${esc(l.nationality)}</td>
      <td ${TD}>${esc(l.interestedProgram)}</td>
      <td ${TD}>${l.studyLevel}</td>
      <td ${TD}>${l.stage.replace(/_/g, " ")}</td>
    </tr>`
  ).join("");
  const more = leads.length > 25
    ? `<tr><td colspan="5" style="padding:8px 14px;font-size:11px;color:#94a3b8;text-align:center;background:#f8fafc;">+ ${leads.length - 25} more leads</td></tr>`
    : "";
  return `<table ${TABLE}>
    <thead><tr><th ${TH}>Name</th><th ${TH}>Nationality</th><th ${TH}>Program</th><th ${TH}>Level</th><th ${TH}>Stage</th></tr></thead>
    <tbody>${rows}${more}</tbody>
  </table>`;
}

export function renderProgramsHtml(programs: Array<{
  program: string;
  count: number;
  levels: Record<string, number>;
}>): string {
  if (programs.length === 0) return '<p style="color:#94a3b8;font-size:13px;">No program data.</p>';
  const rows = programs.map((p, i) =>
    `<tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"};">
      <td ${TD_BOLD}>${esc(p.program)}</td>
      <td ${TD_R}>${p.count}</td>
      <td ${TD_R}>${p.levels?.["UNDERGRADUATE"] ?? 0}</td>
      <td ${TD_R}>${p.levels?.["POSTGRADUATE"] ?? 0}</td>
      <td ${TD_R}>${p.levels?.["FOUNDATION"] ?? 0}</td>
      <td ${TD_R}>${p.levels?.["PATHWAY"] ?? 0}</td>
    </tr>`
  ).join("");
  return `<table ${TABLE}>
    <thead><tr><th ${TH}>Program</th><th ${TH_R}>Total</th><th ${TH_R}>UG</th><th ${TH_R}>PG</th><th ${TH_R}>Foundation</th><th ${TH_R}>Pathway</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function renderSourcesHtml(sources: Array<{
  name: string;
  leads: number;
  enrolled: number;
}>): string {
  if (sources.length === 0) return '<p style="color:#94a3b8;font-size:13px;">No source data.</p>';
  const rows = sources.map((s, i) => {
    const conv = s.leads > 0 ? `${Math.round((s.enrolled / s.leads) * 100)}%` : "—";
    return `<tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"};">
      <td ${TD_BOLD}>${esc(s.name)}</td>
      <td ${TD_R}>${s.leads}</td>
      <td ${TD_R} style="padding:10px 14px;font-size:13px;color:#22C55E;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${s.enrolled}</td>
      <td ${TD_R}>${conv}</td>
    </tr>`;
  }).join("");
  return `<table ${TABLE}>
    <thead><tr><th ${TH}>Source</th><th ${TH_R}>Leads</th><th ${TH_R}>Enrolled</th><th ${TH_R}>Conversion</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function renderEventsHtml(events: Array<{
  name: string;
  type: string;
  location: string;
  cost: number;
  leadsGenerated: number;
  roi: number | null;
}>): string {
  if (events.length === 0) return '<p style="color:#94a3b8;font-size:13px;">No events this period.</p>';
  const rows = events.map((e, i) =>
    `<tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"};">
      <td ${TD_BOLD}>${esc(e.name)}</td>
      <td ${TD}>${esc(e.location)}</td>
      <td ${TD_R}>${e.leadsGenerated}</td>
      <td ${TD_R}>${e.cost > 0 ? "$" + e.cost.toLocaleString() : "—"}</td>
      <td ${TD_R}>${e.roi !== null ? e.roi : "—"}</td>
    </tr>`
  ).join("");
  return `<table ${TABLE}>
    <thead><tr><th ${TH}>Event</th><th ${TH}>Location</th><th ${TH_R}>Leads</th><th ${TH_R}>Cost</th><th ${TH_R}>ROI</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function renderWeeklyActivitiesHtml(
  weeklyByType: Map<string, { weeks: Record<number, number>; totalTarget: number }>,
  activityDefs: Record<string, { label: string }>,
  activityTypes: readonly string[],
): string {
  if (weeklyByType.size === 0) return '<p style="color:#94a3b8;font-size:13px;">No weekly activities recorded.</p>';
  const rows: string[] = [];
  let i = 0;
  for (const type of activityTypes) {
    const entry = weeklyByType.get(type);
    if (!entry) continue;
    const def = activityDefs[type];
    const w1 = entry.weeks[1] ?? 0;
    const w2 = entry.weeks[2] ?? 0;
    const w3 = entry.weeks[3] ?? 0;
    const w4 = entry.weeks[4] ?? 0;
    const total = w1 + w2 + w3 + w4;
    const met = total >= entry.totalTarget;
    rows.push(
      `<tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"};">
        <td ${TD_BOLD}>${esc(def?.label ?? type)}</td>
        <td ${TD_R}>${w1}</td>
        <td ${TD_R}>${w2}</td>
        <td ${TD_R}>${w3}</td>
        <td ${TD_R}>${w4}</td>
        <td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;color:${met ? "#22C55E" : "#EF4444"};">${total}</td>
        <td ${TD_R}>${entry.totalTarget}</td>
      </tr>`
    );
    i++;
  }
  return `<table ${TABLE}>
    <thead><tr><th ${TH}>Activity</th><th ${TH_R}>Wk 1</th><th ${TH_R}>Wk 2</th><th ${TH_R}>Wk 3</th><th ${TH_R}>Wk 4</th><th ${TH_R}>Total</th><th ${TH_R}>Target</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
}

export function renderTextSectionHtml(title: string, content: string): string {
  return `<div style="border-left:3px solid #1E3A5F;padding:12px 18px;background:#f8fafc;border-radius:0 8px 8px 0;margin:4px 0;">
    <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">${esc(title)}</div>
    <p style="margin:0;font-size:13px;color:#334155;line-height:1.7;white-space:pre-wrap;">${esc(content)}</p>
  </div>`;
}
