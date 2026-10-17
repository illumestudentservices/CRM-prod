import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import type { Role } from "@/lib/permissions";
import { exportDataSubject } from "@/lib/data-subject-export";
import { logActivity } from "@/lib/activity-logger";

/**
 * GET /api/gdpr/export?type=lead|employee&id=<id>
 *
 * Fulfils a Data Subject Access Request (GDPR Art. 15 / 20): returns one
 * person's complete personal data as a downloadable JSON file.
 *
 * ★ THIS DISCLOSES A COMPLETE PERSONAL PROFILE.
 *
 * So it is restricted to the roles that handle privacy requests, and every
 * export is written to the audit log — the act of exporting someone's full
 * record is itself processing that must be accountable (Art. 30).
 */

const EXPORT_ROLES: Role[] = ["SUPER_ADMIN", "HR_MANAGER"];

const querySchema = z.object({
  type: z.enum(["lead", "employee"]),
  id: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!EXPORT_ROLES.includes(session.user.role as Role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = querySchema.safeParse({
    type: req.nextUrl.searchParams.get("type"),
    id: req.nextUrl.searchParams.get("id"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide type=lead|employee and id" },
      { status: 422 },
    );
  }

  const { type, id } = parsed.data;
  const subjectType = type === "lead" ? "LEAD" : "EMPLOYEE";

  const data = await exportDataSubject(subjectType, id);
  if (!data) {
    return NextResponse.json({ error: "Subject not found" }, { status: 404 });
  }

  // The export itself is a disclosure event — record who ran it, for whom.
  await logActivity(session.user.id, "EXPORT", "DataSubjectExport", id, {
    subjectType,
    reason: "GDPR data-subject access request",
  });

  const filename = `dsar-${subjectType.toLowerCase()}-${id}-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
