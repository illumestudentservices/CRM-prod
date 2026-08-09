import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { AutoPopulateClient } from "./_components/auto-populate-client";

export const dynamic = "force-dynamic";

export default async function AutoPopulateReportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [institutions, icrs] = await Promise.all([
    db.institution.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { role: "ICR", isActive: true, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Auto-populated Monthly Report</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Numbers are auto-generated from CRM data. Add narrative before submitting.
      </p>
      <AutoPopulateClient
        icrs={icrs.map(u => ({ id: u.id, name: u.name }))}
        institutions={institutions}
        selfId={session.user.id}
      />
    </div>
  );
}
