import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { assertInstitutionVisible } from "@/lib/lead-access";
import { readJsonBody, handleApiError } from "@/lib/api-validation";
import { logActivity } from "@/lib/activity-logger";

// Shared gate: authenticated, can write institutions, institution visible, and
// the contact actually belongs to that institution (so one client's id can't
// edit another's contact).
async function guard(
  params: Promise<{ id: string; contactId: string }>,
) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await effectiveHasPermission(session.user.role, "institutions", "write")))
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  const { id, contactId } = await params;
  if (!(await assertInstitutionVisible(id, session.user.id, session.user.role)))
    return { error: NextResponse.json({ error: "Institution not found" }, { status: 404 }) };

  const contact = await db.institutionContact.findUnique({ where: { id: contactId }, select: { id: true, institutionId: true } });
  if (!contact || contact.institutionId !== id)
    return { error: NextResponse.json({ error: "Contact not found" }, { status: 404 }) };

  return { session, id, contactId };
}

// ─── PATCH /api/institutions/:id/contacts/:contactId ────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  try {
    const g = await guard(params);
    if (g.error) return g.error;
    const { session, id, contactId } = g;

    const body = await readJsonBody(req);
    const { name, title, email, phone, isPrimary } = body;

    if (name !== undefined && !name) {
      return NextResponse.json({ error: "Contact name cannot be empty" }, { status: 400 });
    }

    // Only one primary per client: promoting this one demotes the rest.
    if (isPrimary) {
      await db.institutionContact.updateMany({
        where: { institutionId: id, isPrimary: true, id: { not: contactId } },
        data: { isPrimary: false },
      });
    }

    const contact = await db.institutionContact.update({
      where: { id: contactId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(title !== undefined ? { title: title || null } : {}),
        ...(email !== undefined ? { email: email || null } : {}),
        ...(phone !== undefined ? { phone: phone || null } : {}),
        ...(isPrimary !== undefined ? { isPrimary: !!isPrimary } : {}),
      },
    });
    void logActivity(session.user.id, "UPDATE", "InstitutionContact", contactId, { route: "institutions/[id]/contacts/[contactId]" });

    return NextResponse.json(contact);
  } catch (error) {
    return handleApiError(error, "[PATCH /api/institutions/:id/contacts/:contactId]");
  }
}

// ─── DELETE /api/institutions/:id/contacts/:contactId ───────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  try {
    const g = await guard(params);
    if (g.error) return g.error;
    const { session, contactId } = g;

    await db.institutionContact.delete({ where: { id: contactId } });
    void logActivity(session.user.id, "DELETE", "InstitutionContact", contactId, { route: "institutions/[id]/contacts/[contactId]" });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return handleApiError(error, "[DELETE /api/institutions/:id/contacts/:contactId]");
  }
}
