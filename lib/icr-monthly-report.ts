/**
 * Auto-fill for the ICR Monthly Report.
 *
 * The paper template asks a rep for about forty numbers they already entered
 * into the CRM once. This module answers every one of those the CRM can answer
 * honestly, so the rep is left writing only the parts that are judgement:
 * highlights, risks, market read, priorities and asks.
 *
 * Two rules run through the whole file.
 *
 * FLOW vs STOCK. "Applications Submitted" in §1.1 is a flow — how many crossed
 * that line during the month — and it is counted from the STAGE_CHANGE trail,
 * not from how many leads happen to sit in that stage today. Counting current
 * stage would report a lead that applied in June again in July, and would drop
 * one that applied and was rejected in the same month. §1.2 is the opposite: a
 * stock, a photograph of where the pipeline stands. They are different
 * questions and they are computed differently.
 *
 * NEVER INVENT A NUMBER. Where the CRM does not hold something the template
 * asks for — visa approvals, and the per-metric targets — this returns null and
 * says so, rather than deriving a plausible-looking figure. A monthly target
 * pro-rated from an annual institution target would look precise and mean
 * nothing.
 */
import { db } from "@/lib/db";
import { displayNameOr } from "@/lib/person-name";
import {
  WEEKLY_ACTIVITY_LIST,
  WEEKS_OF_MONTH,
  type WeeklyActivityType,
} from "@/lib/weekly-activities";
import type { LeadStage, Prisma } from "@prisma/client";

/**
 * Prisma's Json input accepts only its own JsonValue union, not a structural
 * interface — even one that is plainly serialisable. The shapes below are all
 * valid JSON, so this is the cast that says so, in one place instead of at
 * every write site.
 */
export function asJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

/** The mirror of `asJson` for reads: a stored snapshot back into its shape. */
export function fromJson<T>(value: unknown): T | undefined {
  return value == null ? undefined : (value as unknown as T);
}

// ── Shapes stored on the report ────────────────────────────────────────────

export type Trend = "UP" | "DOWN" | "FLAT" | "NEW";

export interface PerformanceRow {
  key: string;
  label: string;
  /** Rep-entered. The CRM holds only annual, institution-level enrolment
   *  targets, which cannot be divided into a monthly per-rep figure without
   *  making one up. */
  target: number | null;
  /** null means "the CRM does not track this", which is not the same as 0. */
  thisMonth: number | null;
  previousMonth: number | null;
  trend: Trend | null;
  /** Shown under the row when thisMonth is null. */
  notTrackedNote?: string;
}

export interface PipelineSnapshot {
  activeLeads: number;
  applicationsInProgress: number;
  offersPending: number;
  depositsPending: number;
}

export interface InstitutionRow {
  institutionId: string;
  name: string;
  leads: number;
  applications: number;
  offers: number;
  deposits: number;
  enrolments: number;
}

export interface PriorityApplicationRow {
  leadId: string;
  student: string;
  program: string;
  stage: string;
  daysInStage: number;
  /** Prefilled from the CRM, editable by the rep. */
  issue: string;
  /** Always the rep's to write. */
  requiredAction: string;
}

export interface AgentEngagement {
  agentMeetings: number;
  newAgentsIdentified: number;
  trainingsDelivered: number;
  accountPlanning: number;
}

export interface AgentRow {
  partnerId: string;
  name: string;
  leads: number;
  applications: number;
  deposits: number;
  note: string;
}

export interface AtRiskAgentRow {
  partnerId: string;
  name: string;
  /** Prefilled with why the CRM flagged them. */
  issue: string;
  actionPlan: string;
}

export interface EventRow {
  eventId: string;
  name: string;
  date: string;
  cost: number;
  leadsGenerated: number;
  /** Computed. The template asks for "ROI Outlook", which is a judgement; this
   *  is the arithmetic the rep should make that judgement from. */
  costPerLead: number | null;
  roiOutlook: string;
  quality: string;
}

/**
 * §8 — one of the six mandatory activities, rolled up over the month.
 *
 * `entered` is the load-bearing field. A rep who did the work but never opened
 * the planner is not a rep who did nothing, and reporting them at 0% would say
 * that they were. Where the planner holds nothing, `pct` is null and the
 * section says so — the same rule as the visa row in §1.1.
 */
export interface MonthlyKpiRow {
  type: WeeklyActivityType;
  label: string;
  cadence: "WEEKLY" | "MONTHLY";
  /** Monthly target: a weekly cadence is multiplied by the four planner weeks. */
  target: number;
  completed: number;
  /** null when the planner holds nothing for this month — not zero. */
  pct: number | null;
  /** Whether any planner row exists for this activity in this month. */
  entered: boolean;
  /** The free-text notes the rep typed per week, blanks dropped. */
  detail: string[];
}

export interface AutoFilledSections {
  performance: PerformanceRow[];
  pipelineSnapshot: PipelineSnapshot;
  institutionBreakdown: InstitutionRow[];
  priorityApplications: PriorityApplicationRow[];
  agentEngagement: AgentEngagement;
  topAgents: AgentRow[];
  atRiskAgents: AtRiskAgentRow[];
  eventActivities: EventRow[];
  monthlyKpi: MonthlyKpiRow[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<string, string> = {
  NEW_LEAD: "New Lead",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  APPLICATION_SUBMITTED: "Application Submitted",
  AWAITING_DECISION: "Awaiting Decision",
  OFFER_RECEIVED: "Offer Received",
  DEPOSIT_PAID: "Deposit Paid",
  ENROLLED: "Enrolled",
  LOST: "Lost",
  DEFERRED: "Deferred",
  APPLICATION_REJECTED: "Application Rejected",
  WITHDRAWN: "Withdrawn",
  VISA_REFUSED: "Visa Refused",
};

/** Inclusive start, inclusive end-of-day, for a calendar month. */
export function periodBounds(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 0, 23, 59, 59, 999),
  };
}

function previousPeriod(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/**
 * A month with no prior activity is "NEW", not "UP". Reporting a first month as
 * an improvement over a month that did not happen overstates it.
 */
function trendOf(now: number, prev: number): Trend {
  if (prev === 0) return now > 0 ? "NEW" : "FLAT";
  if (now > prev) return "UP";
  if (now < prev) return "DOWN";
  return "FLAT";
}

const ACTIVE_STAGES: LeadStage[] = ["NEW_LEAD", "CONTACTED", "QUALIFIED"];
const IN_APPLICATION_STAGES: LeadStage[] = ["APPLICATION_SUBMITTED", "AWAITING_DECISION"];

/** Both spellings of a stage move; an override is still a move. */
const STAGE_CHANGE_TYPES = ["STAGE_CHANGE", "STAGE_CHANGE_OVERRIDE"];

/**
 * How many of this rep's leads crossed into `stage` during the window.
 *
 * Counts distinct leads rather than rows: a lead pushed back and forth across
 * the same boundary twice in one month is one application, not two.
 */
async function countTransitions(
  icrId: string,
  stage: LeadStage,
  start: Date,
  end: Date
): Promise<number> {
  const rows = await db.leadActivity.findMany({
    where: {
      type: { in: STAGE_CHANGE_TYPES },
      metadata: { path: ["to"], equals: stage },
      createdAt: { gte: start, lte: end },
      lead: { assignedICRId: icrId, deletedAt: null },
    },
    select: { leadId: true },
    distinct: ["leadId"],
  });
  return rows.length;
}

/** The same count, but grouped by the institution each lead belongs to. */
async function transitionsByInstitution(
  icrId: string,
  stage: LeadStage,
  start: Date,
  end: Date
): Promise<Map<string, number>> {
  const rows = await db.leadActivity.findMany({
    where: {
      type: { in: STAGE_CHANGE_TYPES },
      metadata: { path: ["to"], equals: stage },
      createdAt: { gte: start, lte: end },
      lead: { assignedICRId: icrId, deletedAt: null },
    },
    select: { leadId: true, lead: { select: { institutionId: true } } },
    distinct: ["leadId"],
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = r.lead?.institutionId;
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** The same count again, grouped by the partner that sourced the lead. */
async function transitionsBySource(
  icrId: string,
  stage: LeadStage,
  start: Date,
  end: Date
): Promise<Map<string, number>> {
  const rows = await db.leadActivity.findMany({
    where: {
      type: { in: STAGE_CHANGE_TYPES },
      metadata: { path: ["to"], equals: stage },
      createdAt: { gte: start, lte: end },
      lead: { assignedICRId: icrId, deletedAt: null },
    },
    select: { leadId: true, lead: { select: { sourceId: true } } },
    distinct: ["leadId"],
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = r.lead?.sourceId;
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

// ── §1.1 Performance Overview ──────────────────────────────────────────────

async function buildPerformance(
  icrId: string,
  year: number,
  month: number
): Promise<PerformanceRow[]> {
  const cur = periodBounds(year, month);
  const prevP = previousPeriod(year, month);
  const prev = periodBounds(prevP.year, prevP.month);

  const leadsIn = (start: Date, end: Date) =>
    db.lead.count({
      where: { assignedICRId: icrId, deletedAt: null, createdAt: { gte: start, lte: end } },
    });

  const [
    leadsNow, leadsPrev,
    appsNow, appsPrev,
    offersNow, offersPrev,
    depositsNow, depositsPrev,
    enrolNow, enrolPrev,
  ] = await Promise.all([
    leadsIn(cur.start, cur.end),
    leadsIn(prev.start, prev.end),
    countTransitions(icrId, "APPLICATION_SUBMITTED", cur.start, cur.end),
    countTransitions(icrId, "APPLICATION_SUBMITTED", prev.start, prev.end),
    countTransitions(icrId, "OFFER_RECEIVED", cur.start, cur.end),
    countTransitions(icrId, "OFFER_RECEIVED", prev.start, prev.end),
    countTransitions(icrId, "DEPOSIT_PAID", cur.start, cur.end),
    countTransitions(icrId, "DEPOSIT_PAID", prev.start, prev.end),
    countTransitions(icrId, "ENROLLED", cur.start, cur.end),
    countTransitions(icrId, "ENROLLED", prev.start, prev.end),
  ]);

  const row = (key: string, label: string, now: number, was: number): PerformanceRow => ({
    key,
    label,
    target: null,
    thisMonth: now,
    previousMonth: was,
    trend: trendOf(now, was),
  });

  return [
    row("leads", "Leads Generated", leadsNow, leadsPrev),
    row("applications", "Applications Submitted", appsNow, appsPrev),
    row("offers", "Offers Issued", offersNow, offersPrev),
    row("deposits", "Deposits Received", depositsNow, depositsPrev),
    row("enrolments", "Enrolments", enrolNow, enrolPrev),
    {
      // The template asks for this. The CRM records visa REFUSALS (date and
      // reason, on the student) but has no approval field and no VISA_APPROVED
      // stage, so there is nothing to count. Left explicitly untracked rather
      // than filled with a zero that would read as "none were approved".
      key: "visaApprovals",
      label: "Visa Approvals",
      target: null,
      thisMonth: null,
      previousMonth: null,
      trend: null,
      notTrackedNote: "Not tracked in the CRM — visa refusals are recorded, approvals are not.",
    },
  ];
}

// ── §1.2 Application Pipeline Snapshot ─────────────────────────────────────

async function buildPipelineSnapshot(icrId: string): Promise<PipelineSnapshot> {
  const base = { assignedICRId: icrId, deletedAt: null };
  const [activeLeads, applicationsInProgress, offersPending, depositsPending] = await Promise.all([
    db.lead.count({ where: { ...base, stage: { in: ACTIVE_STAGES } } }),
    db.lead.count({ where: { ...base, stage: { in: IN_APPLICATION_STAGES } } }),
    db.lead.count({ where: { ...base, stage: "OFFER_RECEIVED" } }),
    db.lead.count({ where: { ...base, stage: "DEPOSIT_PAID" } }),
  ]);
  return { activeLeads, applicationsInProgress, offersPending, depositsPending };
}

// ── Per-institution rollup ─────────────────────────────────────────────────

async function buildInstitutionBreakdown(
  icrId: string,
  year: number,
  month: number
): Promise<InstitutionRow[]> {
  const { start, end } = periodBounds(year, month);

  const leadGroups = await db.lead.groupBy({
    by: ["institutionId"],
    where: { assignedICRId: icrId, deletedAt: null, createdAt: { gte: start, lte: end } },
    _count: { _all: true },
  });

  const [apps, offers, deposits, enrolments] = await Promise.all([
    transitionsByInstitution(icrId, "APPLICATION_SUBMITTED", start, end),
    transitionsByInstitution(icrId, "OFFER_RECEIVED", start, end),
    transitionsByInstitution(icrId, "DEPOSIT_PAID", start, end),
    transitionsByInstitution(icrId, "ENROLLED", start, end),
  ]);

  // An institution belongs in the report if anything happened for it — a new
  // lead, or a move on an older one. Keying only off new leads would drop the
  // school where the rep spent the month closing last quarter's applications.
  const ids = new Set<string>();
  for (const g of leadGroups) if (g.institutionId) ids.add(g.institutionId);
  for (const m of [apps, offers, deposits, enrolments]) for (const k of m.keys()) ids.add(k);
  if (ids.size === 0) return [];

  const institutions = await db.institution.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(institutions.map((i) => [i.id, i.name]));
  const leadCount = new Map(
    leadGroups.filter((g) => g.institutionId).map((g) => [g.institutionId as string, g._count._all])
  );

  return [...ids]
    .map((id) => ({
      institutionId: id,
      name: nameOf.get(id) ?? "Unknown institution",
      leads: leadCount.get(id) ?? 0,
      applications: apps.get(id) ?? 0,
      offers: offers.get(id) ?? 0,
      deposits: deposits.get(id) ?? 0,
      enrolments: enrolments.get(id) ?? 0,
    }))
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
}

// ── §1.3 Priority Applications Requiring Admissions Support ────────────────

/** Past this many days in one application-side stage, an application is stuck
 *  enough to be worth a manager's attention. */
const STALLED_DAYS = 21;

async function buildPriorityApplications(
  icrId: string,
  year: number,
  month: number
): Promise<PriorityApplicationRow[]> {
  const { end } = periodBounds(year, month);
  const cutoff = new Date(end.getTime() - STALLED_DAYS * 86_400_000);

  const stuck = await db.lead.findMany({
    where: {
      assignedICRId: icrId,
      deletedAt: null,
      stage: { in: [...IN_APPLICATION_STAGES, "OFFER_RECEIVED"] },
      stageEnteredAt: { lte: cutoff },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      interestedProgram: true,
      stage: true,
      stageEnteredAt: true,
    },
    orderBy: { stageEnteredAt: "asc" },
    take: 10,
  });

  return stuck.map((l) => {
    const days = Math.floor((end.getTime() - l.stageEnteredAt.getTime()) / 86_400_000);
    return {
      leadId: l.id,
      // Email is nullable — booth capture often has a name and a phone only.
      student: displayNameOr(l, l.email ?? "Unnamed student"),
      program: l.interestedProgram,
      stage: STAGE_LABELS[l.stage] ?? l.stage,
      daysInStage: days,
      issue: `${days} days in ${STAGE_LABELS[l.stage] ?? l.stage} with no stage movement.`,
      requiredAction: "",
    };
  });
}

// ── §2.1–2.3 Agents ────────────────────────────────────────────────────────

async function buildAgentEngagement(
  icrId: string,
  year: number,
  month: number
): Promise<AgentEngagement> {
  const { start, end } = periodBounds(year, month);
  // Field Ops writes the real date to `actualDate` on completion and `date` is
  // the planned one, so a completed activity is counted on the day it actually
  // happened where that is known.
  const inPeriod = {
    OR: [
      { actualDate: { gte: start, lte: end } },
      { actualDate: null, date: { gte: start, lte: end } },
    ],
  };
  const base = { userId: icrId, deletedAt: null, ...inPeriod };

  const [agentMeetings, trainingsDelivered, accountPlanning, newAgentsIdentified] =
    await Promise.all([
      db.activity.count({ where: { ...base, type: "AGENT_MEETING" } }),
      db.activity.count({ where: { ...base, type: "AGENT_TRAINING" } }),
      db.activity.count({ where: { ...base, type: "PARTNER_MEETING" } }),
      db.recruitmentPartner.count({
        where: {
          type: "AGENT",
          deletedAt: null,
          createdById: icrId,
          createdAt: { gte: start, lte: end },
        },
      }),
    ]);

  return { agentMeetings, newAgentsIdentified, trainingsDelivered, accountPlanning };
}

async function buildAgentTables(
  icrId: string,
  year: number,
  month: number
): Promise<{ topAgents: AgentRow[]; atRiskAgents: AtRiskAgentRow[] }> {
  const { start, end } = periodBounds(year, month);

  const leadGroups = await db.lead.groupBy({
    by: ["sourceId"],
    where: { assignedICRId: icrId, deletedAt: null, createdAt: { gte: start, lte: end } },
    _count: { _all: true },
  });
  const [apps, deposits] = await Promise.all([
    transitionsBySource(icrId, "APPLICATION_SUBMITTED", start, end),
    transitionsBySource(icrId, "DEPOSIT_PAID", start, end),
  ]);

  const ids = new Set<string>();
  for (const g of leadGroups) if (g.sourceId) ids.add(g.sourceId);
  for (const m of [apps, deposits]) for (const k of m.keys()) ids.add(k);

  const partners = ids.size
    ? await db.recruitmentPartner.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, name: true },
      })
    : [];
  const nameOf = new Map(partners.map((p) => [p.id, p.name]));
  const leadCount = new Map(
    leadGroups.filter((g) => g.sourceId).map((g) => [g.sourceId as string, g._count._all])
  );

  const topAgents: AgentRow[] = [...ids]
    .map((id) => ({
      partnerId: id,
      name: nameOf.get(id) ?? "Unknown partner",
      leads: leadCount.get(id) ?? 0,
      applications: apps.get(id) ?? 0,
      deposits: deposits.get(id) ?? 0,
      note: "",
    }))
    .sort((a, b) => b.leads - a.leads || b.applications - a.applications)
    .slice(0, 5);

  // At risk means one of two specific things, both of which are visible in the
  // data: a partner who sent volume before and sent none this month, or one who
  // sent leads this month that produced no application at all. Anything vaguer
  // would be the rep's judgement, and §2.3 already gives them a field for that.
  const activeBefore = await db.lead.groupBy({
    by: ["sourceId"],
    where: {
      assignedICRId: icrId,
      deletedAt: null,
      createdAt: { lt: start },
      sourceId: { not: null },
    },
    _count: { _all: true },
  });

  const atRisk: AtRiskAgentRow[] = [];
  const seen = new Set<string>();

  for (const g of activeBefore) {
    const id = g.sourceId as string;
    if ((leadCount.get(id) ?? 0) > 0) continue;
    seen.add(id);
    atRisk.push({
      partnerId: id,
      name: "",
      issue: `No new leads this month (${g._count._all} previously).`,
      actionPlan: "",
    });
  }
  for (const a of topAgents) {
    if (a.leads > 0 && a.applications === 0 && !seen.has(a.partnerId)) {
      seen.add(a.partnerId);
      atRisk.push({
        partnerId: a.partnerId,
        name: a.name,
        issue: `${a.leads} lead${a.leads === 1 ? "" : "s"} this month but no applications submitted.`,
        actionPlan: "",
      });
    }
  }

  const missingNames = atRisk.filter((a) => !a.name).map((a) => a.partnerId);
  if (missingNames.length) {
    const rows = await db.recruitmentPartner.findMany({
      where: { id: { in: missingNames } },
      select: { id: true, name: true },
    });
    const m = new Map(rows.map((r) => [r.id, r.name]));
    for (const a of atRisk) if (!a.name) a.name = m.get(a.partnerId) ?? "Unknown partner";
  }

  return { topAgents, atRiskAgents: atRisk.slice(0, 8) };
}

// ── §3.1 Events Conducted ──────────────────────────────────────────────────

async function buildEvents(icrId: string, year: number, month: number): Promise<EventRow[]> {
  const { start, end } = periodBounds(year, month);
  const events = await db.event.findMany({
    where: { assignedICRId: icrId, deletedAt: null, date: { gte: start, lte: end } },
    select: {
      id: true,
      name: true,
      date: true,
      totalCost: true,
      _count: { select: { leads: true } },
    },
    orderBy: { date: "asc" },
  });

  return events.map((e) => ({
    eventId: e.id,
    name: e.name,
    date: e.date.toISOString(),
    cost: e.totalCost,
    leadsGenerated: e._count.leads,
    costPerLead:
      e.totalCost > 0 && e._count.leads > 0
        ? Math.round((e.totalCost / e._count.leads) * 100) / 100
        : null,
    roiOutlook: "",
    quality: "",
  }));
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * §8 — the Monthly KPI table.
 *
 * Rolls the Weekly Activity Planner (Reports → Weekly Activities) up over the
 * four weeks of the reporting month. The planner is the CRM's copy of the
 * "Illume KPIs" spreadsheet and is already keyed on icr + year + month + week,
 * so this is a straight sum rather than a derivation.
 *
 * The target comes from the planner rows the rep actually has, not from the
 * registry default, because a target can be adjusted per week. Only where a
 * week has no row at all does the registry default stand in for it — otherwise
 * a rep whose manager lowered one week's target would be measured against a
 * number nobody agreed to.
 */
async function buildMonthlyKpi(
  icrId: string,
  year: number,
  month: number
): Promise<MonthlyKpiRow[]> {
  const rows = await db.weeklyActivity.findMany({
    where: { icrId, year, month },
    select: { type: true, weekOfMonth: true, target: true, completed: true, detail: true },
  });

  return WEEKLY_ACTIVITY_LIST.map((def) => {
    const mine = rows.filter((r) => r.type === def.type);
    const entered = mine.length > 0;

    // A monthly-cadence activity is one target for the whole month, not one per
    // week — multiplying it by four would ask for four webinars.
    const weeks = def.cadence === "MONTHLY" ? 1 : WEEKS_OF_MONTH.length;
    const target = entered
      ? def.cadence === "MONTHLY"
        // Monthly cadence: the rep may hold rows in several weeks but the
        // target is the month's, so take one rather than the sum.
        ? Math.max(...mine.map((r) => r.target), def.defaultTarget)
        : mine.reduce((sum, r) => sum + r.target, 0) +
          // Weeks with no row still carry the agreed target.
          (WEEKS_OF_MONTH.length - mine.length) * def.defaultTarget
      : def.defaultTarget * weeks;

    const completed = mine.reduce((sum, r) => sum + r.completed, 0);

    return {
      type: def.type,
      label: def.label,
      cadence: def.cadence,
      target,
      completed,
      // Not `entered ? ... : 0`. An empty planner means unknown, not none.
      pct: entered && target > 0 ? Math.round((completed / target) * 100) : null,
      entered,
      detail: mine
        .sort((a, b) => a.weekOfMonth - b.weekOfMonth)
        .map((r) => (r.detail ?? "").trim())
        .filter((d) => d.length > 0),
    };
  });
}

/**
 * Everything the CRM can fill in for one rep and one month.
 *
 * Called at generation and again on an explicit refresh. It is deliberately a
 * pure read — it writes nothing — so the caller decides whether the result
 * becomes a new snapshot or is thrown away.
 */
export async function computeAutoFilledSections(
  icrId: string,
  year: number,
  month: number
): Promise<AutoFilledSections> {
  const [
    performance,
    pipelineSnapshot,
    institutionBreakdown,
    priorityApplications,
    agentEngagement,
    agentTables,
    eventActivities,
    monthlyKpi,
  ] = await Promise.all([
    buildPerformance(icrId, year, month),
    buildPipelineSnapshot(icrId),
    buildInstitutionBreakdown(icrId, year, month),
    buildPriorityApplications(icrId, year, month),
    buildAgentEngagement(icrId, year, month),
    buildAgentTables(icrId, year, month),
    buildEvents(icrId, year, month),
    buildMonthlyKpi(icrId, year, month),
  ]);

  return {
    performance,
    pipelineSnapshot,
    institutionBreakdown,
    priorityApplications,
    agentEngagement,
    topAgents: agentTables.topAgents,
    atRiskAgents: agentTables.atRiskAgents,
    eventActivities,
    monthlyKpi,
  };
}

/**
 * Carries the rep's typing across a refresh.
 *
 * A refresh re-reads the CRM, which would otherwise blank the editable cells
 * embedded in the auto-filled tables — the targets in §1.1, the required
 * actions in §1.3, the agent notes and action plans, the ROI and quality calls
 * on events. Rows that no longer exist simply drop; rows that are new come back
 * empty for the rep to fill.
 */
export function mergeRepEdits(
  fresh: AutoFilledSections,
  previous: Partial<AutoFilledSections> | null
): AutoFilledSections {
  if (!previous) return fresh;

  const targets = new Map(
    (previous.performance ?? []).map((r) => [r.key, r.target])
  );
  for (const row of fresh.performance) {
    const kept = targets.get(row.key);
    if (kept != null) row.target = kept;
  }

  const priors = new Map(
    (previous.priorityApplications ?? []).map((r) => [r.leadId, r])
  );
  for (const row of fresh.priorityApplications) {
    const kept = priors.get(row.leadId);
    if (!kept) continue;
    // The prefilled issue text is regenerated with the new day count, so only
    // an issue the rep actually rewrote is preserved.
    if (kept.requiredAction) row.requiredAction = kept.requiredAction;
    if (kept.issue && kept.issue !== `${kept.daysInStage} days in ${kept.stage} with no stage movement.`) {
      row.issue = kept.issue;
    }
  }

  const notes = new Map((previous.topAgents ?? []).map((r) => [r.partnerId, r.note]));
  for (const row of fresh.topAgents) {
    const kept = notes.get(row.partnerId);
    if (kept) row.note = kept;
  }

  const plans = new Map((previous.atRiskAgents ?? []).map((r) => [r.partnerId, r.actionPlan]));
  for (const row of fresh.atRiskAgents) {
    const kept = plans.get(row.partnerId);
    if (kept) row.actionPlan = kept;
  }

  const evs = new Map((previous.eventActivities ?? []).map((r) => [r.eventId, r]));
  for (const row of fresh.eventActivities) {
    const kept = evs.get(row.eventId);
    if (!kept) continue;
    if (kept.roiOutlook) row.roiOutlook = kept.roiOutlook;
    if (kept.quality) row.quality = kept.quality;
  }

  return fresh;
}
