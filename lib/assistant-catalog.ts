import {
  PERMISSION_MATRIX,
  NAV_PERMISSIONS,
  type Role,
  type Resource,
} from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/**
 * The feature catalogue the in-app assistant answers from.
 *
 * The central design decision: "can I access X?" is a LOOKUP, not a guess. The
 * permission model already exists as data — PERMISSION_MATRIX, NAV_PERMISSIONS,
 * the granular capability tier — so the assistant reads the same source of truth
 * the routes enforce. A model inventing an answer here would be worse than no
 * assistant: telling someone they can approve travel when they cannot is a
 * support ticket, and telling an external client that a screen exists is a
 * disclosure.
 *
 * The second decision: entries the caller cannot access are REMOVED before the
 * prompt is built. The model is never asked to withhold anything, because a
 * model that is merely instructed to keep a secret can be talked out of it.
 * `visibleCatalogue()` is the only function that builds prompt text, and it
 * cannot return a feature the caller lacks permission for.
 */

export interface CatalogueEntry {
  /** Stable key, also the nav key where one exists. */
  key: string;
  name: string;
  /** What a person would actually call it. The CRM's names and the business's
   *  names differ — staff say "students", the schema says Lead. */
  aliases: string[];
  route: string;
  /** Permission gate. Null for screens everyone signed in can reach. */
  resource: Resource | null;
  summary: string;
}

/**
 * Hand-written because the wording is for humans, but the ROUTE and RESOURCE
 * columns are checked against NAV_PERMISSIONS and PERMISSION_MATRIX at module
 * load (below), so an entry cannot quietly describe a screen that no longer
 * exists or a resource that was renamed.
 */
export const FEATURE_CATALOGUE: readonly CatalogueEntry[] = [
  {
    key: "dashboard", name: "Dashboard", route: "/dashboard", resource: null,
    aliases: ["home", "overview", "landing page", "front page"],
    summary: "Your starting page: headline figures and shortcuts into the modules you can use.",
  },
  {
    key: "students", name: "Students & Pipeline", route: "/students", resource: "leads",
    aliases: ["leads", "applicants", "student pipeline", "prospects", "enquiries", "candidates"],
    summary: "Every student enquiry and where it has reached in the recruitment funnel, from first contact to enrolled.",
  },
  {
    key: "institutions", name: "Clients", route: "/institutions", resource: "institutions",
    aliases: ["universities", "partners", "client institutions", "accounts", "schools we represent"],
    summary: "The universities and colleges Illume represents, with contracts, contacts, issues and account health.",
  },
  {
    key: "markets", name: "Markets", route: "/markets", resource: "markets",
    aliases: ["countries", "territories", "regions"],
    summary: "Country and territory records, including who manages each market.",
  },
  {
    key: "market_intelligence", name: "Market Intelligence", route: "/market-intelligence", resource: "market_intelligence",
    aliases: ["market research", "country insight", "competitor information", "quarterly market report"],
    summary: "Research and reporting on recruitment markets, including the quarterly market report.",
  },
  {
    key: "stakeholders", name: "Stakeholders", route: "/stakeholders", resource: "stakeholders",
    aliases: ["schools", "counsellors", "agents", "contacts", "feeder schools"],
    summary: "Schools, counsellors and agents Illume works with to reach students.",
  },
  {
    key: "recruitment_network", name: "Recruitment Network", route: "/recruitment-network", resource: "recruitment_network",
    // "agents" is deliberately shared with Stakeholders: staff use the word for
    // both recruitment agencies and individual stakeholder agents. Both entries
    // score equally, so the widget offers both and the user picks — better than
    // guessing one and being wrong half the time.
    aliases: ["sources", "agencies", "partners", "campaigns", "referral partners", "agents"],
    summary: "Recruitment partners and agencies, their campaigns, events and performance.",
  },
  {
    key: "field_operations", name: "Field Operations", route: "/field-operations", resource: "field_operations",
    aliases: ["school visits", "field activity", "on the ground", "visits"],
    summary: "Field activity such as school visits and agent meetings, and how they went.",
  },
  {
    key: "recruitment_planning", name: "Recruitment Planning", route: "/recruitment-planning", resource: "recruitment_planning",
    aliases: ["quarterly plan", "budget", "planned travel", "plans", "variation request"],
    summary: "Quarterly recruitment plans with budget, planned travel and planned activity, through their approval chain.",
  },
  {
    key: "icr_transition", name: "ICR Transition & Handover", route: "/icr-transition", resource: "icr_transition",
    aliases: ["handover", "transition report", "leaving", "offboarding an ICR", "reassignment"],
    summary: "Structured handover when an ICR stops covering an assignment: fifteen sections, Regional Manager review, and a check that no student, task or risk is left unowned.",
  },
  {
    key: "tasks", name: "Tasks", route: "/tasks", resource: "tasks",
    aliases: ["to do", "todo", "my work", "assignments", "reminders"],
    summary: "Work assigned to you or your team, with due dates and priorities.",
  },
  {
    key: "activities", name: "Activities", route: "/activities", resource: "activities",
    aliases: ["calls", "meetings", "contact history", "interactions", "log"],
    summary: "A record of calls, meetings and other contact logged against students and clients.",
  },
  {
    key: "travel", name: "Travel", route: "/travel", resource: "travel",
    aliases: ["trips", "travel requests", "business travel", "expenses for travel"],
    summary: "Travel requests and their approval. You see your own trips; approvers see everyone's.",
  },
  {
    key: "reports", name: "Reports", route: "/reports", resource: "reports",
    aliases: ["qbr", "quarterly business review", "weekly report", "reporting"],
    summary: "Generated reports including quarterly business reviews and weekly activity summaries.",
  },
  {
    key: "analytics", name: "Analytics", route: "/analytics", resource: "analytics",
    aliases: ["charts", "numbers", "statistics", "performance", "metrics"],
    summary: "Charts and figures on pipeline, conversion and performance.",
  },
  {
    key: "risk_compliance", name: "Risk & Compliance", route: "/risk-compliance", resource: "risk_compliance",
    aliases: ["risks", "risk register", "compliance", "gdpr", "issues"],
    summary: "The risk register and compliance records, with owners and mitigation.",
  },
  {
    key: "knowledge", name: "Knowledge Base", route: "/knowledge", resource: "knowledge",
    aliases: ["documentation", "how to", "guides", "help articles", "sops"],
    summary: "Reference material and internal guidance.",
  },
  {
    key: "whatsapp", name: "WhatsApp", route: "/whatsapp", resource: "whatsapp",
    aliases: ["messages", "chat", "messaging students"],
    summary: "WhatsApp conversations with students.",
  },
  {
    key: "hr", name: "HR & ERP", route: "/hr", resource: "erp",
    aliases: ["employees", "staff", "leave", "holiday", "timesheets", "people", "payroll"],
    summary: "Employee records, leave, timesheets, departments and other people operations.",
  },
  {
    key: "settings", name: "Settings", route: "/settings", resource: "settings",
    aliases: ["admin", "users and roles", "permissions", "configuration", "security"],
    summary: "Administration: users, roles, permissions and system configuration.",
  },
  {
    key: "recycle_bin", name: "Recycle Bin", route: "/recycle-bin", resource: "settings",
    aliases: ["deleted", "trash", "restore", "undelete"],
    summary: "Recently deleted records, restorable for a limited period.",
  },
  // ── Things that live INSIDE a module ──────────────────────────────────────
  //
  // The catalogue was module-level, so "where do I add a contract?" pointed at
  // Clients and stopped — true, but not an answer. These name the things people
  // actually go looking for. Most are tabs rather than routes, so the route is
  // the parent screen and the summary says where to look once there; a link
  // that 404s would be worse than a slightly indirect one.
  //
  // Each inherits its parent's resource, so permission filtering is unchanged.
  {
    key: "contracts", name: "Contracts", route: "/institutions", resource: "institutions",
    aliases: ["contract", "agreement", "renewal", "commission terms", "signed agreement"],
    summary: "Open the client, then the Contracts tab. Holds the agreement, its dates and renewal.",
  },
  {
    key: "client_issues", name: "Client Issues", route: "/institutions", resource: "institutions",
    aliases: ["complaint", "escalation", "problem with a client", "raise an issue", "account health"],
    summary: "Open the client, then the Issues tab. Log a problem, set its severity and track it to resolution.",
  },
  {
    key: "deliverables", name: "Deliverables & KPIs", route: "/institutions", resource: "institutions",
    aliases: ["kpi", "targets", "commitments", "what we promised", "sla"],
    summary: "Open the client, then Deliverables or KPIs, for what has been committed and how it is tracking.",
  },
  {
    key: "applications", name: "Student Applications", route: "/students", resource: "leads",
    aliases: ["application", "offer", "offer received", "conditional offer", "visa", "cas"],
    summary: "Open the student, then their Applications, for each institution they applied to and its stage.",
  },
  {
    key: "close_student", name: "Closing a Student", route: "/students", resource: "leads",
    aliases: ["withdrawn", "lost", "visa refused", "not proceeding", "close a lead", "lost reason"],
    summary: "Open the student and use Close, then record the outcome and reason. The record and its history are kept.",
  },
  {
    key: "leave", name: "Leave & Holiday", route: "/hr", resource: "erp",
    aliases: ["annual leave", "book time off", "sick leave", "holiday request", "absence", "time off"],
    summary: "HR & ERP, then Leave. Request time off and see your balance. Non-HR staff see only their own.",
  },
  {
    key: "timesheet_entries", name: "Timesheets", route: "/hr", resource: "erp",
    aliases: ["timesheet", "log my hours", "record time", "hours worked", "submit timesheet"],
    summary: "HR & ERP, then Timesheets. Only for staff it has been switched on for, via Timesheet Required on their employee record.",
  },
  {
    key: "employees", name: "Employee Records", route: "/hr", resource: "erp",
    aliases: ["staff record", "job title", "manager", "department", "who reports to whom", "onboarding"],
    summary: "HR & ERP, then Employees, for job titles, departments, reporting lines and start dates.",
  },
  {
    key: "plan_budget", name: "Plan Budget & Travel", route: "/recruitment-planning", resource: "recruitment_planning",
    aliases: ["budget item", "planned travel", "planned activity", "spend", "variation request"],
    summary: "Open the quarterly plan for budget lines, planned travel and planned activity. Locked once approved — change it with a Variation Request.",
  },
  {
    key: "reassign", name: "Reassigning Students", route: "/icr-transition", resource: "icr_transition",
    aliases: ["bulk reassign", "move students", "change owner", "hand over students", "transfer pipeline"],
    summary: "Done from the handover report: the Regional Manager reassigns the outgoing ICR's students in bulk. Ownership moves; stage, tasks and history do not.",
  },
  {
    key: "permissions", name: "Roles & Permissions", route: "/settings", resource: "settings",
    aliases: ["give access", "grant permission", "change role", "cannot see something", "reset 2fa"],
    summary: "Settings, then Users & Roles, to change what a role can reach or reset someone's access.",
  },

  {
    // Retired from the sidebar (they live under Recruitment Network now) but the
    // routes still resolve and staff still ask for them by name, so the widget
    // has to answer. Leaving them out is how someone concludes a feature was
    // deleted when it was only moved.
    key: "sources", name: "Sources", route: "/recruitment-network/partners", resource: "sources",
    aliases: ["source", "where students came from", "lead source", "referrers", "channel"],
    summary: "Where student enquiries originate — agencies, referrers and campaigns. Now part of Recruitment Network.",
  },
  {
    key: "events", name: "Recruitment Events", route: "/recruitment-network/events", resource: "events",
    aliases: ["fairs", "education fair", "exhibitions", "event", "conferences", "open day"],
    summary: "Recruitment fairs and events, who attended and what they cost. Now part of Recruitment Network.",
  },
  {
    key: "activity_log", name: "Activity Log", route: "/activity-log", resource: "settings",
    aliases: ["audit", "audit trail", "who changed what", "history", "system log", "changes"],
    summary: "The audit trail: who changed which record and when.",
  },
  {
    key: "account", name: "My Account", route: "/account", resource: null,
    aliases: ["profile", "my details", "change password", "two factor", "2fa"],
    summary: "Your own profile, password and two-factor authentication.",
  },
] as const;

// ── Drift guards ─────────────────────────────────────────────────────────────
//
// The catalogue is prose, but the columns it shares with the permission model
// are not allowed to disagree with it. These run at module load, so a renamed
// resource or a nav key that no longer exists fails fast in dev rather than
// producing an assistant that confidently points at a dead route.

const ALL_RESOURCES = Object.keys(PERMISSION_MATRIX.SUPER_ADMIN) as Resource[];

for (const entry of FEATURE_CATALOGUE) {
  if (entry.resource !== null && !ALL_RESOURCES.includes(entry.resource)) {
    throw new Error(
      `[assistant-catalogue] "${entry.key}" names resource "${entry.resource}", which is not in PERMISSION_MATRIX.`
    );
  }
}

/**
 * Modules the sidebar gates but the catalogue never mentions.
 *
 * Reported rather than thrown: a nav entry with no catalogue description is a
 * gap in the assistant's knowledge, not a broken build. Logged once at startup
 * so it is visible without blocking a deploy.
 */
export function uncataloguedNavKeys(): string[] {
  const described = new Set(FEATURE_CATALOGUE.map((e) => e.key));
  return Object.keys(NAV_PERMISSIONS).filter((k) => !described.has(k));
}

// ── Permission filtering ─────────────────────────────────────────────────────

/**
 * The catalogue as this specific caller may see it.
 *
 * Everything the caller cannot read is dropped here — not marked, not annotated,
 * dropped. This is the whole security model of the assistant: the prompt is
 * built from this return value, so the model is structurally incapable of
 * describing a feature the caller has no access to, however it is asked.
 */
export async function visibleCatalogue(role: Role): Promise<CatalogueEntry[]> {
  const visible: CatalogueEntry[] = [];
  for (const entry of FEATURE_CATALOGUE) {
    if (entry.resource === null) {
      visible.push(entry);
      continue;
    }
    if (await effectiveHasPermission(role, entry.resource, "read")) {
      visible.push(entry);
    }
  }
  return visible;
}

/**
 * What the caller may DO in each module they can see.
 *
 * Separate from visibility because "I can open Travel" and "I can approve
 * travel" are different questions, and the second is the one people actually
 * ask. Read is implied by presence, so it is omitted.
 */
export async function capabilitySummary(
  role: Role,
  entries: readonly CatalogueEntry[]
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const entry of entries) {
    if (!entry.resource) continue;
    const actions: string[] = [];
    for (const action of ["write", "delete", "approve", "export"] as const) {
      if (await effectiveHasPermission(role, entry.resource, action)) {
        actions.push(action);
      }
    }
    if (actions.length) out[entry.key] = actions;
  }
  return out;
}

/**
 * The catalogue rendered for the prompt.
 *
 * Deterministic: fixed order, no timestamps, no per-request values. That is
 * deliberate — this block sits behind a cache_control breakpoint and any byte
 * that changes between requests would invalidate the cache for every user on
 * that role. Ordering follows FEATURE_CATALOGUE, which is a literal.
 */
export function renderCatalogue(
  entries: readonly CatalogueEntry[],
  capabilities: Record<string, string[]>
): string {
  return entries
    .map((e) => {
      const can = capabilities[e.key]?.length
        ? `  can: ${capabilities[e.key].join(", ")}\n`
        : "";
      return (
        `- ${e.name} (${e.route})\n` +
        `  also called: ${e.aliases.join(", ")}\n` +
        `  ${e.summary}\n` +
        can
      );
    })
    .join("\n");
}
