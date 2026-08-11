import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { canAccessLead, institutionIdsForUser } from "@/lib/lead-access";
import { resolveChecklist } from "@/lib/lead-checklists";

const CATEGORIES = ["DOCUMENT", "VISA", "PRE_DEPARTURE", "ACCOMMODATION"] as const;

const patchSchema = z.object({
  itemId: z.string().min(1),
  completed: z.boolean(),
  /** Links the file that satisfied a document requirement. */
  documentId: z.string().min(1).optional().nullable(),
});

const postSchema = z.object({
  /** Add a one-off item beyond the template. */
  category: z.enum(CATEGORIES),
  label: z.string().min(1).max(200),
  isRequired: z.boolean().optional(),
});

const generateSchema = z.object({ generate: z.enum(CATEGORIES) });

async function authorise(id: string) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { role, id: userId, regionId } = session.user;
  if (!(await effectiveHasPermission(role as Role, "leads", "write"))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const lead = await db.lead.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      regionId: true,
      assignedICRId: true,
      institutionId: true,
      intendedDestination: true,
      preferredCountry: true,
      studyLevel: true,
    },
  });
  if (!lead) return { error: NextResponse.json({ error: "Lead not found" }, { status: 404 }) };
  if (!canAccessLead(lead, userId, regionId, role as Role, await institutionIdsForUser(userId, role as Role))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { lead, userId };
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorise(id);
  if ("error" in ctx) return ctx.error;

  const items = await db.leadChecklistItem.findMany({
    where: { leadId: id },
    orderBy: [{ category: "asc" }, { order: "asc" }],
    include: { document: { select: { id: true, name: true, url: true } } },
  });
  return NextResponse.json({ items });
}

// ─── POST: add an item, or generate a category on demand ─────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorise(id);
  if ("error" in ctx) return ctx.error;
  const { lead } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const gen = generateSchema.safeParse(body);
  if (gen.success) {
    const rows = resolveChecklist(gen.data.generate, {
      destination: lead.intendedDestination ?? lead.preferredCountry,
      studyLevel: lead.studyLevel,
    }).map((item) => ({
      leadId: id,
      category: gen.data.generate,
      label: item.label,
      isRequired: item.isRequired,
      order: item.order,
    }));
    // The unique constraint makes this safe to call twice.
    const res = await db.leadChecklistItem.createMany({ data: rows, skipDuplicates: true });
    return NextResponse.json({ created: res.count }, { status: 201 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const max = await db.leadChecklistItem.aggregate({
    where: { leadId: id, category: parsed.data.category },
    _max: { order: true },
  });

  try {
    const item = await db.leadChecklistItem.create({
      data: {
        leadId: id,
        category: parsed.data.category,
        label: parsed.data.label,
        isRequired: parsed.data.isRequired ?? true,
        order: (max._max.order ?? -1) + 1,
      },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "That item already exists on this checklist." },
      { status: 409 }
    );
  }
}

// ─── PATCH: tick or untick ───────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorise(id);
  if ("error" in ctx) return ctx.error;
  const { userId } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { itemId, completed, documentId } = parsed.data;

  const existing = await db.leadChecklistItem.findFirst({
    where: { id: itemId, leadId: id },
  });
  if (!existing) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const item = await db.leadChecklistItem.update({
    where: { id: itemId },
    data: {
      completedAt: completed ? new Date() : null,
      completedById: completed ? userId : null,
      documentId: completed ? (documentId ?? existing.documentId) : null,
    },
    include: { document: { select: { id: true, name: true, url: true } } },
  });

  return NextResponse.json({ item });
}

// ─── DELETE: remove a one-off item ───────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorise(id);
  if ("error" in ctx) return ctx.error;

  const itemId = req.nextUrl.searchParams.get("itemId");
  if (!itemId) return NextResponse.json({ error: "itemId is required" }, { status: 400 });

  const existing = await db.leadChecklistItem.findFirst({ where: { id: itemId, leadId: id } });
  if (!existing) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  await db.leadChecklistItem.delete({ where: { id: itemId } });
  return NextResponse.json({ deleted: true });
}
