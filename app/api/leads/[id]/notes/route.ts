import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const noteSchema = z.object({
  content: z.string().min(1, "Note content is required").max(5000),
});

// ─── GET /api/leads/:id/notes ─────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const lead = await db.lead.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });

    if (!lead || lead.deletedAt) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const notes = await db.leadNote.findMany({
      where: { leadId: id },
      orderBy: { createdAt: "desc" },
    });

    // Fetch authors
    const authorIds = [...new Set(notes.map((n) => n.authorId))];
    const authors =
      authorIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: authorIds } },
            select: { id: true, name: true, image: true },
          })
        : [];

    const authorMap = Object.fromEntries(authors.map((a) => [a.id, a]));

    const notesWithAuthors = notes.map((note) => ({
      ...note,
      author: authorMap[note.authorId] ?? null,
    }));

    return NextResponse.json(notesWithAuthors);
  } catch (error) {
    console.error("[GET /api/leads/:id/notes]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/leads/:id/notes ────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const lead = await db.lead.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });

    if (!lead || lead.deletedAt) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = noteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }

    const { content } = parsed.data;

    // Create note + activity in a transaction
    const [note] = await db.$transaction([
      db.leadNote.create({
        data: {
          leadId: id,
          content,
          authorId: session.user.id,
        },
      }),
      db.leadActivity.create({
        data: {
          leadId: id,
          userId: session.user.id,
          type: "NOTE_ADDED",
          description: `Note added by ${session.user.name ?? "User"}`,
          metadata: { preview: content.slice(0, 100) },
        },
      }),
    ]);

    // Return note with author
    const author = {
      id: session.user.id,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
    };

    return NextResponse.json({ ...note, author }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/leads/:id/notes]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
