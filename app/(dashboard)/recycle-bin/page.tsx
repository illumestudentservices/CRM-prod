import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { RecycleBinClient } from "./_components/recycle-bin-client";
import { RETENTION_DAYS } from "@/lib/recycle-bin";

export const dynamic = "force-dynamic";

/**
 * Recycle bin — every DELETE anywhere in the app lands here.
 * SUPER_ADMIN only; the sidebar link is gated to the same role.
 */
export default async function RecycleBinPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "SUPER_ADMIN") redirect("/dashboard");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Recycle Bin"
        description={`Deleted records and files stay recoverable for ${RETENTION_DAYS} days.`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Settings", href: "/settings" },
          { label: "Recycle Bin" },
        ]}
      />
      <RecycleBinClient retentionDays={RETENTION_DAYS} />
    </div>
  );
}
