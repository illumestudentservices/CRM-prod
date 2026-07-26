import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── GET /api/institutions/:id/knowledge ──────────────────────────────────

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
    if (!institution || institution.deletedAt) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    const articles = await db.knowledgeBase.findMany({
      where: {
        institutionId: id,
        knowledgeType: "INSTITUTION",
        deletedAt: null,
        isPublished: true,
      },
      orderBy: { createdAt: "desc" },
      include: {
        attachments: {
          select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return NextResponse.json({ articles });
  } catch (error) {
    console.error("[GET /api/institutions/:id/knowledge]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/institutions/:id/knowledge ─────────────────────────────────

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
    if (!institution || institution.deletedAt) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { title, content, category, tags } = body as {
      title?: string;
      content?: string;
      category?: string;
      tags?: string[];
    };

    if (!title || !content || !category) {
      return NextResponse.json({ error: "title, content, and category are required" }, { status: 400 });
    }

    const article = await db.knowledgeBase.create({
      data: {
        title,
        content,
        category,
        knowledgeType: "INSTITUTION",
        tags: tags ?? [],
        authorId: session.user.id,
        isPublished: true,
        institutionId: id,
      },
    });

    return NextResponse.json({ article }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/institutions/:id/knowledge]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
