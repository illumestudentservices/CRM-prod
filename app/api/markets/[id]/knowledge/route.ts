import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── GET /api/markets/:id/knowledge ───────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "markets", "read"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const market = await db.market.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!market || market.deletedAt) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const articles = await db.knowledgeBase.findMany({
      where: {
        marketId: id,
        knowledgeType: "MARKET",
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
    console.error("[GET /api/markets/:id/knowledge]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/markets/:id/knowledge ──────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "markets", "write"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const market = await db.market.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!market || market.deletedAt) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
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
        knowledgeType: "MARKET",
        tags: tags ?? [],
        authorId: session.user.id,
        isPublished: true,
        marketId: id,
      },
    });

    return NextResponse.json({ article }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/markets/:id/knowledge]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
