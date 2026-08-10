"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatRelative } from "@/lib/utils";
import { Megaphone, Plus, Eye } from "lucide-react";

interface Announcement {
  id: string;
  title: string;
  content: string;
  publishedAt: string;
  isRead?: boolean;
  authorId: string;
}

export function Announcements({ isHR, userId }: { isHR: boolean; userId: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", content: "" });

  async function load() {
    setLoading(true);
    const res = await fetch("/api/hr/announcements");
    const data = await res.json();
    setItems(data.announcements || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function markRead(id: string) {
    await fetch(`/api/hr/announcements/${id}/read`, { method: "POST" });
    setItems((prev) => prev.map((a) => a.id === id ? { ...a, isRead: true } : a));
  }

  async function create() {
    const res = await fetch("/api/hr/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      toast({ title: "Announcement posted" });
      setShowForm(false);
      setForm({ title: "", content: "" });
      load();
    }
  }

  return (
    <div className="space-y-4">
      {isHR && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> Post Announcement
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))
          : items.length === 0
            ? (
              <div className="text-center py-12 text-muted-foreground">
                <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No announcements yet</p>
              </div>
            )
            : items.map((ann) => (
              <Card key={ann.id} className={!ann.isRead ? "border-[#0EA5E9] bg-blue-50/30 dark:bg-sky-500/10" : ""}>
                <CardHeader className="py-3 px-4 flex flex-row items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    {!ann.isRead && <div className="w-2 h-2 rounded-full bg-[#0EA5E9] mt-1.5 shrink-0" />}
                    <div>
                      <p className="font-semibold text-sm">{ann.title}</p>
                      <p className="text-xs text-muted-foreground">{formatRelative(ann.publishedAt)}</p>
                    </div>
                  </div>
                  {!ann.isRead && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => markRead(ann.id)}>
                      <Eye className="h-3 w-3 mr-1" /> Mark Read
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-sm text-muted-foreground">{ann.content}</p>
                </CardContent>
              </Card>
            ))}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Post Announcement</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Content *</Label>
              <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={5} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={create} disabled={!form.title || !form.content}>Post</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
