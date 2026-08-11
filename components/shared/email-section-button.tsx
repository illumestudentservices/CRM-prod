"use client";

import { useState } from "react";
import { Mail, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface EmailSectionButtonProps {
  sectionTitle: string;
  sectionHtml: string;
  defaultSubject?: string;
  className?: string;
}

export function EmailSectionButton({
  sectionTitle,
  sectionHtml,
  defaultSubject,
  className,
}: EmailSectionButtonProps) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const { toast } = useToast();

  function handleOpen() {
    setSubject(defaultSubject ?? sectionTitle);
    setOpen(true);
  }

  function resetForm() {
    setTo("");
    setSubject("");
    setMessage("");
  }

  async function handleSend() {
    if (!to.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/email/send-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim() || sectionTitle,
          sectionTitle,
          sectionHtml,
          message: message.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to send email");
      }
      toast({ title: "Email sent", description: `Sent to ${to}`, variant: "default" });
      setOpen(false);
      resetForm();
    } catch (err) {
      toast({
        title: "Failed to send",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 text-slate-400 hover:text-[#1E3A5F] ${className ?? ""}`}
        onClick={handleOpen}
        title="Email this section"
      >
        <Mail className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-[#1E3A5F]" />
              Email Section
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Recipient Email</Label>
              <Input
                type="email"
                placeholder="name@company.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Message <span className="text-slate-400 font-normal">(optional)</span></Label>
              <Textarea
                placeholder="Add a personal note..."
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
              <p className="text-xs text-slate-500">
                Sending: <span className="font-semibold text-slate-700 dark:text-slate-300">{sectionTitle}</span>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={!to.trim() || sending}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
            >
              {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
