import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

const createAssetSchema = z.object({
  name: z.string().min(1, "Asset name is required"),
  type: z.string().min(1, "Asset type is required"),
  serialNumber: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  purchasedAt: z.string().transform((v) => new Date(v)).optional().nullable(),
  warrantyEnd: z.string().transform((v) => new Date(v)).optional().nullable(),
  notes: z.string().optional().nullable(),
});

// ─── GET /api/hr/assets ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const assetType = searchParams.get("type");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (assetType) where.type = assetType;

  const assets = await db.iTAsset.findMany({
    where,
    include: {
      assignments: {
        where: { returnedAt: null },
        include: {
          employee: {
            include: { user: { select: { id: true, name: true, image: true } } },
          },
        },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ assets });
}

// ─── POST /api/hr/assets ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!HR_ROLES.includes(session.user.role as Role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createAssetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const data = parsed.data;

  const asset = await db.iTAsset.create({
    data: {
      name: data.name,
      type: data.type,
      serialNumber: data.serialNumber ?? null,
      brand: data.brand ?? null,
      model: data.model ?? null,
      purchasedAt: data.purchasedAt ?? null,
      warrantyEnd: data.warrantyEnd ?? null,
      notes: data.notes ?? null,
      status: "AVAILABLE",
    },
  });

  return NextResponse.json({ asset }, { status: 201 });
}
