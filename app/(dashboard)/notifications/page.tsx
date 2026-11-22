import { PageHeader } from "@/components/shared/page-header";
import { NotificationsClient } from "./_components/notifications-client";

export const dynamic = "force-dynamic";

export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Everything the system has flagged for you — read, mark, or clear."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Notifications" }]}
      />
      <NotificationsClient />
    </div>
  );
}
