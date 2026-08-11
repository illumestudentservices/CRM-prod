import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncLeadFromInterests } from "@/lib/interest-sync";
import { hasCapability } from "@/lib/granular-permissions";
import type { Role } from "@/lib/permissions";

/// Spec — Merge Student Profiles. SUPER_ADMIN only.
///
/// Steps (all inside a single transaction):
///   1. Move institution_interests, applications, activities, checklist items,
///      notes, documents, whatsapp conversations from `mergeFromId` to `keepId`.
///   2. Soft-delete the merged-from lead with a marker.
///   3. Snapshot both original records to audit_logs for irreversible traceability.
///   4. Sync Lead.stage/institutionId from the surviving interests.
///
/// Conflict handling for InstitutionInterest: if both leads have an interest
/// in the same institution, keep the survivor's and close the merged-from
/// one (closedAt = now, lostNotes = merged).
const schema = z.object({
  keepId: z.string().min(1),
  mergeFromId: z.string().min(1),
  reason: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    // Capability-gated (Phase 10) rather than a hardcoded role test, so the
    // grant can be moved in Settings → Security without a deploy. Defaults to
    // SUPER_ADMIN only, and still requires leads:delete underneath — so
    // granting it to a role without delete has no effect.
    if (!(await hasCapability(role as Role, "leads.merge"))) {
      return NextResponse.json(
        { error: "Your role is not permitted to merge student profiles" },
        { status: 403 }
      );
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }
    const { keepId, mergeFromId, reason } = parsed.data;

    if (keepId === mergeFromId) {
      return NextResponse.json({ error: "keepId and mergeFromId must differ" }, { status: 422 });
    }

    const [keep, mergeFrom] = await Promise.all([
      db.lead.findUnique({ where: { id: keepId } }),
      db.lead.findUnique({ where: { id: mergeFromId } }),
    ]);
    if (!keep || keep.deletedAt) return NextResponse.json({ error: "Survivor student not found" }, { status: 404 });
    if (!mergeFrom || mergeFrom.deletedAt) return NextResponse.json({ error: "Merged-from student not found or already deleted" }, { status: 404 });

    // Snapshot both originals BEFORE anything is moved.
    await db.auditLog.create({
      data: {
        userId,
        action: "LEAD_MERGE_SNAPSHOT",
        entity: "Lead",
        entityId: keepId,
        changes: {
          reason,
          keep: { ...keep },
          mergeFrom: { ...mergeFrom },
        },
      },
    });

    await db.$transaction(async (tx) => {
      // 1. Institution Interests — handle collisions
      const survivorInterests = await tx.institutionInterest.findMany({
        where: { leadId: keepId, closedAt: null },
        select: { institutionId: true },
      });
      const survivorInstitutionIds = new Set(survivorInterests.map(i => i.institutionId));

      // Close colliding open interests on the merged-from side
      const collisions = await tx.institutionInterest.findMany({
        where: {
          leadId: mergeFromId,
          closedAt: null,
          institutionId: { in: [...survivorInstitutionIds] },
        },
        select: { id: true },
      });
      for (const c of collisions) {
        await tx.institutionInterest.update({
          where: { id: c.id },
          data: {
            closedAt: new Date(),
            lostReason: "OTHER",
            lostNotes: `Duplicate of survivor interest during profile merge (${reason})`,
          },
        });
      }

      // Now safe to reparent everything
      await tx.institutionInterest.updateMany({ where: { leadId: mergeFromId }, data: { leadId: keepId } });
      await tx.leadApplication.updateMany({ where: { leadId: mergeFromId }, data: { leadId: keepId } });
      await tx.leadActivity.updateMany({ where: { leadId: mergeFromId }, data: { leadId: keepId } });
      await tx.leadChecklistItem.updateMany({ where: { leadId: mergeFromId }, data: { leadId: keepId } });
      await tx.leadNote.updateMany({ where: { leadId: mergeFromId }, data: { leadId: keepId } });
      await tx.leadDocument.updateMany({ where: { leadId: mergeFromId }, data: { leadId: keepId } });
      await tx.whatsAppConversation.updateMany({ where: { leadId: mergeFromId }, data: { leadId: keepId } });

      // 2. Soft-delete the merged-from lead
      await tx.lead.update({
        where: { id: mergeFromId },
        data: {
          deletedAt: new Date(),
          isDuplicate: true,
          duplicateOfId: keepId,
          notes: `[MERGED into ${keepId}]  ${mergeFrom.notes ?? ""}`,
        },
      });

      // 3. Audit trail for the merge itself
      await tx.auditLog.create({
        data: {
          userId,
          action: "LEAD_MERGED",
          entity: "Lead",
          entityId: keepId,
          changes: { reason, mergedFromId: mergeFromId, collisions: collisions.length },
        },
      });
    });

    await syncLeadFromInterests(keepId);

    return NextResponse.json({ ok: true, keepId, mergedFromId: mergeFromId });
  } catch (err) {
    console.error("[POST /api/leads/merge]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
