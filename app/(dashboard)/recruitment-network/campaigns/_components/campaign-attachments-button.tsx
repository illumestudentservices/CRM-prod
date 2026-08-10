"use client";

import * as React from "react";
import { Paperclip } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";

/**
 * Row action for the campaigns table. Server-rendered rows can drop this in
 * without needing to become client components themselves. Opens a dialog with
 * the shared AttachmentsPanel scoped to this campaign.
 */
export function CampaignAttachmentsButton({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded"
        title="Attachments"
        aria-label={`Attachments for ${campaignName}`}
      >
        <Paperclip className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Attachments — {campaignName}</DialogTitle>
          </DialogHeader>
          <AttachmentsPanel parentType="MARKETING_CAMPAIGN" parentId={campaignId} />
        </DialogContent>
      </Dialog>
    </>
  );
}
