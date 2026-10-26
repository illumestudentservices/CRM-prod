import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { buildTemplateCsv } from "@/lib/lead-import";

/**
 * GET /api/leads/import/template
 * Downloads the blank CSV template (header row + one example row). Gated on the
 * same permission as the import itself, so the template is only handed to people
 * who could actually use it.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await effectiveHasPermission(session.user.role as Role, "leads", "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const csv = buildTemplateCsv();
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="lead-import-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
