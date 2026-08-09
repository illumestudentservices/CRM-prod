import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PartnersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const partners = await db.source.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { leads: true, partnerContacts: true } },
      agentProfile: { select: { tier: true, enrolments: true } },
    },
    take: 200,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {partners.length} active recruitment partners
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Partner</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Country</th>
              <th className="text-left p-2">Contacts</th>
              <th className="text-left p-2">Leads</th>
              <th className="text-left p-2">Tier</th>
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => (
              <tr key={p.id} className="border-t hover:bg-muted/50">
                <td className="p-2">
                  <Link href={`/recruitment-network/partners/${p.id}`} className="text-blue-600 hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className="p-2">{p.type}</td>
                <td className="p-2">{p.country}</td>
                <td className="p-2">{p._count.partnerContacts}</td>
                <td className="p-2">{p._count.leads}</td>
                <td className="p-2">{p.agentProfile?.tier ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
