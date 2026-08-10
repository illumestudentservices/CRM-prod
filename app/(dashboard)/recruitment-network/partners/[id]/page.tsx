import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { PartnerContactsPanel } from "./_components/partner-contacts-panel";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";

export const dynamic = "force-dynamic";

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const partner = await db.recruitmentPartner.findFirst({
    where: { id, deletedAt: null },
    include: {
      partnerContacts: { where: { isActive: true }, orderBy: [{ isPrimary: "desc" }, { fullName: "asc" }] },
      agentProfile: true,
      _count: { select: { leads: true, campaigns: true, activities: true } },
    },
  });
  if (!partner) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{partner.name}</h2>
        <p className="text-sm text-muted-foreground">
          {partner.type} · {partner.country}{partner.city ? ` · ${partner.city}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Metric label="Leads" value={partner._count.leads} />
        <Metric label="Campaigns" value={partner._count.campaigns} />
        <Metric label="Field Ops" value={partner._count.activities} />
      </div>

      {partner.agentProfile && (
        <div className="border rounded p-4">
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

      {/* Contracts, agreements, KYC — anything you'd staple to a partner file. */}
      <AttachmentsPanel parentType="RECRUITMENT_PARTNER" parentId={partner.id} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
