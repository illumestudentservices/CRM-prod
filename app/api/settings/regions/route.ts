import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, handleApiError } from "@/lib/api-validation";
import { trashRecord } from "@/lib/recycle-bin";

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "SUPER_ADMIN") return forbidden();

  const regions = await db.region.findMany({
    include: {
      _count: { select: { users: true, leads: true, institutions: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ regions });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "SUPER_ADMIN") return forbidden();

  let body: { name?: string; code?: string; description?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, code, description } = body;
  if (!name?.trim() || !code?.trim()) {
    return NextResponse.json({ error: "Name and code are required" }, { status: 422 });
  }

  try {
    const region = await db.region.create({
      data: {
        name:        name.trim(),
        code:        code.trim().toUpperCase(),
        description: description?.trim() || null,
      },
      include: { _count: { select: { users: true, leads: true, institutions: true } } },
    });
    return NextResponse.json({ region }, { status: 201 });
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "A region with that name or code already exists" }, { status: 409 });
    }
    console.error("[regions POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "SUPER_ADMIN") return forbidden();

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    // Region is registered in the recycle bin as a hard-delete entity — the row
    // is snapshotted to deleted_records before removal so it can be restored
    // within the retention window. This route was calling db.region.delete
    // directly, which removed it with no way back.
    await trashRecord({ entityType: "Region", entityId: id, userId: session.user.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[regions DELETE]", err);
    return NextResponse.json({ error: "Cannot delete — region may have associated records" }, { status: 409 });
  }
}
