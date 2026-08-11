import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ALL_ROLES, type Role } from "@/lib/permissions";
import {
  granularMatrixForRole, isDefault,
  CAPABILITY_BY_KEY, FIELD_CATALOG,
} from "@/lib/granular-permissions";

/**
 * Capability- and field-level permission administration.
 *
 * SUPER_ADMIN only — this endpoint decides who can see passport numbers and
 * who can approve budget, so it is deliberately not delegated through the
 * permission matrix it manages (which would let a role grant itself more).
 */

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const byRole: Record<string, Awaited<ReturnType<typeof granularMatrixForRole>>> = {};
  for (const role of ALL_ROLES) {
    byRole[role] = await granularMatrixForRole(role as Role);
  }

  const overrideCount = await db.granularPermission.count();

  return NextResponse.json({ roles: ALL_ROLES, byRole, overrideCount });
}

/**
 * PUT accepts a sparse list of changes. Anything matching the registry default
 * is deleted rather than stored, so the table only ever holds deviations and
 * "reset to default" needs no special case.
 */
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    changes?: Array<{
      role: string;
      scope: "CAPABILITY" | "FIELD";
      resource: string;
      target: string;
      access?: "read" | "write" | null;
      granted: boolean;
    }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const changes = body.changes ?? [];
  if (!Array.isArray(changes)) {
    return NextResponse.json({ error: "changes must be an array" }, { status: 422 });
  }

  // Validate every entry before writing any of them — a half-applied
  // permission change is worse than a rejected one.
  for (const c of changes) {
    if (!ALL_ROLES.includes(c.role as Role)) {
      return NextResponse.json({ error: `Unknown role: ${c.role}` }, { status: 422 });
    }
    if (c.scope === "CAPABILITY") {
      if (!CAPABILITY_BY_KEY[c.target]) {
        return NextResponse.json({ error: `Unknown capability: ${c.target}` }, { status: 422 });
      }
    } else if (c.scope === "FIELD") {
      const cat = FIELD_CATALOG[c.resource];
      if (!cat) return NextResponse.json({ error: `Resource not field-controlled: ${c.resource}` }, { status: 422 });
      if (!cat.fields.some((f) => f.name === c.target)) {
        return NextResponse.json({ error: `Unknown field: ${c.resource}.${c.target}` }, { status: 422 });
      }
      if (c.access !== "read" && c.access !== "write") {
        return NextResponse.json({ error: "FIELD changes need access: read|write" }, { status: 422 });
      }
    } else {
      return NextResponse.json({ error: `Unknown scope: ${c.scope}` }, { status: 422 });
    }
    if (typeof c.granted !== "boolean") {
      return NextResponse.json({ error: "granted must be a boolean" }, { status: 422 });
    }
  }

  // SUPER_ADMIN must not be able to lock itself out of this screen.
  const selfLock = changes.find(
    (c) => c.role === "SUPER_ADMIN" && c.granted === false &&
      (c.target === "users.change_role" || c.resource === "settings")
  );
  if (selfLock) {
    return NextResponse.json(
      { error: "Cannot revoke SUPER_ADMIN's own administration permissions" },
      { status: 409 }
    );
  }

  const ops = changes.map((c) => {
    const access = c.scope === "FIELD" ? (c.access ?? null) : null;
    const def = isDefault(c.role as Role, c.scope, c.resource, c.target, access, c.granted);

    if (def) {
      // Back to default — drop the row.
      return db.granularPermission.deleteMany({
        where: {
          role: c.role as Role, scope: c.scope,
          resource: c.resource, target: c.target,
          ...(access === null ? { access: null } : { access }),
        },
      });
    }

    // deleteMany + create rather than upsert: the unique constraint spans a
    // nullable column, and Postgres treats NULLs as distinct, so upsert can't
    // reliably match a CAPABILITY row.
    return db.$transaction([
      db.granularPermission.deleteMany({
        where: {
          role: c.role as Role, scope: c.scope,
          resource: c.resource, target: c.target,
          ...(access === null ? { access: null } : { access }),
        },
      }),
      db.granularPermission.create({
        data: {
          role: c.role as Role, scope: c.scope,
          resource: c.resource, target: c.target, access,
          granted: c.granted, updatedById: session.user.id,
        },
      }),
    ]);
  });

  await Promise.all(ops);

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "PERMISSIONS_GRANULAR_UPDATED",
      entity: "GranularPermission",
      entityId: "bulk",
      changes: { count: changes.length, changes },
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, applied: changes.length });
}
