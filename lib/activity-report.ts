import { db } from "@/lib/db";
import { safeSend } from "@/lib/email";

/**
 * Weekly activity report for Super Admins.
 *
 * ★ THE POINT: "LOGGED IN" IS NOT "WORKED".
 *
 * A login proves someone opened the door. It does not prove they did anything.
 * This report separates three states, because the difference is the whole
 * question a manager is actually asking:
 *
 *   WORKED       — took at least one business action (created, edited, decided,
 *                  uploaded, exported). Real use of the system.
 *   LOGGED IN    — signed in, but recorded no business action. Present, idle.
 *   NO SIGN-IN   — did not sign in at all during the window.
 *
 * The signal is the audit log. Every business action writes an AuditLog row
 * with the acting user; authentication ceremony (the login itself, MFA, a
 * password reset) writes rows too, and those are deliberately NOT counted as
 * work — otherwise "logged in and did nothing" would read as activity.
 *
 * The emailed summary is static (mail clients strip scripts). The real report
 * is the attached HTML file: open it in a browser and it sorts, filters,
 * searches, and expands each person to show exactly what they did.
 */

/**
 * Actions that are presence or account ceremony, not work. Everything NOT in
 * this set counts as a business action, so a new feature's audit action is
 * treated as real work automatically rather than being silently uncounted.
 */
const PRESENCE_ACTIONS = new Set([
  "LOGIN",
  "LOGOUT",
  "2FA_VERIFIED",
  "MFA_EMAIL_CODE_SENT",
  "MFA_ENABLED",
  "MFA_DISABLED",
  "PASSWORD_RESET",
  "PASSWORD_RESET_REQUESTED",
]);

export type ActivityState = "WORKED" | "LOGGED_IN" | "NO_SIGN_IN";

export interface PersonActivity {
  userId: string;
  name: string;
  employeeId: string | null;
  jobTitle: string | null;
  role: string;
  email: string;
  state: ActivityState;
  workActions: number;
  logins: number;
  lastActiveAt: Date | null;
  /** Action -> count, business actions only, for the drill-down. */
  breakdown: Record<string, number>;
}

export interface ActivityReport {
  from: Date;
  to: Date;
  windowDays: number;
  generatedAt: Date;
  people: PersonActivity[];
  totals: { total: number; worked: number; loggedIn: number; noSignIn: number };
}

/** Internal roles only — Institution Clients are partner logins, not staff. */
const STAFF_WHERE = {
  role: { not: "INSTITUTION_CLIENT" as const },
  deletedAt: null,
  isActive: true,
};

export async function buildActivityReport(windowDays = 7, asOf = new Date()): Promise<ActivityReport> {
  const to = asOf;
  const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const staff = await db.user.findMany({
    where: STAFF_WHERE,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      employee: { select: { employeeId: true, jobTitle: true } },
    },
  });

  const logs = await db.auditLog.findMany({
    where: { createdAt: { gte: from, lte: to }, userId: { not: null } },
    select: { userId: true, action: true, createdAt: true },
  });

  // Fold the log down to a per-user tally in one pass.
  type Tally = { work: number; logins: number; last: Date | null; breakdown: Record<string, number> };
  const byUser = new Map<string, Tally>();
  for (const l of logs) {
    const id = l.userId as string;
    let t = byUser.get(id);
    if (!t) {
      t = { work: 0, logins: 0, last: null, breakdown: {} };
      byUser.set(id, t);
    }
    if (l.action === "LOGIN") t.logins++;
    if (!PRESENCE_ACTIONS.has(l.action)) {
      t.work++;
      t.breakdown[l.action] = (t.breakdown[l.action] ?? 0) + 1;
      if (!t.last || l.createdAt > t.last) t.last = l.createdAt;
    }
  }

  const people: PersonActivity[] = staff.map((u) => {
    const t = byUser.get(u.id);
    const workActions = t?.work ?? 0;
    const logins = t?.logins ?? 0;
    const state: ActivityState =
      workActions > 0 ? "WORKED" : logins > 0 ? "LOGGED_IN" : "NO_SIGN_IN";
    return {
      userId: u.id,
      name: u.name || u.email,
      employeeId: u.employee?.employeeId ?? null,
      jobTitle: u.employee?.jobTitle ?? null,
      role: u.role,
      email: u.email,
      state,
      workActions,
      logins,
      lastActiveAt: t?.last ?? null,
      breakdown: t?.breakdown ?? {},
    };
  });

  // Worked first by volume (most active at the top), then the idle, then the
  // absent — so the people who need a nudge sort to the bottom together.
  const order: Record<ActivityState, number> = { WORKED: 0, LOGGED_IN: 1, NO_SIGN_IN: 2 };
  people.sort(
    (a, b) => order[a.state] - order[b.state] || b.workActions - a.workActions || a.name.localeCompare(b.name),
  );

  const totals = {
    total: people.length,
    worked: people.filter((p) => p.state === "WORKED").length,
    loggedIn: people.filter((p) => p.state === "LOGGED_IN").length,
    noSignIn: people.filter((p) => p.state === "NO_SIGN_IN").length,
  };

  return { from, to, windowDays, generatedAt: to, people, totals };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });

const fmtDateTime = (d: Date | null) =>
  d ? d.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const prettyAction = (a: string) =>
  a.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The interactive report, as one self-contained HTML file. No external assets,
 * so it opens from an email attachment and works offline. Vanilla JS: filter,
 * search, sort, and a per-person drill-down.
 */
export function renderInteractiveReport(r: ActivityReport): string {
  const STATE_LABEL: Record<ActivityState, string> = {
    WORKED: "Worked",
    LOGGED_IN: "Logged in only",
    NO_SIGN_IN: "No sign-in",
  };

  const rows = r.people
    .map((p, i) => {
      const breakdown = Object.entries(p.breakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([a, n]) => `<span class="chip">${esc(prettyAction(a))} × ${n}</span>`)
        .join(" ");
      const detail = p.workActions
        ? `<div class="detail">${breakdown}</div>`
        : p.state === "LOGGED_IN"
          ? `<div class="detail muted">Signed in ${p.logins} time(s) but recorded no action.</div>`
          : `<div class="detail muted">Did not sign in during this period.</div>`;
      return `<tr class="row ${p.state}" data-state="${p.state}" data-i="${i}"
        data-name="${esc(p.name.toLowerCase())} ${esc((p.employeeId ?? "").toLowerCase())} ${esc(p.role.toLowerCase())}"
        data-work="${p.workActions}" data-logins="${p.logins}"
        data-last="${p.lastActiveAt ? p.lastActiveAt.getTime() : 0}">
        <td class="name"><button class="exp" aria-label="expand">›</button>${esc(p.name)}</td>
        <td class="mono">${esc(p.employeeId ?? "—")}</td>
        <td>${esc(p.role.replace(/_/g, " "))}</td>
        <td><span class="badge ${p.state}">${STATE_LABEL[p.state]}</span></td>
        <td class="num">${p.workActions}</td>
        <td class="num">${p.logins}</td>
        <td class="mono">${fmtDateTime(p.lastActiveAt)}</td>
      </tr>
      <tr class="detailrow" data-for="${i}"><td colspan="7">${detail}</td></tr>`;
    })
    .join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Activity Report — ${fmtDate(r.from)} to ${fmtDate(r.to)}</title>
<style>
  :root{--bg:#f6f8fa;--card:#fff;--ink:#0f2335;--muted:#64748b;--line:#e2e8f0;
    --navy:#0f3d5c;--worked:#1c6b3a;--worked-bg:#e7f5ec;--idle:#9a6a00;--idle-bg:#fdf3e0;
    --absent:#b01c2e;--absent-bg:#fdeaec;}
  @media(prefers-color-scheme:dark){:root{--bg:#0b1017;--card:#121a24;--ink:#e6edf3;
    --muted:#93a3b5;--line:#243040;--worked-bg:#0f2a1a;--idle-bg:#2a2208;--absent-bg:#2a1113;}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
    font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px}
  .wrap{max-width:1080px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px;color:var(--navy)}
  @media(prefers-color-scheme:dark){h1{color:#7cc5ff}}
  .sub{color:var(--muted);margin:0 0 20px}
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
  @media(max-width:640px){.tiles{grid-template-columns:repeat(2,1fr)}}
  .tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .tile .n{font-size:26px;font-weight:700}.tile .l{color:var(--muted);font-size:12px}
  .tile.worked .n{color:var(--worked)}.tile.idle .n{color:var(--idle)}.tile.absent .n{color:var(--absent)}
  .controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
  .controls button{background:var(--card);border:1px solid var(--line);color:var(--ink);
    padding:7px 12px;border-radius:999px;cursor:pointer;font-size:13px}
  .controls button.on{background:var(--navy);color:#fff;border-color:var(--navy)}
  .controls input{flex:1;min-width:160px;padding:8px 12px;border:1px solid var(--line);
    border-radius:8px;background:var(--card);color:var(--ink)}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);
    border-radius:12px;overflow:hidden}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line)}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);
    cursor:pointer;user-select:none;white-space:nowrap}
  th.num,td.num{text-align:right}.mono{font-variant-numeric:tabular-nums;color:var(--muted);font-size:13px}
  .name{font-weight:600}.exp{background:none;border:none;color:var(--muted);cursor:pointer;
    font-size:15px;margin-right:6px;transition:transform .15s;display:inline-block}
  tr.open .exp{transform:rotate(90deg)}
  .badge{font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;white-space:nowrap}
  .badge.WORKED{background:var(--worked-bg);color:var(--worked)}
  .badge.LOGGED_IN{background:var(--idle-bg);color:var(--idle)}
  .badge.NO_SIGN_IN{background:var(--absent-bg);color:var(--absent)}
  .detailrow{display:none}.detailrow.show{display:table-row}
  .detail{padding:4px 2px 8px 24px;display:flex;gap:6px;flex-wrap:wrap}
  .detail.muted{color:var(--muted)}
  .chip{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:12px}
  .foot{color:var(--muted);font-size:12px;margin-top:16px}
</style></head><body><div class="wrap">
  <h1>Staff Activity Report</h1>
  <p class="sub">${fmtDate(r.from)} – ${fmtDate(r.to)} (${r.windowDays} days) · generated ${fmtDateTime(r.generatedAt)}</p>
  <div class="tiles">
    <div class="tile"><div class="n">${r.totals.total}</div><div class="l">Staff accounts</div></div>
    <div class="tile worked"><div class="n">${r.totals.worked}</div><div class="l">Worked</div></div>
    <div class="tile idle"><div class="n">${r.totals.loggedIn}</div><div class="l">Logged in, no work</div></div>
    <div class="tile absent"><div class="n">${r.totals.noSignIn}</div><div class="l">Never signed in</div></div>
  </div>
  <div class="controls">
    <button data-f="all" class="on">All</button>
    <button data-f="WORKED">Worked</button>
    <button data-f="LOGGED_IN">Logged in only</button>
    <button data-f="NO_SIGN_IN">No sign-in</button>
    <input id="q" placeholder="Search name, ID, role…">
  </div>
  <table><thead><tr>
    <th data-s="name">Name</th><th data-s="id">ID</th><th data-s="role">Role</th>
    <th data-s="state">Status</th><th class="num" data-s="work">Work</th>
    <th class="num" data-s="logins">Logins</th><th data-s="last">Last active</th>
  </tr></thead><tbody id="tb">
  ${rows}
  </tbody></table>
  <p class="foot">Interactive: click a name to see what they did, click a filter, type to search,
    click a column heading to sort. "Work" counts business actions only — signing in is not work.</p>
</div>
<script>
  var tb=document.getElementById('tb');
  // expand / collapse
  tb.addEventListener('click',function(e){
    var row=e.target.closest('tr.row'); if(!row)return;
    var i=row.getAttribute('data-i');
    var d=tb.querySelector('tr.detailrow[data-for="'+i+'"]');
    row.classList.toggle('open'); if(d)d.classList.toggle('show');
  });
  // filter
  var filter='all';
  document.querySelectorAll('.controls button').forEach(function(b){
    b.onclick=function(){document.querySelectorAll('.controls button').forEach(function(x){x.classList.remove('on')});
      b.classList.add('on');filter=b.getAttribute('data-f');apply();};
  });
  var q=document.getElementById('q'); q.oninput=apply;
  function apply(){
    var term=q.value.toLowerCase();
    tb.querySelectorAll('tr.row').forEach(function(row){
      var okState=filter==='all'||row.getAttribute('data-state')===filter;
      var okText=!term||row.getAttribute('data-name').indexOf(term)>-1;
      var show=okState&&okText;
      row.style.display=show?'':'none';
      var d=tb.querySelector('tr.detailrow[data-for="'+row.getAttribute('data-i')+'"]');
      if(d&&!show){d.classList.remove('show');row.classList.remove('open');}
    });
  }
  // sort
  var dir={};
  document.querySelectorAll('th[data-s]').forEach(function(th){
    th.onclick=function(){
      var key=th.getAttribute('data-s');dir[key]=!dir[key];var sign=dir[key]?1:-1;
      var pairs=[];
      tb.querySelectorAll('tr.row').forEach(function(row){
        pairs.push([row,tb.querySelector('tr.detailrow[data-for="'+row.getAttribute('data-i')+'"]')]);
      });
      pairs.sort(function(a,b){
        var A=val(a[0],key),B=val(b[0],key);
        return (A<B?-1:A>B?1:0)*sign;
      });
      pairs.forEach(function(p){tb.appendChild(p[0]);if(p[1])tb.appendChild(p[1]);});
    };
  });
  function val(row,key){
    if(key==='work')return +row.getAttribute('data-work');
    if(key==='logins')return +row.getAttribute('data-logins');
    if(key==='last')return +row.getAttribute('data-last');
    if(key==='state')return row.getAttribute('data-state');
    if(key==='id')return row.children[1].textContent;
    if(key==='role')return row.children[2].textContent;
    return row.children[0].textContent.trim().toLowerCase();
  }
</script></body></html>`;
}

/** The static summary that goes in the email body (no scripts — mail-safe). */
export function renderEmailSummary(r: ActivityReport): string {
  const idle = r.people.filter((p) => p.state === "LOGGED_IN");
  const absent = r.people.filter((p) => p.state === "NO_SIGN_IN");
  const line = (p: PersonActivity) =>
    `<tr><td style="padding:4px 10px 4px 0">${esc(p.name)}</td>
      <td style="padding:4px 10px;color:#64748b">${esc(p.employeeId ?? "—")}</td>
      <td style="padding:4px 0;color:#64748b">${esc(p.role.replace(/_/g, " "))}</td></tr>`;
  const list = (title: string, ps: PersonActivity[], note: string) =>
    ps.length
      ? `<h3 style="margin:18px 0 6px;color:#0f3d5c;font-size:15px">${title} (${ps.length})</h3>
         <p style="margin:0 0 6px;color:#64748b;font-size:13px">${note}</p>
         <table style="border-collapse:collapse;font-size:14px">${ps.map(line).join("")}</table>`
      : `<h3 style="margin:18px 0 6px;color:#0f3d5c;font-size:15px">${title} (0)</h3>
         <p style="margin:0;color:#1c6b3a;font-size:13px">None — everyone was active.</p>`;

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f2335;max-width:640px">
    <h2 style="color:#0f3d5c;margin:0 0 2px">Weekly Staff Activity</h2>
    <p style="color:#64748b;margin:0 0 16px">${fmtDate(r.from)} – ${fmtDate(r.to)}</p>
    <table style="border-collapse:collapse;margin-bottom:8px">
      <tr>
        <td style="padding:8px 16px;background:#e7f5ec;border-radius:8px;color:#1c6b3a;font-weight:700;font-size:18px">${r.totals.worked}<span style="font-weight:400;font-size:12px;display:block">worked</span></td>
        <td style="width:8px"></td>
        <td style="padding:8px 16px;background:#fdf3e0;border-radius:8px;color:#9a6a00;font-weight:700;font-size:18px">${r.totals.loggedIn}<span style="font-weight:400;font-size:12px;display:block">logged in, idle</span></td>
        <td style="width:8px"></td>
        <td style="padding:8px 16px;background:#fdeaec;border-radius:8px;color:#b01c2e;font-weight:700;font-size:18px">${r.totals.noSignIn}<span style="font-weight:400;font-size:12px;display:block">never signed in</span></td>
      </tr>
    </table>
    <p style="font-size:13px;color:#64748b">Of ${r.totals.total} staff accounts. "Worked" means at least one real action — not just a login.</p>
    ${list("Logged in but did no work", idle, "Present in the system but recorded no action this week.")}
    ${list("Never signed in", absent, "No login at all this week.")}
    <p style="margin:22px 0 0;padding:12px;background:#f1f5f9;border-radius:8px;font-size:13px;color:#475569">
      📎 The attached <b>activity-report.html</b> is interactive — open it in a browser to
      sort, filter, search, and click any person to see exactly what they did.</p>
  </div>`;
}

export interface SendResult {
  sent: boolean;
  recipients: string[];
  report: ActivityReport;
}

/**
 * Build the report and email it to every active Super Admin, with the
 * interactive HTML attached.
 */
export async function sendWeeklyActivityReport(opts: {
  windowDays?: number;
  to?: string[];
  dryRun?: boolean;
} = {}): Promise<SendResult> {
  const report = await buildActivityReport(opts.windowDays ?? 7);

  const recipients =
    opts.to ??
    (await db.user.findMany({
      where: { role: "SUPER_ADMIN", deletedAt: null, isActive: true },
      select: { email: true },
    })).map((u) => u.email);

  if (opts.dryRun || recipients.length === 0) {
    return { sent: false, recipients, report };
  }

  const html = renderInteractiveReport(report);
  const stamp = report.to.toISOString().slice(0, 10);
  const sent = await safeSend({
    to: recipients,
    subject: `Weekly staff activity — ${report.totals.worked} worked, ${report.totals.loggedIn + report.totals.noSignIn} inactive`,
    html: renderEmailSummary(report),
    attachments: [
      { name: `activity-report-${stamp}.html`, content: Buffer.from(html, "utf8").toString("base64") },
    ],
  });

  return { sent, recipients, report };
}
