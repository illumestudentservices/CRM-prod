import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

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

  // Capped and ordered by recency: a full student list is unusable in a
  // dropdown, and a task is normally raised against something worked recently.
  const TAKE = 300;
  let data: { id: string; name: string; hint?: string | null }[] = [];

  switch (type as SupportedParentType) {
    case "STUDENT": {
      const rows = await db.lead.findMany({
        where: { deletedAt: null },
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
      const rows = await db.market.findMany({
        select: { id: true, name: true, countryCode: true },
        orderBy: { name: "asc" },
        take: TAKE,
      });
      data = rows.map((r) => ({ id: r.id, name: r.name, hint: r.countryCode }));
      break;
    }
    case "FIELD_OPERATION": {
      const rows = await db.activity.findMany({
        where: { deletedAt: null },
        select: { id: true, title: true, type: true },
        orderBy: { date: "desc" },
        take: TAKE,
      });
      data = rows.map((r) => ({ id: r.id, name: r.title, hint: r.type }));
      break;
    }
    case "CLIENT_ISSUE": {
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
