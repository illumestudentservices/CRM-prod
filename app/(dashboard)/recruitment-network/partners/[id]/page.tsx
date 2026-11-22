import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { Role } from "@/lib/permissions";
import { PartnerContactsPanel } from "./_components/partner-contacts-panel";
import { PartnerNotesPanel } from "./_components/partner-notes-panel";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";

export const dynamic = "force-dynamic";

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const partner = await db.recruitmentPartner.findFirst({
    where: { id, deletedAt: null },
    include: {
      partnerContacts: { where: { isActive: true }, orderBy: [{ isPrimary: "desc" }, { fullName: "asc" }] },
      partnerNotes: { orderBy: { createdAt: "desc" } },
      agentProfile: true,
      _count: { select: { leads: { where: { deletedAt: null } }, campaigns: true, activities: true } },
    },
  });
  if (!partner) notFound();

  // Notes carry author names; fetch them in one query and map (mirrors the API).
  const noteAuthorIds = [...new Set(partner.partnerNotes.map((n) => n.authorId))];
  const noteAuthors = noteAuthorIds.length
    ? await db.user.findMany({ where: { id: { in: noteAuthorIds } }, select: { id: true, name: true, image: true } })
    : [];
  const authorMap = Object.fromEntries(noteAuthors.map((a) => [a.id, a]));
  const canWriteNotes = session?.user
    ? await effectiveHasPermission(session.user.role as Role, "recruitment_network", "write")
    : false;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{partner.name}</h2>
        <p className="text-sm text-muted-foreground">
          {partner.type} · {partner.country}{partner.city ? ` · ${partner.city}` : ""}
        </p>
      </div>

      {/* Each count drills into the records it summarises, filtered to this
          partner. Without the links these were dead numbers — you could see a
          partner had 42 leads but had no way to reach them from here. */}
      <div className="grid grid-cols-3 gap-4">
        <Metric label="Leads" value={partner._count.leads} href={`/students?source=${partner.id}`} />
        <Metric label="Campaigns" value={partner._count.campaigns} href={`/recruitment-planning/campaigns?source=${partner.id}`} />
        <Metric label="Field Ops" value={partner._count.activities} href={`/field-operations?source=${partner.id}`} />
      </div>

      {partner.agentProfile && (
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="font-medium mb-2">Agent Profile</h3>
          <div className="grid grid-cols-4 gap-2 text-sm">
            <div>Tier: <strong>{partner.agentProfile.tier}</strong></div>
            <div>Enrolments: <strong>{partner.agentProfile.enrolments}</strong></div>
            <div>Deposits: <strong>{partner.agentProfile.deposits}</strong></div>
            <div>Yield rate: <strong>{partner.agentProfile.yieldRate?.toFixed(1) ?? "—"}%</strong></div>
          </div>
        </div>
      )}

      <PartnerContactsPanel
        partnerId={partner.id}
        initialContacts={partner.partnerContacts.map((c) => ({
          id: c.id,
          fullName: c.fullName,
          position: c.position,
          role: c.role,
          email: c.email,
          phone: c.phone,
          isPrimary: c.isPrimary,
        }))}
      />

      {session?.user && (
        <PartnerNotesPanel
          partnerId={partner.id}
          canWrite={canWriteNotes}
          currentUser={{ id: session.user.id, name: session.user.name ?? null, image: session.user.image ?? null }}
          initialNotes={partner.partnerNotes.map((n) => ({
            id: n.id,
            content: n.content,
            authorId: n.authorId,
            createdAt: n.createdAt,
            author: authorMap[n.authorId] ?? null,
          }))}
        />
      )}

      {/* Contracts, agreements, KYC — anything you'd staple to a partner file. */}
      <AttachmentsPanel parentType="RECRUITMENT_PARTNER" parentId={partner.id} />
    </div>
  );
}

function Metric({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </>
  );
  if (!href) {
    return <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">{inner}</div>;
  }
  return (
    <Link
      href={href}
      className="group block rounded-lg border border-slate-200 p-4 transition-colors hover:border-blue-400 hover:bg-muted/50 dark:border-slate-800 dark:hover:border-blue-500/50"
    >
      <div className="text-xs text-muted-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400">
        {label} <span aria-hidden>→</span>
      </div>
      <div className="text-2xl font-semibold">{value}</div>
    </Link>
  );
}
