import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

const assignSchema = z.object({
  action: z.enum(["assign", "return"]),
  employeeId: z.string().min(1).optional(),
  notes: z.string().optional().nullable(),
});

// ─── PATCH /api/hr/assets/[id] — assign or return ─────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!HR_ROLES.includes(session.user.role as Role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed" }, { status: 422 });

  const asset = await db.iTAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  if (parsed.data.action === "assign") {
    if (!parsed.data.employeeId) return NextResponse.json({ error: "employeeId required" }, { status: 422 });
    if (asset.status === "ASSIGNED") return NextResponse.json({ error: "Asset is already assigned" }, { status: 422 });

    await db.$transaction([
      db.assetAssignment.create({
        data: {
          assetId: id,
          employeeId: parsed.data.employeeId,
          notes: parsed.data.notes ?? null,
        },
      }),
      db.iTAsset.update({ where: { id }, data: { status: "ASSIGNED" } }),
    ]);
  } else {
    // Return
    const active = await db.assetAssignment.findFirst({
      where: { assetId: id, returnedAt: null },
    });
    if (!active) return NextResponse.json({ error: "No active assignment found" }, { status: 422 });

    await db.$transaction([
      db.assetAssignment.update({ where: { id: active.id }, data: { returnedAt: new Date() } }),
      db.iTAsset.update({ where: { id }, data: { status: "AVAILABLE" } }),
    ]);
  }

  const updated = await db.iTAsset.findUnique({
    where: { id },
    include: {
      assignments: {
        where: { returnedAt: null },
        include: { employee: { include: { user: { select: { id: true, name: true } } } } },
        take: 1,
      },
    },
  });

  return NextResponse.json({ asset: updated });
}

// ─── DELETE /api/hr/assets/[id] ───────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!HR_ROLES.includes(session.user.role as Role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const asset = await db.iTAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (asset.status === "ASSIGNED") return NextResponse.json({ error: "Cannot delete an assigned asset" }, { status: 422 });

  await db.iTAsset.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
