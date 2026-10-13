import { db } from "@/lib/db";

/**
 * The staff directory: who works here and who reports to whom.
 *
 * ★ WHY THIS IS NOT /api/hr/employees.
 *
 * That endpoint is gated on HR_ROLES and returns the whole Employee record —
 * personal phone, home address, emergency contact, gender, cost centre. It is
 * the right shape for an HR screen and the wrong shape for everybody, which is
 * why staff had no way to look a colleague up at all: the only directory in
 * the system was one they could not open.
 *
 * So this is a separate, deliberately thin read. The fields below are the
 * whole of it, and the list is the security boundary — not a filter applied
 * afterwards, which is the sort of thing a later `include` quietly undoes.
 *
 * ★ WHAT IS IN IT.
 *
 * Name, photo, job title, team, region, work email, and who they report to.
 * Enough to find the right person and see where they sit.
 *
 * ★ WHAT IS NOT, AND WILL NOT BE.
 *
 *   personal phone, home address, emergency contact   — not business contact
 *                                                       details; HR holds them
 *                                                       for a reason
 *   gender                                            — recorded only to decide
 *                                                       parental leave
 *   start date                                        — tenure is nobody's
 *                                                       business by default
 *   cost centre, employment type, salary band         — not a directory's job
 *
 * Work email IS included: looking a colleague up in order to contact them is
 * what a directory is for, and it is a work address, published inside the
 * company only. Everything above stays out.
 */

export const DIRECTORY_SELECT = {
  id: true,
  employeeId: true,
  jobTitle: true,
  managerId: true,
  department: { select: { id: true, name: true } },
  user: {
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      image: true,
      region: { select: { id: true, name: true } },
    },
  },
} as const;

export type DirectoryPerson = {
  id: string;
  employeeId: string;
  name: string;
  jobTitle: string;
  email: string;
  image: string | null;
  department: string | null;
  region: string | null;
  managerId: string | null;
  /** How many people report to them, directly. */
  reports: number;
};

/** Everybody active, in the thin shape above. */
export async function loadDirectory(): Promise<DirectoryPerson[]> {
  const rows = await db.employee.findMany({
    where: { isActive: true, user: { deletedAt: null, isActive: true } },
    select: DIRECTORY_SELECT,
    orderBy: { employeeId: "asc" },
  });

  const reportCount = new Map<string, number>();
  for (const r of rows) {
    if (r.managerId) reportCount.set(r.managerId, (reportCount.get(r.managerId) ?? 0) + 1);
  }

  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    name:
      r.user.name ||
      [r.user.firstName, r.user.lastName].filter(Boolean).join(" ") ||
      r.employeeId,
    jobTitle: r.jobTitle,
    email: r.user.email,
    image: r.user.image,
    department: r.department?.name ?? null,
    region: r.user.region?.name ?? null,
    managerId: r.managerId,
    reports: reportCount.get(r.id) ?? 0,
  }));
}

/**
 * ★ ORPHANS ARE SHOWN, NOT DROPPED.
 *
 * The tree is built from managerId, and anybody whose manager is missing from
 * the list becomes a root. Today there is exactly one root — the CEO, who has
 * no manager by design — but a deactivated manager or a half-finished hire
 * would otherwise make a whole branch vanish from the chart with nothing to
 * show it had gone. A directory that silently omits people is worse than one
 * that shows somebody in the wrong place.
 */
export type DirectoryNode = DirectoryPerson & { children: DirectoryNode[] };

export function buildTree(people: DirectoryPerson[]): DirectoryNode[] {
  const byId = new Map<string, DirectoryNode>(
    people.map((p) => [p.id, { ...p, children: [] }]),
  );

  const roots: DirectoryNode[] = [];
  for (const node of byId.values()) {
    const parent = node.managerId ? byId.get(node.managerId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  // Biggest teams first, then alphabetical — so the chart opens on the shape
  // of the company rather than on whoever happens to sort first.
  const sort = (ns: DirectoryNode[]) => {
    ns.sort((a, b) => b.children.length - a.children.length || a.name.localeCompare(b.name));
    for (const n of ns) sort(n.children);
  };
  sort(roots);

  return roots;
}
