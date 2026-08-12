/**
 * Display metadata for the permission screens.
 *
 * The lists of roles, resources and actions are NOT defined here — they are
 * derived from PERMISSION_MATRIX via ALL_ROLES / ALL_RESOURCES / ALL_ACTIONS.
 * This file only decorates them.
 *
 * That split is deliberate. The Security tab used to hardcode its own arrays of
 * 8 roles and 12 resources while the matrix carried 11 and 25, so 895 of 1,375
 * permissions existed and were enforced but could never be seen or changed by an
 * administrator. `roleMeta()` and `resourceMeta()` therefore fall back to a
 * synthesised label instead of returning undefined: an entry missing from this
 * file renders as an ungrouped row with a humanised key, which is visible and
 * fixable. It must never be able to hide a permission again.
 */

import {
  Users, Globe, Building2, Calendar, FileText, BarChart2, Briefcase, Settings,
  Megaphone, BookOpen, Plane, ClipboardList, CheckSquare, MessageCircle,
  ShieldAlert, Target, TrendingUp, Handshake, Compass, GraduationCap, Lock,
  // Aliased: an unaliased `Map` import shadows the global Map constructor used
  // by groupResources() below, which fails as a confusing TS7009.
  Map as MapIcon,
  type LucideIcon,
} from "lucide-react";

export interface RoleMeta {
  label: string;
  short: string;
  badge: string;
  description: string;
}

export interface ResourceMeta {
  label: string;
  icon: LucideIcon;
  group: string;
  description: string;
}

/** Group render order. Anything not claimed below lands in "Other". */
export const GROUP_ORDER = [
  "CRM & Recruitment",
  "Insights & Reporting",
  "Operations",
  "HR & ERP",
  "Administration",
  "Other",
] as const;

const ROLE_META: Record<string, RoleMeta> = {
  SUPER_ADMIN:        { label: "Super Admin",         short: "SA",   badge: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",             description: "Full unrestricted access to all modules" },
  HQ_EXECUTIVE:       { label: "HQ Executive",        short: "HQE",  badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300", description: "Executive read & approval access" },
  HQ_ANALYTICS:       { label: "HQ Analytics",        short: "HQA",  badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",         description: "Analytics and reporting focus" },
  REGIONAL_MANAGER:   { label: "Regional Manager",    short: "RM",   badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300", description: "Manages a geographic region" },
  ICR:                { label: "ICR",                 short: "ICR",  badge: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",         description: "Institutional client representative" },
  INSTITUTION_CLIENT: { label: "Institution Client",  short: "INST", badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",     description: "Partner institution user" },
  HR_MANAGER:         { label: "HR Manager",          short: "HRM",  badge: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300", description: "Manages HR and ERP functions" },
  EMPLOYEE:           { label: "Employee",            short: "EMP",  badge: "bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300",     description: "General staff self-service access" },
  ACCOUNT_MANAGER:    { label: "Account Manager",     short: "AM",   badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300",         description: "Owns institution accounts and delivery" },
  ADMISSIONS_SUPPORT: { label: "Admissions Support",  short: "AS",   badge: "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300",          description: "Processes applications and admissions" },
  VP_GLOBAL_SALES:    { label: "VP Global Sales",     short: "VP",   badge: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300", description: "Global sales leadership and approvals" },
};

const RESOURCE_META: Record<string, ResourceMeta> = {
  // ── CRM & Recruitment ──
  leads:                { label: "Student Leads",        icon: Users,        group: "CRM & Recruitment",   description: "Student pipeline & CRM records" },
  sources:              { label: "Lead Sources",         icon: Globe,        group: "CRM & Recruitment",   description: "Lead acquisition source management" },
  institutions:         { label: "Institutions",         icon: Building2,    group: "CRM & Recruitment",   description: "Partner university relationships" },
  stakeholders:         { label: "Stakeholders",         icon: Handshake,    group: "CRM & Recruitment",   description: "Agents, schools & counsellors" },
  events:               { label: "Events",               icon: Calendar,     group: "CRM & Recruitment",   description: "Education fairs & event management" },
  recruitment_network:  { label: "Recruitment Network",   icon: Compass,      group: "CRM & Recruitment",   description: "Partner network & campaigns" },
  recruitment_planning: { label: "Recruitment Planning",  icon: Plane,        group: "CRM & Recruitment",   description: "Quarterly plans, travel & budgets" },

  // ── Insights & Reporting ──
  reports:              { label: "Reports",              icon: FileText,     group: "Insights & Reporting", description: "Monthly performance & approval reports" },
  analytics:            { label: "Analytics",            icon: BarChart2,    group: "Insights & Reporting", description: "Data insights & dashboards" },
  executive_dashboard:  { label: "Executive Dashboard",   icon: TrendingUp,   group: "Insights & Reporting", description: "Board-level KPI overview" },
  markets:              { label: "Markets",              icon: MapIcon,      group: "Insights & Reporting", description: "Country & market records" },
  market_intelligence:  { label: "Market Intelligence",   icon: Target,       group: "Insights & Reporting", description: "Market updates & competitor insight" },

  // ── Operations ──
  activities:           { label: "Activities",           icon: ClipboardList, group: "Operations",          description: "Logged engagement activities" },
  field_operations:     { label: "Field Operations",      icon: ClipboardList, group: "Operations",          description: "Field visits & planned activities" },
  travel:               { label: "Travel",               icon: Plane,        group: "Operations",          description: "Travel requests & itineraries" },
  tasks:                { label: "Tasks",                icon: CheckSquare,  group: "Operations",          description: "Task assignment & workflow" },
  whatsapp:             { label: "WhatsApp",             icon: MessageCircle, group: "Operations",          description: "WhatsApp conversations & messaging" },

  // ── HR & ERP ──
  erp:                  { label: "ERP Data",             icon: Briefcase,    group: "HR & ERP",            description: "Employee attendance, leave, assets" },
  erp_hr:               { label: "HR Admin",             icon: Users,        group: "HR & ERP",            description: "HR management functions & approvals" },
  announcements:        { label: "Announcements",        icon: Megaphone,    group: "HR & ERP",            description: "Company-wide communications" },
  knowledge_base:       { label: "Knowledge Base",       icon: BookOpen,     group: "HR & ERP",            description: "HR policies & documentation" },
  knowledge:            { label: "Knowledge Articles",    icon: GraduationCap, group: "HR & ERP",            description: "Shared knowledge & training material" },

  // ── Administration ──
  users:                { label: "User Management",      icon: Users,        group: "Administration",      description: "System users, roles & onboarding" },
  settings:             { label: "Settings",             icon: Settings,     group: "Administration",      description: "System configuration & security" },
  risk_compliance:      { label: "Risk & Compliance",     icon: ShieldAlert,  group: "Administration",      description: "Risk registers & compliance items" },
};

/** Humanise an unknown key: `market_intelligence` → `Market Intelligence`. */
function humanise(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function roleMeta(role: string): RoleMeta {
  return (
    ROLE_META[role] ?? {
      label: humanise(role),
      short: role.slice(0, 3),
      badge: "bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300",
      description: "No description recorded for this role yet.",
    }
  );
}

export function resourceMeta(resource: string): ResourceMeta {
  return (
    RESOURCE_META[resource] ?? {
      label: humanise(resource),
      icon: Lock,
      group: "Other",
      description: "Not yet described in permission-meta.ts.",
    }
  );
}

export const ACTIONS = [
  { key: "read",    label: "View",          risk: "low"    as const, description: "Can view and search records" },
  { key: "write",   label: "Create / Edit", risk: "medium" as const, description: "Can create and modify records" },
  { key: "delete",  label: "Delete",        risk: "high"   as const, description: "Can permanently remove records" },
  { key: "approve", label: "Approve",       risk: "medium" as const, description: "Can approve and progress workflows" },
  { key: "export",  label: "Export",        risk: "medium" as const, description: "Can export data to external files" },
];

export const RISK_STYLE = {
  low:    "text-emerald-600 dark:text-emerald-400",
  medium: "text-amber-600 dark:text-amber-400",
  high:   "text-red-600 dark:text-red-400",
};

/** Bucket the given resources into ordered groups, preserving GROUP_ORDER. */
export function groupResources(resources: string[]): Array<{ group: string; resources: string[] }> {
  const buckets = new Map<string, string[]>();
  for (const r of resources) {
    const g = resourceMeta(r).group;
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(r);
  }
  const ordered: Array<{ group: string; resources: string[] }> = [];
  for (const g of GROUP_ORDER) {
    if (buckets.has(g)) {
      ordered.push({ group: g, resources: buckets.get(g)! });
      buckets.delete(g);
    }
  }
  // Any group name not in GROUP_ORDER still renders, after the known ones.
  for (const [g, rs] of buckets) ordered.push({ group: g, resources: rs });
  return ordered;
}
