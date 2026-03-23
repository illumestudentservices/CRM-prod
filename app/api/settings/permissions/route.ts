import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { PERMISSION_MATRIX } from "@/lib/permissions";

type PermMatrix = Record<string, Record<string, Record<string, boolean>>>;

const ALL_ROLES    = ["SUPER_ADMIN","HQ_EXECUTIVE","HQ_ANALYTICS","REGIONAL_MANAGER","ICR","INSTITUTION_CLIENT","HR_MANAGER","EMPLOYEE"] as const;
const ALL_RESOURCES = ["leads","sources","institutions","events","reports","analytics","erp","erp_hr","users","settings","announcements","knowledge_base"] as const;
const ALL_ACTIONS   = ["read","write","delete","approve","export"] as const;

function buildDefaultMatrix(): PermMatrix {
  const m: PermMatrix = {};
  for (const role of ALL_ROLES) {
    m[role] = {};
    for (const resource of ALL_RESOURCES) {
      m[role][resource] = {};
      const allowed = (PERMISSION_MATRIX as Record<string, Record<string, string[]>>)[role]?.[resource] ?? [];
      for (const action of ALL_ACTIONS) {
        m[role][resource][action] = allowed.includes(action);
      }
    }
  }
  return m;
}

export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const overrides = await db.permissionOverride.findMany();
  const matrix = buildDefaultMatrix();

  for (const o of overrides) {
    if (matrix[o.role]?.[o.resource]) {
      matrix[o.role][o.resource][o.action] = o.granted;
    }
  }

  return NextResponse.json({
    matrix,
    overrides: overrides.map((o) => ({
      role: o.role, resource: o.resource, action: o.action, granted: o.granted,
    })),
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { overrides } = await req.json() as {
    overrides: Array<{ role: string; resource: string; action: string; granted: boolean }>;
  };

  if (!Array.isArray(overrides)) {
    return NextResponse.json({ error: "overrides must be an array" }, { status: 400 });
  }

  const defaults = buildDefaultMatrix();

  // Separate into: restore-to-default (delete) vs actual overrides (upsert)
  const toDelete: Array<{ role: string; resource: string; action: string }> = [];
  const toUpsert: typeof overrides = [];

  for (const o of overrides) {
    const isDefault = defaults[o.role]?.[o.resource]?.[o.action] === o.granted;
    if (isDefault) {
      toDelete.push({ role: o.role, resource: o.resource, action: o.action });
    } else {
      toUpsert.push(o);
    }
  }

  try {
    await db.$transaction([
      // Remove any that match the default (no need to store)
      ...toDelete.map((d) =>
        db.permissionOverride.deleteMany({
          where: { role: d.role as never, resource: d.resource, action: d.action },
        })
      ),
      // Upsert the actual overrides
      ...toUpsert.map((o) =>
        db.permissionOverride.upsert({
          where: { role_resource_action: { role: o.role as never, resource: o.resource, action: o.action } },
          create: { role: o.role as never, resource: o.resource, action: o.action, granted: o.granted, updatedById: session.user.id },
          update: { granted: o.granted, updatedById: session.user.id },
        })
      ),
    ]);
  } catch (err) {
    console.error("[permissions PUT]", err);
    return NextResponse.json({ error: "Failed to save permissions" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, saved: toUpsert.length, restored: toDelete.length });
}
