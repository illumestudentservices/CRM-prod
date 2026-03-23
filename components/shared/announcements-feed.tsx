"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Eye } from "lucide-react";
import { formatRelative } from "@/lib/utils";

interface Announcement {
  id: string;
  title: string;
  content: string;
  publishedAt: string;
  readReceipts: { readAt: string }[];
}

export function AnnouncementsFeed() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/hr/announcements")
      .then((r) => r.json())
      .then((json) => setItems(json.announcements ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function markRead(id: string) {
    await fetch(`/api/hr/announcements/${id}/read`, { method: "POST" });
    setItems((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, readReceipts: [{ readAt: new Date().toISOString() }] }
          : a
      )
    );
  }

  const unreadCount = items.filter((a) => a.readReceipts.length === 0).length;

  if (!loading && items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-[#0EA5E9]" />
          Announcements
          {unreadCount > 0 && (
            <Badge variant="default" className="text-xs h-5 px-1.5">
              {unreadCount} new
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {loading
          ? Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
            ))
          : items.slice(0, 5).map((ann) => {
              const isRead = ann.readReceipts.length > 0;
              return (
                <div
                  key={ann.id}
                  className={`rounded-lg border p-3 transition-colors ${
                    !isRead ? "border-[#0EA5E9] bg-blue-50/40" : "border-border bg-muted/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      {!isRead && (
                        <div className="w-2 h-2 rounded-full bg-[#0EA5E9] mt-1.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{ann.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatRelative(ann.publishedAt)}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {ann.content}
                        </p>
                      </div>
                    </div>
                    {!isRead && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs shrink-0"
                        onClick={() => markRead(ann.id)}
                      >
                        <Eye className="h-3 w-3 mr-1" /> Read
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
      </CardContent>
    </Card>
  );
}
