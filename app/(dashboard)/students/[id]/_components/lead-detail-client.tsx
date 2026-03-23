"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadForm } from "../../_components/lead-form";
import type { Lead, Source, Institution, User } from "@prisma/client";

interface LeadDetailClientProps {
  lead: Lead;
  sources: Pick<Source, "id" | "name">[];
  institutions: Pick<Institution, "id" | "name">[];
  icrUsers: Pick<User, "id" | "name" | "image">[];
}

export function LeadDetailClient({
  lead,
  sources,
  institutions,
  icrUsers,
}: LeadDetailClientProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setEditOpen(true)}
        className="gap-2 shrink-0"
      >
        <Edit className="h-3.5 w-3.5" />
        Edit Lead
      </Button>

      <LeadForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        lead={lead}
        sources={sources}
        institutions={institutions}
        icrUsers={icrUsers}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
