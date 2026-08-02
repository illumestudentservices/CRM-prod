import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { OfflineCaptureClient } from "./_components/offline-capture-client";
import { RegisterOfflineWorker } from "./_components/register-offline-worker";

/**
 * Lead capture for events with no connection.
 *
 * Everything below the header is client-side and reads from IndexedDB, so the
 * screen keeps working once loaded even when the network is gone. The session
 * is checked here only to establish who is capturing — the queue itself must
 * not depend on a live session, because an event can outlast the 48-hour
 * session ceiling and an ICR mid-booth cannot re-authenticate without signal.
 */
export default async function OfflineCapturePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="space-y-6">
      <RegisterOfflineWorker />
      <PageHeader
        title="Offline Capture"
        description="Collect leads at an event with no internet, then upload them all at once."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Students", href: "/students" },
          { label: "Offline Capture" },
        ]}
      />
      <OfflineCaptureClient
        userId={session.user.id}
        userName={session.user.name ?? session.user.email ?? "Unknown"}
      />
    </div>
  );
}
