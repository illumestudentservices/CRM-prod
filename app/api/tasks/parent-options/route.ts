import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { leadListScope } from "@/lib/lead-access";
import { activityVisibilityWhere } from "@/lib/activity-scope";

/**
 * Records a task can be attached to, for a given parent type.
 *
 * Spec §1 requires every task except a personal or internal one to be linked to
 * a parent record, and the API enforces it. The task form had no parent field
 * at all, so it sent none — and since `category` defaults to OTHER, which
 * requires a parent, EVERY task created from the form was rejected with
 * "parentType and parentId are both required". Task creation was entirely
 * broken; this endpoint is what makes the form able to satisfy the rule.
 *
 * Returns the minimum needed to identify a record in a dropdown.
 */

/** Only the types a user can realistically pick from a list. */
const SUPPORTED = [
  "STUDENT",
  "INSTITUTION",
  "RECRUITMENT_EVENT",
  "RECRUITMENT_PARTNER",
  "MARKET",
  "FIELD_OPERATION",
  "CLIENT_ISSUE",
] as const;

export type SupportedParentType = (typeof SUPPORTED)[number];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Gated on tasks:read — anyone who can see tasks needs to be able to see what
  // a task is attached to.
  if (!(await effectiveHasPermission(session.user.role as Role, "tasks", "read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const type = req.nextUrl.searchParams.get("type") ?? "";
  if (!(SUPPORTED as readonly string[]).includes(type)) {
    return NextResponse.json(
      { error: `Unsupported parent type. Expected one of: ${SUPPORTED.join(", ")}` },
      { status: 422 }
    );
  }

  const { role, id: userId, regionId } = session.user;

  // ★ Each parent type is gated on READ of its OWN resource, and the two
  // person-scoped types (students, field ops) are additionally row-scoped.
  //
  // Holding tasks:read lets you RAISE a task, but it must never become a
  // back door to data the role cannot otherwise see. Before this, the picker
  // listed every lead (name, email, stage), every client, every market and so
  // on to anyone who could open the task form — so an ICR, whose lead access is
  // meant to be only their own students, could read the whole student body by
  // opening the "Related record" dropdown. Each branch now asks the same
  // permission that the record's own page asks, honouring the DB permission
  // overrides (e.g. Market Intelligence removed from ICR), and falls back to an
  // empty list rather than leaking.
  const can = (resource: Parameters<typeof effectiveHasPermission>[1]) =>
    effectiveHasPermission(role as Role, resource, "read");

  // Capped and ordered by recency: a full list is unusable in a dropdown, and a
  // task is normally raised against something worked recently.
  const TAKE = 300;
  let data: { id: string; name: string; hint?: string | null }[] = [];

  switch (type as SupportedParentType) {
    case "STUDENT": {
      if (!(await can("leads"))) break;
      const rows = await db.lead.findMany({
        // The same row scope the lead list and canAccessLead use: an ICR sees
        // only their assigned students, an RM their region, admins all.
        where: { deletedAt: null, ...(await leadListScope(role as Role, userId, regionId)) },
        select: { id: true, firstName: true, lastName: true, email: true, stage: true },
        orderBy: { updatedAt: "desc" },
        take: TAKE,
      });
      data = rows.map((r) => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`.trim() || r.email || "Unnamed student",
        hint: r.stage,
      }));
      break;
    }
    case "INSTITUTION": {
      if (!(await can("institutions"))) break;
      const rows = await db.institution.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, country: true },
        orderBy: { name: "asc" },
        take: TAKE,
      });
      data = rows.map((r) => ({ id: r.id, name: r.name, hint: r.country }));
      break;
    }
    case "RECRUITMENT_EVENT": {
      if (!(await can("events"))) break;
      const rows = await db.event.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, country: true },
        orderBy: { date: "desc" },
        take: TAKE,
      });
      data = rows.map((r) => ({ id: r.id, name: r.name, hint: r.country }));
      break;
    }
    case "RECRUITMENT_PARTNER": {
      if (!(await can("recruitment_network"))) break;
      const rows = await db.recruitmentPartner.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true, country: true },
        orderBy: { name: "asc" },
        take: TAKE,
      });
      data = rows.map((r) => ({ id: r.id, name: r.name, hint: r.country }));
      break;
    }
    case "MARKET": {
      if (!(await can("markets"))) break;
      const rows = await db.market.findMany({
        select: { id: true, name: true, countryCode: true },
        orderBy: { name: "asc" },
        take: TAKE,
      });
      data = rows.map((r) => ({ id: r.id, name: r.name, hint: r.countryCode }));
      break;
    }
    case "FIELD_OPERATION": {
      if (!(await can("activities"))) break;
      const rows = await db.activity.findMany({
        // Field ops are personal: an ICR sees only the ones they registered,
        // supervisors see all. Same rule as lib/activity-scope.ts elsewhere.
        where: { deletedAt: null, ...activityVisibilityWhere(role as Role, userId) },
        select: { id: true, title: true, type: true },
        orderBy: { date: "desc" },
        take: TAKE,
      });
      data = rows.map((r) => ({ id: r.id, name: r.title, hint: r.type }));
      break;
    }
    case "CLIENT_ISSUE": {
      // Client issues are children of institutions and gated with them.
      if (!(await can("institutions"))) break;
      const rows = await db.clientIssue.findMany({
        select: { id: true, title: true, severity: true },
        orderBy: { createdAt: "desc" },
        take: TAKE,
      });
      data = rows.map((r) => ({ id: r.id, name: r.title, hint: r.severity }));
      break;
    }
  }

  return NextResponse.json({ data, truncated: data.length >= TAKE });
}
