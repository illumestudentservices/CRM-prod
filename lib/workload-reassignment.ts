import { db } from "@/lib/db";
import { PIPELINE_STAGES } from "@/lib/lead-pipeline";
import type { LeadStage, Prisma } from "@prisma/client";

/**
 * Bulk workload reassignment — moving one person's live work to another.
 *
 * Built because the Offboarding queue could complete while a departing ICR's
 * students were left pointing at a disabled account: nobody owned them, and
 * nothing in the app surfaced that. This is the engine behind both the
 * "Reassign workload" action on an approved departure and the hard block on
 * marking access revoked.
 *
 * Two rules shape everything below.
 *
 * 1. ONLY LIVE WORK MOVES. Enrolled students, closed journeys, finished tasks
 *    and completed events stay with the person who did them. Moving them would
 *    hand the receiving ICR someone else's conversion history and silently
 *    restate every funnel and monthly KPI that filters by owner.
 *
 * 2. HISTORY IS NEVER REWRITTEN. `createdById`, `reviewedById`, `approvedById`,
 *    `closedById` and friends record who did a thing, not who owns it. They are
 *    deliberately absent from the registry below and must stay absent.
 */

// ─── What counts as "still being worked" ─────────────────────────────────────

/**
 * Lead stages whose owner should move.
 *
 * Deliberately an ALLOWLIST derived from PIPELINE_STAGES minus ENROLLED, rather
 * than "not in CLOSED_STAGES". Two reasons, and the second is not hypothetical:
 *
 *  - Fail-safe direction. A stage added to the enum later is excluded until
 *    someone opts it in. The denylist form would start silently moving it.
 *  - `CLOSED_STAGES` is currently INCOMPLETE. The LeadStage enum carries
 *    WITHDRAWN and VISA_REFUSED (spec §15), both of which appear in every
 *    exhaustive `Record<LeadStage, ...>` map in lead-pipeline.ts and in
 *    lead-gate's STAGE_CONFIG — but neither was added to CLOSED_STAGES, so
 *    `isClosedStage("WITHDRAWN")` returns false today. `satisfies readonly
 *    LeadStage[]` does not force exhaustiveness the way the Record maps do, so
 *    nothing caught it. A denylist here would reassign withdrawn and
 *    visa-refused students as though they were live.
 *
 * ENROLLED is excluded because it is a finished outcome: lead-pipeline.ts
 * already groups it with the closed stages as INACTIVE_STAGES ("no longer being
 * actively worked") and counts it as the won conversion.
 */
export const ACTIVE_LEAD_STAGES: readonly LeadStage[] = PIPELINE_STAGES.filter(
  (s) => s !== "ENROLLED"
);

/**
 * Task statuses that still represent outstanding work.
 *
 * TODO/NOT_STARTED and DONE/COMPLETED are legacy near-duplicates that both
 * still occur in the data, so both spellings are listed. CANCELLED is finished
 * work in the sense that matters here: nobody has to do anything about it.
 */
export const OPEN_TASK_STATUSES = [
  "TODO",
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING_ON_EXTERNAL_PARTY",
] as const;

/** Event statuses where the event has not yet happened or is still running. */
export const LIVE_EVENT_STATUSES = ["PLANNED", "CONFIRMED", "IN_PROGRESS"] as const;

/**
 * EventParticipation.status is a free String (INVITED / CONFIRMED / DECLINED /
 * ATTENDED / NO_SHOW), not an enum, so this is matched by value. ATTENDED and
 * NO_SHOW are historical facts; DECLINED needs no owner.
 */
export const LIVE_PARTICIPATION_STATUSES = ["INVITED", "CONFIRMED"] as const;

/** Activity statuses that still need someone to run them. */
export const LIVE_ACTIVITY_STATUSES = ["PLANNED", "IN_PROGRESS"] as const;

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * A Prisma client or an interactive-transaction client. Both expose the model
 * delegates; only the top-level client exposes `$transaction`, which the bucket
 * callbacks never need.
 */
type Client = typeof db;
type TxClient = Omit<
  Client,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

/**
 * Who the record is owned by, expressed in the currency each model actually
 * uses. Almost everything points at `users.id`, but Task.assigneeId is an
 * `employees.id` — see the note on the tasks bucket.
 */
export type OwnerKey = "user" | "employee";

export interface ReassignBucket {
  key: string;
  /** Plural noun for the UI. Counts read "34 students", "7 open tasks". */
  label: string;
  /** Which id this bucket's owner column holds. */
  ownerKey: OwnerKey;
  /** One line explaining what is and is not included, shown in the preview. */
  scopeNote: string;
  count(client: TxClient, ownerId: string): Promise<number>;
  move(client: TxClient, fromOwnerId: string, toOwnerId: string): Promise<number>;
}

/**
 * The seven ownership columns in scope, agreed with the business as "pipeline
 * plus field work".
 *
 * Deliberately NOT here, and each for a reason:
 *  - QuarterlyRecruitmentPlan.icrId, MonthlyReport.icrId, WeeklyActivity.icrId
 *    each sit under a compound UNIQUE containing the owner, so a move can
 *    collide with a row the target already has. Out of scope for now; if they
 *    are added later they need a preflight conflict report, not a bare update.
 *  - Institution.accountManagerId, Contract.ownerId, RiskRegister.ownerId and
 *    the other commercial/manager columns are not ICR work. Handing them to a
 *    receiving ICR would widen commercial visibility as a side effect of a
 *    staffing change.
 */
export const REASSIGN_BUCKETS: readonly ReassignBucket[] = [
  {
    key: "leads",
    label: "students",
    ownerKey: "user",
    scopeNote: "Active pipeline only — enrolled and closed students stay put.",
    count: (c, id) =>
      c.lead.count({
        where: { assignedICRId: id, deletedAt: null, stage: { in: [...ACTIVE_LEAD_STAGES] } },
      }),
    move: async (c, from, to) =>
      (
        await c.lead.updateMany({
          where: { assignedICRId: from, deletedAt: null, stage: { in: [...ACTIVE_LEAD_STAGES] } },
          data: { assignedICRId: to },
        })
      ).count,
  },
  {
    key: "interests",
    label: "institution interests",
    ownerKey: "user",
    scopeNote: "Open journeys only — `closedAt` is set on lost, rejected and enrolled.",
    count: (c, id) =>
      c.institutionInterest.count({
        where: { assignedICRId: id, closedAt: null, lead: { deletedAt: null } },
      }),
    move: async (c, from, to) =>
      (
        await c.institutionInterest.updateMany({
          // `closedAt` is authoritative here rather than `stage`: an interest is
          // stamped closed on LOST / APPLICATION_REJECTED / ENROLLED, which is
          // exactly the set we want to leave behind, and it does not depend on
          // the incomplete CLOSED_STAGES list.
          where: { assignedICRId: from, closedAt: null, lead: { deletedAt: null } },
          data: { assignedICRId: to },
        })
      ).count,
  },
  {
    key: "tasks",
    label: "open tasks",
    ownerKey: "employee",
    scopeNote: "Unfinished tasks only. Requires both people to have an employee record.",
    count: (c, id) =>
      c.task.count({
        where: { assigneeId: id, deletedAt: null, status: { in: [...OPEN_TASK_STATUSES] } },
      }),
    move: async (c, from, to) =>
      (
        await c.task.updateMany({
          where: { assigneeId: from, deletedAt: null, status: { in: [...OPEN_TASK_STATUSES] } },
          data: { assigneeId: to },
        })
      ).count,
  },
  {
    key: "events",
    label: "upcoming events",
    ownerKey: "user",
    scopeNote: "Planned, confirmed and in-progress events. Completed ones stay put.",
    count: (c, id) =>
      c.event.count({
        where: { assignedICRId: id, status: { in: [...LIVE_EVENT_STATUSES] } },
      }),
    move: async (c, from, to) =>
      (
        await c.event.updateMany({
          where: { assignedICRId: from, status: { in: [...LIVE_EVENT_STATUSES] } },
          data: { assignedICRId: to },
        })
      ).count,
  },
  {
    key: "eventParticipations",
    label: "event participations",
    ownerKey: "user",
    scopeNote: "Invited and confirmed slots on events that have not finished.",
    count: (c, id) =>
      c.eventParticipation.count({
        where: {
          assignedICRId: id,
          status: { in: [...LIVE_PARTICIPATION_STATUSES] },
          event: { status: { in: [...LIVE_EVENT_STATUSES] } },
        },
      }),
    move: async (c, from, to) =>
      (
        await c.eventParticipation.updateMany({
          where: {
            assignedICRId: from,
            status: { in: [...LIVE_PARTICIPATION_STATUSES] },
            event: { status: { in: [...LIVE_EVENT_STATUSES] } },
          },
          data: { assignedICRId: to },
        })
      ).count,
  },
  {
    key: "activities",
    label: "field activities",
    ownerKey: "user",
    scopeNote: "Planned and in-progress visits, plus undated legacy rows still in the future.",
    count: (c, id) => c.activity.count({ where: activeActivityWhere(id) }),
    move: async (c, from, to) =>
      (
        await c.activity.updateMany({
          where: activeActivityWhere(from),
          data: { userId: to },
        })
      ).count,
  },
  {
    key: "activityFollowUps",
    label: "outstanding follow-ups",
    ownerKey: "user",
    scopeNote: "Follow-ups still flagged as required, including those on closed visits.",
    count: (c, id) => c.activity.count({ where: openFollowUpWhere(id) }),
    move: async (c, from, to) =>
      (
        await c.activity.updateMany({
          where: openFollowUpWhere(from),
          data: { followUpAssigneeId: to },
        })
      ).count,
  },
];

/**
 * `Activity.status` is nullable — it was added mid-rollout and migration 019
 * only backfilled from `endDate`/`outcomes` heuristics, so genuinely old rows
 * can still be null. Treating null as "not live" would strand them with the
 * leaver; treating it as live would drag in years of history. The compromise:
 * a null-status activity counts as live only if it is still in the future.
 */
function activeActivityWhere(ownerId: string): Prisma.ActivityWhereInput {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  return {
    userId: ownerId,
    deletedAt: null,
    OR: [
      { status: { in: [...LIVE_ACTIVITY_STATUSES] } },
      { status: null, date: { gte: startOfToday } },
    ],
  };
}

/**
 * A follow-up outlives its activity: `followUpRequired` is captured when the
 * visit moves to CLOSED, so filtering on a live activity status would miss
 * precisely the follow-ups that exist. Cancelled visits are excluded because
 * their follow-up is moot.
 */
function openFollowUpWhere(ownerId: string): Prisma.ActivityWhereInput {
  return {
    followUpAssigneeId: ownerId,
    followUpRequired: true,
    deletedAt: null,
    NOT: { status: "CANCELLED" as const },
  };
}

// ─── Who may receive, and who may act ────────────────────────────────────────

/**
 * Roles that can actually hold a reassigned caseload.
 *
 * A hardcoded allowlist rather than "every role with `leads:write`", because
 * the matrix and `canAccessLead` disagree and the matrix is the one that lies.
 * ADMISSIONS_SUPPORT, ACCOUNT_MANAGER and VP_GLOBAL_SALES all hold `leads:read`
 * in PERMISSION_MATRIX, yet `canAccessLead` has always denied them every
 * individual lead — deriving recipients from the matrix would let an operator
 * hand 34 students to someone who then gets a 404 on every one of them.
 *
 * HQ_EXECUTIVE and HQ_ANALYTICS are omitted for the opposite reason: they can
 * see everything already, so making them the *owner* of a caseload records a
 * responsibility that does not exist. SUPER_ADMIN is included as the deliberate
 * last resort for an urgent departure with no obvious successor.
 */
export const RECEIVING_ROLES = ["ICR", "REGIONAL_MANAGER", "SUPER_ADMIN"] as const;

export function canReceiveWorkload(role: string): boolean {
  return (RECEIVING_ROLES as readonly string[]).includes(role);
}

/**
 * Which users a given operator may reassign between.
 *
 * Returns a Prisma `UserWhereInput` fragment, or `null` meaning "nobody" — the
 * same shape and the same fail-closed convention as `employeeScopeFor` in
 * lib/offboarding-requests.ts. A regional manager with no region set gets
 * nobody rather than everybody.
 *
 * Applied to BOTH ends of the move and on the POST as well as the pickers:
 * scoping only the dropdowns would leave a hand-crafted userId free to move a
 * caseload across regions.
 */
export function userScopeForReassignment(
  role: string,
  regionId: string | null | undefined
): Prisma.UserWhereInput | null {
  if (role === "SUPER_ADMIN" || role === "HQ_EXECUTIVE") return {};
  if (role === "REGIONAL_MANAGER") {
    if (!regionId) return null;
    return { regionId };
  }
  return null;
}

// ─── Counting ────────────────────────────────────────────────────────────────

export interface WorkloadCount {
  key: string;
  label: string;
  scopeNote: string;
  count: number;
}

export interface WorkloadSummary {
  total: number;
  buckets: WorkloadCount[];
  /**
   * True when the person holds nothing that needs moving. This is what the
   * offboarding hard block tests, so it is computed here rather than by
   * comparing `total` at each call site.
   */
  isClear: boolean;
  /**
   * Set when the person has no Employee record, so the tasks bucket could not
   * be counted at all. Distinct from a zero count.
   */
  taskCountUnavailable: boolean;
}

/**
 * Resolve the employee row id for a user, or null.
 *
 * Task.assigneeId references `employees.id`, NOT `users.id` — the one column in
 * the registry that does. Every caller must therefore resolve both sides of the
 * move through here, and cope with the answer being null: a user account
 * without an employee record cannot hold tasks either way.
 */
export async function employeeIdForUser(
  client: TxClient,
  userId: string
): Promise<string | null> {
  const employee = await client.employee.findFirst({
    where: { userId },
    select: { id: true },
  });
  return employee?.id ?? null;
}

/**
 * What this person still owns that would need reassigning.
 *
 * Runs outside a transaction on purpose: it feeds a preview screen and the
 * offboarding block check, neither of which mutates. The numbers can move
 * between preview and execute, which is why `reassignWorkload` re-reads rather
 * than trusting anything passed to it.
 */
export async function summariseWorkload(
  userId: string,
  client: TxClient = db
): Promise<WorkloadSummary> {
  const employeeId = await employeeIdForUser(client, userId);

  const buckets = await Promise.all(
    REASSIGN_BUCKETS.map(async (bucket): Promise<WorkloadCount> => {
      const ownerId = bucket.ownerKey === "employee" ? employeeId : userId;
      const count = ownerId === null ? 0 : await bucket.count(client, ownerId);
      return { key: bucket.key, label: bucket.label, scopeNote: bucket.scopeNote, count };
    })
  );

  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  return {
    total,
    buckets,
    isClear: total === 0,
    taskCountUnavailable: employeeId === null,
  };
}

// ─── Executing ───────────────────────────────────────────────────────────────

export interface ReassignOutcome {
  moved: Record<string, number>;
  total: number;
  /** Buckets that could not run, with the reason. Never silently empty. */
  skipped: { key: string; reason: string }[];
}

export class ReassignmentError extends Error {}

/**
 * Move every in-scope live record from one user to another.
 *
 * ONE TRANSACTION, deliberately. This is the opposite of the offline-sync
 * route's per-row reporting, and for the opposite reason: offline sync batches
 * independent captures where one bad row must not discard the rest, whereas a
 * half-applied handover is a worse state than no handover — the leaver's access
 * gets revoked on the strength of a move that only partly happened.
 *
 * Every `updateMany` is keyed on the SOURCE owner id, so it is naturally
 * idempotent and safe against a concurrent run: a second execution finds
 * nothing left to move rather than clobbering the first target.
 */
export async function reassignWorkload(opts: {
  fromUserId: string;
  toUserId: string;
}): Promise<ReassignOutcome> {
  const { fromUserId, toUserId } = opts;

  if (fromUserId === toUserId) {
    throw new ReassignmentError("Cannot reassign someone's workload to themselves.");
  }

  return db.$transaction(async (tx) => {
    const [fromEmployeeId, toEmployeeId] = await Promise.all([
      employeeIdForUser(tx, fromUserId),
      employeeIdForUser(tx, toUserId),
    ]);

    const moved: Record<string, number> = {};
    const skipped: { key: string; reason: string }[] = [];

    for (const bucket of REASSIGN_BUCKETS) {
      if (bucket.ownerKey === "employee") {
        // Tasks hang off Employee, not User. Rather than fail the whole
        // handover — which would strand the students too — skip the bucket and
        // say so out loud. A silent zero here would read as "no tasks to move".
        if (fromEmployeeId === null) {
          skipped.push({
            key: bucket.key,
            reason: "The departing user has no employee record, so they hold no tasks.",
          });
          continue;
        }
        if (toEmployeeId === null) {
          skipped.push({
            key: bucket.key,
            reason:
              "The receiving user has no employee record, so tasks cannot be assigned to them.",
          });
          continue;
        }
        moved[bucket.key] = await bucket.move(tx, fromEmployeeId, toEmployeeId);
        continue;
      }
      moved[bucket.key] = await bucket.move(tx, fromUserId, toUserId);
    }

    const total = Object.values(moved).reduce((sum, n) => sum + n, 0);
    return { moved, total, skipped };
  });
}
