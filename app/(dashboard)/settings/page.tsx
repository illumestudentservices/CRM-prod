import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsTabsClient } from "./_components/settings-tabs-client";

export default async function SettingsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "SUPER_ADMIN") redirect("/dashboard");

  const [userCount, regionCount, institutionCount, sourceCount] = await Promise.all([
    db.user.count({ where: { deletedAt: null } }),
    db.region.count(),
    db.institution.count({ where: { deletedAt: null } }),
    db.source.count({ where: { deletedAt: null } }),
  ]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Settings"
        description="System administration and configuration"
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Users", value: userCount },
          { label: "Regions", value: regionCount },
          { label: "Institutions", value: institutionCount },
          { label: "Sources", value: sourceCount },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <SettingsTabsClient nodeEnv={process.env.NODE_ENV} />
    </div>
  );
}
