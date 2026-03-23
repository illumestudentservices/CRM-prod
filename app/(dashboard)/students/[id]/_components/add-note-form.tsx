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
  author?: {
    name: string | null;
    image: string | null;
  };
}

interface AddNoteFormProps {
  leadId: string;
  initialNotes: Note[];
  currentUser: {
    id: string;
    name: string | null;
    image: string | null;
  };
}

export function AddNoteForm({ leadId, initialNotes, currentUser }: AddNoteFormProps) {
  const { toast } = useToast();
  const [content, setContent] = React.useState("");
  const [notes, setNotes] = React.useState<Note[]>(initialNotes);
  const [submitting, setSubmitting] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;

    setSubmitting(true);

    // Optimistic update
    const optimisticNote: Note = {
      id: `optimistic-${Date.now()}`,
      content: trimmed,
      authorId: currentUser.id,
      createdAt: new Date(),
      author: { name: currentUser.name, image: currentUser.image },
    };
    setNotes((prev) => [optimisticNote, ...prev]);
    setContent("");

    try {
      const res = await fetch(`/api/leads/${leadId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to add note");
      }

      const savedNote: Note & { author?: { name: string | null; image: string | null } } =
        await res.json();

      // Replace optimistic note with saved note
      setNotes((prev) =>
        prev.map((n) =>
          n.id === optimisticNote.id
            ? {
                ...savedNote,
                author: savedNote.author ?? {
                  name: currentUser.name,
                  image: currentUser.image,
                },
              }
            : n
        )
      );
    } catch (err) {
      // Remove optimistic note on error
      setNotes((prev) => prev.filter((n) => n.id !== optimisticNote.id));
      setContent(trimmed); // Restore content
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
    <div className="space-y-4">
      {/* Input form */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a note... (Ctrl+Enter to submit)"
          rows={3}
          className="resize-none"
          disabled={submitting}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={!content.trim() || submitting}
            className="gap-2"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {submitting ? "Adding..." : "Add Note"}
          </Button>
        </div>
      </form>

      {/* Notes list */}
      {notes.length > 0 ? (
        <div className="space-y-3">
          {notes.map((note) => (
            <div
              key={note.id}
              className={cn(
                "rounded-lg border p-3 space-y-2 transition-opacity",
                note.id.startsWith("optimistic-") ? "opacity-60 border-dashed" : "border-slate-200"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    {note.author?.image && (
                      <AvatarImage src={note.author.image} alt={note.author.name ?? ""} />
                    )}
                    <AvatarFallback className="text-[9px]">
                      {getInitials(note.author?.name ?? note.authorId)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-medium text-slate-700">
                    {note.author?.name ?? "Unknown"}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 shrink-0">
                  {formatRelative(note.createdAt)}
                </span>
              </div>
              <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                {note.content}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <StickyNote className="h-8 w-8 text-slate-300 mb-2" />
          <p className="text-sm text-slate-400">No notes yet</p>
        </div>
      )}
    </div>
  );
}
