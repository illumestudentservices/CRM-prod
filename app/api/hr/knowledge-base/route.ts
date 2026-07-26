import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-logger";

const KB_WRITE_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN", "HQ_EXECUTIVE"];

const createArticleSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  category: z.string().min(1, "Category is required"),
  knowledgeType: z.enum(["GENERAL", "INSTITUTION", "MARKET", "PROPOSAL"]).default("GENERAL"),
  tags: z.array(z.string()).default([]),
  isPublished: z.boolean().default(true),
  institutionId: z.string().optional(),
  marketId: z.string().optional(),
});

// ─── GET /api/hr/knowledge-base ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const search        = searchParams.get("search");
    const category      = searchParams.get("category");
    const knowledgeType = searchParams.get("knowledgeType");
    const institutionId = searchParams.get("institutionId");
    const marketId      = searchParams.get("marketId");
    const articleId     = searchParams.get("id");

    // Single article view — increment views
    if (articleId) {
      const article = await db.knowledgeBase.findFirst({
        where: { id: articleId, deletedAt: null, isPublished: true },
        include: {
          attachments: {
            select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });
      await db.knowledgeBase.update({ where: { id: articleId }, data: { views: { increment: 1 } } });
      return NextResponse.json({ article });
    }

    const where: Record<string, unknown> = { deletedAt: null, isPublished: true };
    if (search)        where.OR = [{ title: { contains: search, mode: "insensitive" } }, { content: { contains: search, mode: "insensitive" } }];
    if (category)      where.category = category;
    if (knowledgeType) where.knowledgeType = knowledgeType;
    if (institutionId) where.institutionId = institutionId;
    if (marketId)      where.marketId = marketId;

    const articles = await db.knowledgeBase.findMany({
      where,
      orderBy: { views: "desc" },
      include: {
        attachments: {
          select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return NextResponse.json({ articles });
  } catch (err) {
    console.error("[knowledge-base GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/hr/knowledge-base ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!KB_WRITE_ROLES.includes(session.user.role as Role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createArticleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const data = parsed.data;

  const article = await db.knowledgeBase.create({
    data: {
      title: data.title,
      content: data.content,
      category: data.category,
      knowledgeType: data.knowledgeType,
      tags: data.tags,
      authorId: session.user.id,
      isPublished: data.isPublished,
      institutionId: data.institutionId ?? null,
      marketId: data.marketId ?? null,
    },
  });

  void logActivity(session.user.id, "CREATE", "KB_ARTICLE", article.id, { title: data.title, category: data.category }, req);

  return NextResponse.json({ article }, { status: 201 });
}
