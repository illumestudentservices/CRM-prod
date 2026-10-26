import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { buildTemplateCsv, isImportAdmin } from "@/lib/lead-import";
import { importableInstitutions } from "@/lib/lead-import-scope";

/**
 * GET /api/leads/import/template
 * Downloads the blank CSV template (header row + one example row). Gated on the
 * same permission as the import itself, so the template is only handed to people
 * who could actually use it.
 *
 * For a recruiter who represents exactly one university, the university column
 * is pre-filled with their university — they can only import for it anyway.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = session.user.role as Role;
  if (!(await effectiveHasPermission(role, "leads", "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let university: string | undefined;
  if (!isImportAdmin(role)) {
    const insts = await importableInstitutions(session.user.id, role);
    if (insts.length === 1) university = insts[0].name;
  }

  const csv = buildTemplateCsv({ university });
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="lead-import-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
