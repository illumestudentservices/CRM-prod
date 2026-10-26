import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { Role } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { isImportAdmin } from "@/lib/lead-import";
import { importableInstitutions } from "@/lib/lead-import-scope";
import { ImportLeadsClient } from "./_components/import-client";

export default async function ImportLeadsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role;
  // Same gate as creating a lead. Anyone without leads:write is sent back to the
  // pipeline rather than shown an importer they could not submit.
  if (!(await effectiveHasPermission(role, "leads", "write"))) redirect("/students");

  const admin = isImportAdmin(role);
  const institutions = await importableInstitutions(session.user.id, role);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import Leads"
        description="Upload a CSV of leads. Download the template first and fill it in."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Students", href: "/students" },
          { label: "Import" },
        ]}
      />
      <ImportLeadsClient admin={admin} institutions={institutions} />
    </div>
  );
}
