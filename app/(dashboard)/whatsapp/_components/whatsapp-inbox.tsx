"use client";

import * as React from "react";
import { formatDistanceToNow } from "date-fns";
import { MessageCircle, Send, Phone, User, Search, Plus } from "lucide-react";
import { ExportButton } from "@/components/shared/export-button";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { displayNameOr } from "@/lib/person-name";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}

interface Conversation {
  id: string;
  phone: string;
  displayName: string | null;
  lastMessage: string | null;
  lastMessageAt: string | Date | null;
  unreadCount: number;
  lead: Lead | null;
}

interface Message {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  status: string;
  createdAt: string | Date;
  sentBy: { id: string; name: string | null } | null;
}

interface WhatsAppInboxProps {
  initialConversations: Conversation[];
  currentUserId: string;
}

// ─── New Conversation Dialog ────────────────────────────────────────────────

function NewConversationDialog({ onSent }: { onSent: (conv: Conversation) => void }) {
  const [open, setOpen] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [name, setName] = React.useState("");
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState("");

  async function handleSend() {
    if (!phone || !body) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, body, displayName: name || undefined }),
      });
      if (!res.ok) throw new Error("Failed to send");
      const data = await res.json();
      onSent(data.conversation);
      setOpen(false);
      setPhone("");
      setName("");
      setBody("");
    } catch {
      setError("Failed to send. Check the number and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New WhatsApp Message</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Phone Number (E.164)</Label>
            <Input
              placeholder="+601112345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Display Name (optional)</Label>
            <Input
              placeholder="Contact name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea
              placeholder="Type your message…"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending || !phone || !body}>
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Chat Panel ─────────────────────────────────────────────────────────────

function ChatPanel({
  conversation,
  onMessageSent,
}: {
  conversation: Conversation;
  onMessageSent: (msg: Message) => void;
}) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setLoading(true);
    fetch(`/api/whatsapp/conversations/${conversation.id}/messages`)
      .then((r) => r.json())
      .then((d) => setMessages(d.messages ?? []))
      .finally(() => setLoading(false));
  }, [conversation.id]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: conversation.phone, body }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMessages((prev) => [...prev, data.message]);
      onMessageSent(data.message);
      setBody("");
    } finally {
      setSending(false);
    }
  }

  const displayName =
    conversation.displayName ?? displayNameOr(conversation.lead, conversation.phone);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-card">
        <Avatar className="h-9 w-9">
          <AvatarFallback className="bg-green-100 text-green-700 text-sm font-semibold">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{displayName}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Phone className="h-3 w-3" />
            {conversation.phone}
          </p>
        </div>
        {conversation.lead && (
          <a
            href={`/students/${conversation.lead.id}`}
            className="text-xs text-primary underline-offset-2 hover:underline flex items-center gap-1"
          >
            <User className="h-3 w-3" />
            View Lead
          </a>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading ? (
          <p className="text-center text-sm text-muted-foreground py-8">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">No messages yet.</p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex",
                msg.direction === "OUTBOUND" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[72%] rounded-2xl px-4 py-2.5 text-sm shadow-sm",
                  msg.direction === "OUTBOUND"
                    ? "bg-green-500 text-white rounded-br-sm"
                    : "bg-card border rounded-bl-sm"
                )}
              >
                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                <p
                  className={cn(
                    "text-[10px] mt-1 text-right",
                    msg.direction === "OUTBOUND" ? "text-green-100" : "text-muted-foreground"
                  )}
                >
                  {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                  {msg.direction === "OUTBOUND" && msg.sentBy?.name
                    ? ` · ${msg.sentBy.name}`
                    : ""}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-2 border-t bg-card">
        <div className="flex gap-2">
          <Textarea
            rows={2}
            placeholder="Type a message…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            className="resize-none"
          />
          <Button
            size="icon"
            className="self-end bg-green-500 hover:bg-green-600 shrink-0"
            onClick={handleSend}
            disabled={sending || !body.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}

// ─── Main Inbox ─────────────────────────────────────────────────────────────

export function WhatsAppInbox({ initialConversations, currentUserId }: WhatsAppInboxProps) {
  const [conversations, setConversations] = React.useState<Conversation[]>(initialConversations);
  const [selected, setSelected] = React.useState<Conversation | null>(
    initialConversations[0] ?? null
  );
  const [search, setSearch] = React.useState("");

  const filtered = conversations.filter((c) => {
    const name = (c.displayName ?? displayNameOr(c.lead, c.phone)).toLowerCase();
    return name.includes(search.toLowerCase()) || c.phone.includes(search);
  });

  function handleNewConversation(conv: Conversation) {
    setConversations((prev) => {
      const exists = prev.find((c) => c.id === conv.id);
      if (exists) return prev;
      return [conv, ...prev];
    });
    setSelected(conv);
  }

  function handleMessageSent(_msg: Message) {
    // Refresh conversation list ordering
    setConversations((prev) =>
      [...prev].sort(
        (a, b) =>
          new Date(b.lastMessageAt ?? 0).getTime() -
          new Date(a.lastMessageAt ?? 0).getTime()
      )
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 shrink-0 border-r flex flex-col bg-card">
        {/* Header */}
        <div className="px-4 py-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-green-500" />
              <h1 className="font-semibold text-base">WhatsApp</h1>
            </div>
            <div className="flex items-center gap-1.5">
              <ExportButton
                data={conversations.map((c) => ({
                  contact: c.displayName ?? displayNameOr(c.lead, c.phone),
                  lastMessage: c.lastMessage ?? "—",
                  timestamp: c.lastMessageAt
                    ? new Date(c.lastMessageAt).toLocaleString()
                    : "—",
                  status: c.unreadCount > 0 ? `${c.unreadCount} unread` : "Read",
                }))}
                columns={[
                  { key: "contact", header: "Contact" },
                  { key: "lastMessage", header: "Last Message" },
                  { key: "timestamp", header: "Timestamp" },
                  { key: "status", header: "Status" },
                ]}
                filename="whatsapp-conversations"
                title="Export Conversations"
              />
              <NewConversationDialog onSent={handleNewConversation} />
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 text-sm"
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-10">No conversations yet.</p>
          ) : (
            filtered.map((conv) => {
              const name = conv.displayName ?? displayNameOr(conv.lead, conv.phone);
              const isSelected = selected?.id === conv.id;
              return (
                <button
                  key={conv.id}
                  onClick={() => setSelected(conv)}
                  className={cn(
                    "w-full text-left px-4 py-3 flex gap-3 items-start hover:bg-muted/50 transition-colors border-b",
                    isSelected && "bg-muted"
                  )}
                >
                  <Avatar className="h-9 w-9 shrink-0 mt-0.5">
                    <AvatarFallback className="bg-green-100 text-green-700 text-sm font-semibold">
                      {name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm truncate">{name}</p>
                      {conv.lastMessageAt && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: false })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-xs text-muted-foreground truncate">
                        {conv.lastMessage ?? "No messages yet"}
                      </p>
                      {conv.unreadCount > 0 && (
                        <Badge className="h-4 min-w-4 px-1 text-[10px] bg-green-500 shrink-0">
                          {conv.unreadCount}
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col bg-muted/20">
        {selected ? (
          <ChatPanel
            key={selected.id}
            conversation={selected}
            onMessageSent={handleMessageSent}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <MessageCircle className="h-12 w-12 text-green-300" />
            <p className="text-sm">Select a conversation or start a new one</p>
          </div>
        )}
      </div>
    </div>
  );
}
