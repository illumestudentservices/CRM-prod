import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { trashRecord } from "@/lib/recycle-bin";
import {
  ASSET_TYPES, ASSET_STATUSES, ASSET_CONDITIONS, PURCHASE_PRECISIONS,
} from "@/lib/assets";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

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

/**
 * Three actions on one route, discriminated on `action`.
 *
 * `update` is new. Until now an asset could be created, assigned, returned and
 * deleted, but never CORRECTED — so a typo in a serial number, or a device that
 * had since been repaired, could only be fixed by deleting the record and
 * retyping it, which loses its assignment history. That gap did not matter much
 * with an empty register; with 84 imported rows carrying "Unknown" models and
 * conditions people will want to firm up, it is the most-needed action here.
 */
const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    employeeId: z.string().min(1),
    notes: optionalText,
  }),
  z.object({
    action: z.literal("return"),
  }),
  z.object({
    action: z.literal("update"),
    name: z.string().min(1).optional(),
    type: z.enum(ASSET_TYPES).optional(),
    status: z.enum(ASSET_STATUSES).optional(),
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
  }),
]);

// ─── PATCH /api/hr/assets/[id] — assign, return or edit ───────────────────────

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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const d = parsed.data;

  const asset = await db.iTAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  if (d.action === "assign") {
    // Asked of the assignment table rather than of `status`. The old check was
    // `status === "ASSIGNED"`, which read a denormalised copy of this same fact
    // — and now that status carries the register's operational state instead,
    // that check would have been simply wrong.
    const held = await db.assetAssignment.findFirst({
      where: { assetId: id, returnedAt: null },
      select: { id: true },
    });
    if (held) {
      return NextResponse.json(
        { error: "This asset is already out with someone. Return it first." },
        { status: 422 }
      );
    }
    const employee = await db.employee.findUnique({
      where: { id: d.employeeId },
      select: { id: true, jobTitle: true, user: { select: { name: true } } },
    });
    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 422 });

    await db.$transaction([
      db.assetAssignment.create({
        data: { assetId: id, employeeId: d.employeeId, notes: d.notes ?? null },
      }),
      // The custodian name is kept in step with the assignment so the register
      // does not go on naming whoever held the device last. It stays populated
      // rather than being nulled, because the whole list reads by custodian and
      // a device with an assignment but no name would sort into a nameless
      // group of one.
      db.iTAsset.update({
        where: { id },
        data: {
          status: "IN_USE",
          custodianName: employee.user.name ?? asset.custodianName,
          custodianPosition: employee.jobTitle ?? asset.custodianPosition,
        },
      }),
    ]);
  } else if (d.action === "return") {
    const active = await db.assetAssignment.findFirst({
      where: { assetId: id, returnedAt: null },
    });
    if (!active) return NextResponse.json({ error: "No active assignment found" }, { status: 422 });

    await db.$transaction([
      db.assetAssignment.update({ where: { id: active.id }, data: { returnedAt: new Date() } }),
      // A returned device is a spare and nobody is holding it. Status is only
      // moved off a "needs attention" value if it was IN_USE — returning a
      // laptop does not repair it, and quietly turning REPAIR into SPARE would
      // lose the reason it came back.
      db.iTAsset.update({
        where: { id },
        data: {
          ...(asset.status === "IN_USE" || asset.status === "TEMPORARY" ? { status: "SPARE" } : {}),
          custodianName: null,
          custodianPosition: null,
        },
      }),
    ]);
  } else {
    // update
    //
    // Only what was actually sent is written. Spreading the parsed object
    // wholesale would blank every optional field the caller left out, which is
    // how a form that edits one column erases nine. `action` is dropped by name
    // rather than destructured away, so nothing has to be named just to be
    // discarded.
    const data = Object.fromEntries(
      Object.entries(d).filter(([k, v]) => k !== "action" && v !== undefined)
    );
    if (!Object.keys(data).length) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 422 });
    }

    for (const field of ["serialNumber", "assetTag"] as const) {
      const value = data[field];
      if (!value) continue;
      const clash = await db.iTAsset.findFirst({
        where: { [field]: value as string, NOT: { id } },
        select: { name: true, custodianName: true },
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

    // Precision must not be left claiming more than the date knows. Clearing
    // the date clears it; setting a date without saying otherwise means a date
    // typed by a human, which is known to the day.
    if ("purchasedAt" in data) {
      data.purchasePrecision =
        data.purchasedAt == null ? null : (data.purchasePrecision ?? "DAY");
    }

    await db.iTAsset.update({ where: { id }, data });
  }

  const updated = await db.iTAsset.findUnique({
    where: { id },
    include: {
      region: { select: { id: true, name: true } },
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
  // Asked of the assignment table, not of `status`. The old check read
  // `status === "ASSIGNED"`, which no longer exists as a value — leaving it
  // would have silently allowed a device to be binned out from under whoever
  // was holding it.
  const held = await db.assetAssignment.findFirst({
    where: { assetId: id, returnedAt: null },
    select: { id: true },
  });
  if (held) {
    return NextResponse.json(
      { error: "This asset is out with someone. Return it before deleting." },
      { status: 422 }
    );
  }

  await trashRecord({ entityType: "ITAsset", entityId: id, userId: session.user.id });
  return NextResponse.json({ success: true });
}
