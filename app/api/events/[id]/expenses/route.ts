import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── GET /api/events/:id/expenses ─────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "events", "read"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const event = await db.event.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!event || event.deletedAt) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const expenses = await db.eventExpense.findMany({
      where: { eventId: id },
      orderBy: { createdAt: "asc" },
    });

    const total = expenses.reduce((sum, e) => sum + e.amount, 0);

    return NextResponse.json({ expenses, total });
  } catch (error) {
    console.error("[GET /api/events/:id/expenses]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/events/:id/expenses ────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "events", "write"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const event = await db.event.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!event || event.deletedAt) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const body = await req.json();
    const { description, amount, category } = body;

    if (!description || amount === undefined || amount === null) {
      return NextResponse.json(
        { error: "Description and amount are required" },
        { status: 400 }
      );
    }

    if (typeof amount !== "number" || amount <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    }

    // Create expense
    const expense = await db.eventExpense.create({
      data: {
        eventId: id,
        description,
        amount,
        category: category || null,
      },
    });

    // Recalculate and update event totalCost
    const allExpenses = await db.eventExpense.findMany({
      where: { eventId: id },
      select: { amount: true },
    });
    const totalCost = allExpenses.reduce((sum, e) => sum + e.amount, 0);

    await db.event.update({
      where: { id },
      data: { totalCost },
    });

    return NextResponse.json({ expense, totalCost }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/events/:id/expenses]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
