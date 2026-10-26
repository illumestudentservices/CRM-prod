import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { auditOrigin } from "@/lib/activity-logger";
import { assertNoNulBytes, ApiError } from "@/lib/api-validation";
import { createLeadRecord } from "@/lib/lead-create";
import {
  IMPORT_MAX_ROWS,
  isImportAdmin,
  resolveInstitutionForRow,
  validateImportRow,
} from "@/lib/lead-import";
import { importableInstitutions } from "@/lib/lead-import-scope";

/**
 * POST /api/leads/import
 * Body: { rows: Array<Record<string,string>> } — one object per CSV data row,
 * keyed by column header. The browser parses the CSV and sends the rows; the
 * server re-validates every one (never trusting the client) and enforces that
 * the importer may only create leads for universities they are allowed to.
 *
 * Each row is attempted independently and reported on individually (like the
 * offline-sync batch): one bad row must not discard the good ones.
 */

interface RowResult {
  row: number; // 1-based data row (matches the spreadsheet row minus the header)
  status: "created" | "duplicate" | "error";
  message?: string;
  leadId?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = session.user.role as Role;
  const userId = session.user.id;
  const actorRegionId = session.user.regionId ?? null;

  if (!(await effectiveHasPermission(role, "leads", "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    assertNoNulBytes(body);
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const rows = (body as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "Body must be { rows: [...] }" }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows: ${rows.length}. The limit is ${IMPORT_MAX_ROWS} per import.` },
      { status: 400 }
    );
  }

  // Which universities this actor may import for, and each one's region (so the
  // lead is placed in the university's region and stays visible to that region's
  // manager). Admins get every institution; everyone else only their assigned.
  const allowed = await importableInstitutions(userId, role);
  const admin = isImportAdmin(role);
  if (allowed.length === 0 && !admin) {
    return NextResponse.json(
      { error: "You are not assigned to any university, so you cannot import leads." },
      { status: 403 }
    );
  }
  const regionByInstitution = new Map<string, string | null>();
  if (allowed.length) {
    const regs = await db.institution.findMany({
      where: { id: { in: allowed.map((a) => a.id) } },
      select: { id: true, regionId: true },
    });
    for (const r of regs) regionByInstitution.set(r.id, r.regionId ?? null);
  }

  const results: RowResult[] = [];
  let created = 0;
  let duplicates = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 1;
    const raw = rows[i];
    if (typeof raw !== "object" || raw === null) {
      results.push({ row: rowNo, status: "error", message: "Row is not valid data" });
      failed++;
      continue;
    }

    const valid = validateImportRow(raw as Record<string, unknown>);
    if (!valid.ok) {
      results.push({ row: rowNo, status: "error", message: valid.errors.join("; ") });
      failed++;
      continue;
    }

    const resolved = resolveInstitutionForRow(valid.data.university, allowed, admin);
    if (!resolved.ok) {
      results.push({ row: rowNo, status: "error", message: resolved.error });
      failed++;
      continue;
    }

    try {
      const { leadId, duplicate } = await createLeadRecord(
        {
          ...valid.data,
          institutionId: resolved.institutionId,
          regionId: regionByInstitution.get(resolved.institutionId) ?? actorRegionId,
          // A recruiter owns what they import; an admin importing on behalf of a
          // university leaves it unassigned (the region's team picks it up).
          assignedICRId: admin ? null : userId,
        },
        { userId }
      );
      if (duplicate) {
        duplicates++;
        results.push({ row: rowNo, status: "duplicate", leadId, message: "Created, flagged as a possible duplicate" });
      } else {
        created++;
        results.push({ row: rowNo, status: "created", leadId });
      }
    } catch (err) {
      console.error(`[POST /api/leads/import] row ${rowNo}`, err);
      results.push({ row: rowNo, status: "error", message: "Could not be saved" });
      failed++;
    }
  }

  // One audit row for the batch (each lead also has its own CREATE audit).
  try {
    await db.auditLog.create({
      data: {
        userId,
        action: "CREATE",
        entity: "Lead",
        entityId: "bulk-import",
        changes: { via: "import", submitted: rows.length, created, duplicates, failed },
        ...(await auditOrigin()),
      },
    });
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({
    summary: { submitted: rows.length, created, duplicates, failed },
    results,
  });
}
