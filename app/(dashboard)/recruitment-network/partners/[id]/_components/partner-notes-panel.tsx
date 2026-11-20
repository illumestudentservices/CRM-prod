"use client";

import * as React from "react";
import { Send, Loader2, StickyNote } from "lucide-react";
import { cn, formatRelative, getInitials } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";

interface Note {
  id: string;
  content: string;
  authorId: string;
  createdAt: Date | string;
  author?: { name: string | null; image: string | null } | null;
}

interface PartnerNotesPanelProps {
  partnerId: string;
  initialNotes: Note[];
  currentUser: { id: string; name: string | null; image: string | null };
  canWrite: boolean;
}

/** Notes thread for a recruitment partner — add + list, newest first, with an
 *  optimistic insert that rolls back on error. Mirrors the lead AddNoteForm. */
export function PartnerNotesPanel({ partnerId, initialNotes, currentUser, canWrite }: PartnerNotesPanelProps) {
  const { toast } = useToast();
  const [content, setContent] = React.useState("");
  const [notes, setNotes] = React.useState<Note[]>(initialNotes);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;
    setSubmitting(true);

    const optimistic: Note = {
      id: `optimistic-${Date.now()}`,
      content: trimmed,
      authorId: currentUser.id,
      createdAt: new Date(),
      author: { name: currentUser.name, image: currentUser.image },
    };
    setNotes((prev) => [optimistic, ...prev]);
    setContent("");

    try {
      const res = await fetch(`/api/recruitment-network/partners/${partnerId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to add note");
      }
      const saved: Note = await res.json();
      setNotes((prev) =>
        prev.map((n) =>
          n.id === optimistic.id
            ? { ...saved, author: saved.author ?? { name: currentUser.name, image: currentUser.image } }
            : n
        )
      );
    } catch (err) {
      setNotes((prev) => prev.filter((n) => n.id !== optimistic.id));
      setContent(trimmed);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to add note.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="border rounded p-4 space-y-4">
      <h3 className="font-medium">Notes</h3>

      {canWrite && (
        <form onSubmit={handleSubmit} className="space-y-2">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a note... (Ctrl+Enter to submit)"
            rows={3}
            className="resize-none"
            disabled={submitting}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!content.trim() || submitting} className="gap-2">
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {submitting ? "Adding..." : "Add Note"}
            </Button>
          </div>
        </form>
      )}

      {notes.length > 0 ? (
        <div className="space-y-3">
          {notes.map((note) => (
            <div
              key={note.id}
              className={cn(
                "rounded-lg border p-3 space-y-2 transition-opacity",
                note.id.startsWith("optimistic-")
                  ? "opacity-60 border-dashed border-slate-300 dark:border-slate-700"
                  : "border-slate-200 dark:border-slate-800"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    {note.author?.image && <AvatarImage src={note.author.image} alt={note.author.name ?? ""} />}
                    <AvatarFallback className="text-[9px]">
                      {getInitials(note.author?.name ?? note.authorId)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {note.author?.name ?? "Unknown"}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0" suppressHydrationWarning>
                  {formatRelative(note.createdAt)}
                </span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                {note.content}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <StickyNote className="h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm text-slate-400 dark:text-slate-500">No notes yet</p>
        </div>
      )}
    </div>
  );
}
