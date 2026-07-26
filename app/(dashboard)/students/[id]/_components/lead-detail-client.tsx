"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Edit, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LeadForm } from "../../_components/lead-form";
import type { Lead, Source, Institution, User } from "@prisma/client";

interface LeadDetailClientProps {
  lead: Lead;
  sources: Pick<Source, "id" | "name">[];
  institutions: Pick<Institution, "id" | "name">[];
  icrUsers: Pick<User, "id" | "name" | "image">[];
}

function WhatsAppButton({ lead }: { lead: Lead }) {
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [sent, setSent] = React.useState(false);

  async function handleSend() {
    if (!body.trim()) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: lead.phone,
          body,
          leadId: lead.id,
          displayName: lead.fullName,
        }),
      });
      if (!res.ok) throw new Error();
      setSent(true);
      setBody("");
      setTimeout(() => {
        setOpen(false);
        setSent(false);
      }, 1500);
    } catch {
      setError("Failed to send. Check the number format (+country code).");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 shrink-0 border-green-300 text-green-700 hover:bg-green-50">
          <MessageCircle className="h-3.5 w-3.5" />
          WhatsApp
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send WhatsApp to {lead.fullName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Sending to <span className="font-medium text-foreground">{lead.phone}</span>
          </p>
          <Textarea
            placeholder="Type your message…"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {sent && <p className="text-sm text-green-600 font-medium">Message sent!</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSend}
              disabled={sending || !body.trim()}
              className="bg-green-500 hover:bg-green-600 gap-2"
            >
              <Send className="h-3.5 w-3.5" />
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
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
      <WhatsAppButton lead={lead} />

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
