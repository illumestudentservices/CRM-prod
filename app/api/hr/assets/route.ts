import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import {
  ASSET_TYPES, ASSET_STATUSES, ASSET_CONDITIONS, PURCHASE_PRECISIONS,
} from "@/lib/assets";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

/**
 * Blank text fields arrive as "" from the form and must become NULL, not an
 * empty string — an empty serial number would collide with every other empty
 * serial number on the unique index, so the second untagged device would be
 * rejected with a constraint error nobody could interpret.
 */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .optional()
  .nullable();

const optionalDate = z
  .string()
  .transform((v) => (v === "" ? null : new Date(v)))
  .refine((v) => v === null || !Number.isNaN(v.getTime()), "Invalid date")
  .optional()
  .nullable();

const createAssetSchema = z.object({
  name: z.string().min(1, "Asset name is required"),
  type: z.enum(ASSET_TYPES),
  // Status is accepted on create because the register is full of devices that
  // have never been "available" — they arrived already in use, or already
  // broken. Defaulted rather than required so the short form still works.
  status: z.enum(ASSET_STATUSES).default("SPARE"),
  condition: z.enum(ASSET_CONDITIONS).optional().nullable(),
  serialNumber: optionalText,
  assetTag: optionalText,
  brand: optionalText,
  model: optionalText,
  regionId: optionalText,
  country: optionalText,
  custodianName: optionalText,
  custodianPosition: optionalText,
  accessories: optionalText,
  verifiedBy: optionalText,
  verifiedAt: optionalDate,
  purchasedAt: optionalDate,
  purchasePrecision: z.enum(PURCHASE_PRECISIONS).optional().nullable(),
  warrantyEnd: optionalDate,
  notes: optionalText,
});

// ─── GET /api/hr/assets ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The full asset register, including who holds each device, used to be
  // readable by anyone signed in — while POST/PATCH/DELETE in this module
  // required HR. Gated on erp_hr:read rather than erp:read, because EMPLOYEE
  // holds erp:read for its own attendance and leave and must not see the
  // organisation-wide inventory.
  if (!(await effectiveHasPermission(session.user.role as Role, "erp_hr", "read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const assetType = searchParams.get("type");
  const regionId = searchParams.get("regionId");
  const condition = searchParams.get("condition");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (assetType) where.type = assetType;
  if (regionId) where.regionId = regionId;
  if (condition) where.condition = condition;

  const assets = await db.iTAsset.findMany({
    where,
    include: {
      region: { select: { id: true, name: true } },
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
    // Grouped by who holds it, then by device, because the question this list
    // gets opened for is "what has this person got" — createdAt order scattered
    // one person's laptop and phone to opposite ends of an 84-row list.
    orderBy: [{ custodianName: "asc" }, { type: "asc" }, { name: "asc" }],
  });

  // The regions list travels with the assets so the filter dropdown does not
  // need a second round trip from a client component that has no other reason
  // to know about regions.
  const regions = await db.region.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ assets, regions });
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

  // A duplicate serial or tag is a 409 with the offending value named, not a
  // raw Prisma P2002. Two people entering the same laptop from two ends of the
  // world is the normal failure mode for a register like this, and "Unique
  // constraint failed on the fields: (`serialNumber`)" tells the second one
  // nothing they can act on.
  for (const [field, value] of [
    ["serialNumber", data.serialNumber],
    ["assetTag", data.assetTag],
  ] as const) {
    if (!value) continue;
    const clash = await db.iTAsset.findFirst({
      where: { [field]: value },
      select: { id: true, name: true, custodianName: true },
    });
    if (clash) {
      return NextResponse.json(
        {
          error:
            `${field === "serialNumber" ? "Serial number" : "Asset tag"} ${value} is already ` +
            `recorded against "${clash.name}"${clash.custodianName ? ` (${clash.custodianName})` : ""}.`,
        },
        { status: 409 }
      );
    }
  }

  const asset = await db.iTAsset.create({
    data: {
      name: data.name,
      type: data.type,
      status: data.status,
      condition: data.condition ?? null,
      serialNumber: data.serialNumber ?? null,
      assetTag: data.assetTag ?? null,
      brand: data.brand ?? null,
      model: data.model ?? null,
      regionId: data.regionId ?? null,
      country: data.country ?? null,
      custodianName: data.custodianName ?? null,
      custodianPosition: data.custodianPosition ?? null,
      accessories: data.accessories ?? null,
      verifiedBy: data.verifiedBy ?? null,
      verifiedAt: data.verifiedAt ?? null,
      purchasedAt: data.purchasedAt ?? null,
      // A date typed into the form's picker is known to the day. Anything less
      // precise comes from the importer, which sets this explicitly.
      purchasePrecision: data.purchasedAt ? (data.purchasePrecision ?? "DAY") : null,
      warrantyEnd: data.warrantyEnd ?? null,
      notes: data.notes ?? null,
    },
  });

  return NextResponse.json({ asset }, { status: 201 });
}
