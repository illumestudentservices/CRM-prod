import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── GET /api/institutions/:id/contacts ────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "read")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const institution = await db.institution.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!institution || institution.deletedAt) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

    const contacts = await db.institutionContact.findMany({
      where: { institutionId: id },
      orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    });

    return NextResponse.json(contacts);
  } catch (error) {
    console.error("[GET /api/institutions/:id/contacts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/institutions/:id/contacts ───────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "write")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const institution = await db.institution.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!institution || institution.deletedAt) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

    const body = await req.json();
    const { name, title, email, phone, isPrimary } = body;

    if (!name) {
      return NextResponse.json({ error: "Contact name is required" }, { status: 400 });
    }

    // If setting as primary, unset other primary contacts
    if (isPrimary) {
      await db.institutionContact.updateMany({
        where: { institutionId: id, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const contact = await db.institutionContact.create({
      data: {
        institutionId: id,
        name,
        title: title || null,
        email: email || null,
        phone: phone || null,
        isPrimary: isPrimary ?? false,
      },
    });

    return NextResponse.json(contact, { status: 201 });
  } catch (error) {
    console.error("[POST /api/institutions/:id/contacts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
