import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { leavePolicyTable } from "@/lib/leave-policy-resolver";
import { LeavePoliciesClient } from "./_components/leave-policies-client";

const EDITORS = ["SUPER_ADMIN", "HR_MANAGER"];

export default async function LeavePoliciesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!EDITORS.includes(session.user.role)) redirect("/hr");

  const table = await leavePolicyTable();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Policies"
        description="Set leave entitlements per region. Changes apply to everyone in that region immediately."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "HR", href: "/hr" },
          { label: "Leave Policies" },
        ]}
      />
      <LeavePoliciesClient initial={table} />
    </div>
  );
}
