import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── GET /api/knowledge/proposals ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "knowledge", "read"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const search   = searchParams.get("search");

    const where: Record<string, unknown> = {
      knowledgeType: "PROPOSAL",
      deletedAt: null,
      isPublished: true,
    };

    if (category) where.category = category;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
        { tags: { hasSome: [search] } },
      ];
    }

    const articles = await db.knowledgeBase.findMany({
      where,
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
    console.error("[GET /api/knowledge/proposals]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/knowledge/proposals ────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "knowledge", "write"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
        knowledgeType: "PROPOSAL",
        tags: tags ?? [],
        authorId: session.user.id,
        isPublished: true,
      },
    });

    return NextResponse.json({ article }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/knowledge/proposals]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
