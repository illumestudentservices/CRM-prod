import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/**
 * The handful of "how many…?" questions the help widget can answer with real
 * figures.
 *
 * Still no model. These are three fixed queries chosen because they are the
 * questions people actually ask a CRM, and each is scoped to the caller in the
 * same way the corresponding screen is. Intent is matched by keyword, so the
 * widget can only ever run one of these three — it cannot be talked into
 * running an arbitrary query, because there is no mechanism to express one.
 *
 * Every figure here is also visible on a screen. The point is saving a
 * navigation, not becoming a second reporting surface, which is why each
 * answer carries the route it came from.
 */

export interface StatLine {
  label: string;
  value: string;
}

export interface StatAnswer {
  title: string;
  lines: StatLine[];
  /** Where the same figures live on screen. */
  route: string;
  routeLabel: string;
}

export type StatIntent = "my_work" | "pipeline" | "clients";

/**
 * Which question is being asked, if any.
 *
 * Requires both a quantity word and a subject word, so "students" alone still
 * resolves to the Students screen via the normal catalogue search rather than
 * being hijacked into a count. Only a phrasing that is clearly asking for a
 * number gets a number.
 */
export function detectIntent(query: string): StatIntent | null {
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ")} `;
  const has = (...words: string[]) => words.some((w) => q.includes(` ${w} `) || q.includes(`${w} `));

  // Written as plain substring checks rather than one alternation regex. An
  // earlier version used /(...)/ with multi-word alternatives and silently
  // matched nothing, which is a poor trade for cleverness in a function whose
  // whole job is to be predictable.
  const quantity = /how many|how much|number of|count|total|what s on|whats on/.test(q);
  const mine = has("my", "mine", "me") || /i have|assigned to me/.test(q);

  // "on my plate" / "outstanding" / "overdue" are quantity questions without a
  // number word. Bare "to do" is deliberately NOT one: someone typing "my to do
  // list" wants to SEE the list, so that phrasing routes them to Tasks.
  if (mine && has("plate", "outstanding", "overdue", "due")) return "my_work";
  if (mine && quantity && has("task", "tasks", "work", "travel", "trip", "trips")) {
    return "my_work";
  }
  if (!quantity) return null;

  if (/student|lead|applicant|pipeline|enquir|prospect/.test(q)) return "pipeline";
  if (/client|institution|universit/.test(q)) return "clients";
  if (/task|work|travel|trip/.test(q)) return "my_work";
  return null;
}

/** Human labels for pipeline stages; the enum is not for reading. */
function stageLabel(stage: string): string {
  return stage
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Row scope for student figures.
 *
 * Mirrors buildScopeFilter in app/api/leads/route.ts, including the fail-closed
 * default. An unscoped fallback here would let the widget report totals the
 * caller is not entitled to see — the same hole that let an external client
 * read every other client's students.
 */
async function leadScope(role: Role, userId: string): Promise<Record<string, unknown> | null> {
  switch (role) {
    case "SUPER_ADMIN":
    case "HQ_EXECUTIVE":
    case "HQ_ANALYTICS":
      return {};
    case "ICR":
      return { assignedICRId: userId };
    case "REGIONAL_MANAGER": {
      const u = await db.user.findUnique({ where: { id: userId }, select: { regionId: true } });
      return u?.regionId ? { regionId: u.regionId } : {};
    }
    case "INSTITUTION_CLIENT": {
      const rows = await db.institutionUser.findMany({
        where: { userId, assignmentStatus: "ACTIVE" },
        select: { institutionId: true },
      });
      return { institutionId: { in: rows.map((r) => r.institutionId) } };
    }
    default:
      return null;
  }
}

/**
 * Run one intent. Returns null when the caller is not entitled to the figures,
 * so the widget falls back to its normal answer rather than saying "zero" —
 * which would read as "there are none" rather than "you cannot see these".
 */
export async function runStat(
  intent: StatIntent,
  role: Role,
  userId: string
): Promise<StatAnswer | null> {
  if (intent === "my_work") {
    // Task.assigneeId references employees.id, not users.id. Counting against
    // the user id returns zero and reads as "nothing outstanding".
    const employee = await db.employee.findUnique({
      where: { userId }, select: { id: true },
    });
    if (!employee) {
      return {
        title: "Your outstanding work",
        lines: [{ label: "No employee record", value: "tasks and travel are not tracked for this account" }],
        route: "/tasks",
        routeLabel: "Tasks",
      };
    }
    const [byPriority, travel, overdue] = await Promise.all([
      db.task.groupBy({
        by: ["priority"],
        where: {
          assigneeId: employee.id,
          status: { notIn: ["COMPLETED", "DONE", "CANCELLED"] },
        },
        _count: { _all: true },
      }),
      db.travelRequest.count({ where: { employeeId: employee.id, status: "PENDING" } }),
      db.task.count({
        where: {
          assigneeId: employee.id,
          status: { notIn: ["COMPLETED", "DONE", "CANCELLED"] },
          dueDate: { lt: new Date() },
        },
      }),
    ]);

    const open = byPriority.reduce((n, p) => n + p._count._all, 0);
    const lines: StatLine[] = [{ label: "Open tasks", value: String(open) }];
    for (const p of byPriority.sort((a, b) => b._count._all - a._count._all)) {
      lines.push({ label: `  ${stageLabel(p.priority)}`, value: String(p._count._all) });
    }
    if (overdue > 0) lines.push({ label: "Overdue", value: String(overdue) });
    lines.push({ label: "Travel awaiting approval", value: String(travel) });

    return { title: "Your outstanding work", lines, route: "/tasks", routeLabel: "Tasks" };
  }

  if (intent === "pipeline") {
    if (!(await effectiveHasPermission(role, "leads", "read"))) return null;
    const scope = await leadScope(role, userId);
    if (scope === null) return null;

    const grouped = await db.lead.groupBy({
      by: ["stage"],
      where: { ...scope, deletedAt: null },
      _count: { _all: true },
    });
    const total = grouped.reduce((n, g) => n + g._count._all, 0);
    const lines: StatLine[] = [{ label: "Students in scope", value: String(total) }];
    for (const g of grouped.sort((a, b) => b._count._all - a._count._all).slice(0, 8)) {
      lines.push({ label: `  ${stageLabel(g.stage)}`, value: String(g._count._all) });
    }
    return {
      title: "Your student pipeline",
      lines,
      route: "/students",
      routeLabel: "Students & Pipeline",
    };
  }

  if (intent === "clients") {
    if (!(await effectiveHasPermission(role, "institutions", "read"))) return null;
    // An external client is scoped to its own institutions; everyone else with
    // institutions:read sees the portfolio.
    const where =
      role === "INSTITUTION_CLIENT"
        ? {
            deletedAt: null,
            id: {
              in: (
                await db.institutionUser.findMany({
                  where: { userId, assignmentStatus: "ACTIVE" },
                  select: { institutionId: true },
                })
              ).map((r) => r.institutionId),
            },
          }
        : { deletedAt: null };

    const [total, byHealth] = await Promise.all([
      db.institution.count({ where }),
      db.institution.groupBy({
        by: ["accountHealth"],
        where,
        _count: { _all: true },
      }).catch(() => []),
    ]);

    const lines: StatLine[] = [{ label: "Clients", value: String(total) }];
    for (const h of byHealth) {
      if (h.accountHealth) {
        lines.push({ label: `  ${stageLabel(String(h.accountHealth))}`, value: String(h._count._all) });
      }
    }
    return { title: "Your clients", lines, route: "/institutions", routeLabel: "Clients" };
  }

  return null;
}
