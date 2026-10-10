"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatRelative } from "@/lib/utils";
import { Megaphone, Plus, Eye, Pencil, Trash2, Globe, MapPin } from "lucide-react";

interface Announcement {
  id: string;
  title: string;
  content: string;
  publishedAt: string;
  expiresAt: string | null;
  isGlobal: boolean;
  regionId: string | null;
  regionName: string | null;
  authorId: string | null;
  authorName: string | null;
  isRead: boolean;
}

interface Region {
  id: string;
  name: string;
}

const EMPTY_FORM = {
  title: "",
  content: "",
  isGlobal: true,
  regionId: "",
  expiresAt: "",
  notifyByEmail: false,
};

/**
 * ★ PERMISSION COMES FROM THE SERVER, NOT FROM A PROP.
 *
 * This used to take `isHR`, computed on the HR page as
 * `role === "HR_MANAGER" || role === "SUPER_ADMIN"`. That is a third opinion
 * about who may post, alongside the route's own hard-coded list and
 * PERMISSION_MATRIX, and all three disagreed: HQ_EXECUTIVE could post through
 * the API but had no button, VP_GLOBAL_SALES was granted write by the matrix
 * and refused by the route, and a permission override set in
 * Settings → Security changed none of it.
 *
 * The feed now answers canWrite and canDelete, from effectiveHasPermission.
 * The prop is kept only so the HR tab does not need changing, and is no
 * longer consulted.
 */
export function Announcements({ userId }: { isHR?: boolean; userId: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<Announcement[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  // Reach: may this person address everyone, or only their own region?
  const [canApprove, setCanApprove] = useState(false);
  const [myRegionId, setMyRegionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hr/announcements");
      const data = await res.json();
      setItems(data.announcements ?? []);
      setCanWrite(!!data.canWrite);
      setCanDelete(!!data.canDelete);
      setCanApprove(!!data.canApprove);
      setMyRegionId(data.myRegionId ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Only fetched once somebody can actually post — a plain employee has no
  // use for it and the endpoint would answer 403.
  useEffect(() => {
    if (!canWrite || regions.length) return;
    fetch("/api/hr/regions")
      .then((r) => (r.ok ? r.json() : { regions: [] }))
      .then((d) => setRegions(d.regions ?? []))
      .catch(() => setRegions([]));
  }, [canWrite, regions.length]);

  async function markRead(id: string) {
    const res = await fetch(`/api/hr/announcements/${id}/read`, { method: "POST" });
    if (!res.ok) return;
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, isRead: true } : a)));
  }

  function openNew() {
    setEditing(null);
    setForm(
      canApprove
        ? EMPTY_FORM
        : { ...EMPTY_FORM, isGlobal: false, regionId: myRegionId ?? "" },
    );
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(a: Announcement) {
    setEditing(a);
    setForm({
      title: a.title,
      content: a.content,
      isGlobal: a.isGlobal,
      regionId: a.regionId ?? "",
      expiresAt: a.expiresAt ? a.expiresAt.slice(0, 10) : "",
      notifyByEmail: false,
    });
    setFormError(null);
    setShowForm(true);
  }

  /** Pulls something readable out of a Zod flatten, or falls back. */
  function readError(payload: unknown, fallback: string): string {
    const p = payload as
      | { error?: string; details?: { fieldErrors?: Record<string, string[]> } }
      | undefined;
    const field = p?.details?.fieldErrors;
    if (field) {
      const first = Object.values(field).flat().filter(Boolean)[0];
      if (first) return first;
    }
    return p?.error ?? fallback;
  }

  async function save() {
    setSaving(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        title: form.title,
        content: form.content,
        isGlobal: form.isGlobal,
        regionId: form.isGlobal ? null : form.regionId || null,
        expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
      };
      if (!editing) payload.notifyByEmail = form.notifyByEmail;

      const res = await fetch(
        editing ? `/api/hr/announcements/${editing.id}` : "/api/hr/announcements",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      // ★ A FAILED POST USED TO DO NOTHING AT ALL.
      // The old create() checked res.ok and, when it was false, simply fell
      // through: no toast, no message, the dialog sitting open. A 403 and a
      // success were indistinguishable from the chair.
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setFormError(readError(body, `Could not save (${res.status})`));
        return;
      }

      toast({
        title: editing ? "Announcement updated" : "Announcement posted",
        description: editing
          ? undefined
          : form.notifyByEmail
            ? "Everyone it applies to has been notified, by email too."
            : "Everyone it applies to has been notified.",
      });
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await load();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: Announcement) {
    if (!window.confirm(
      `Withdraw "${a.title}"?\n\nIt disappears for everyone, including people who have already read it. This cannot be undone.`
    )) return;

    const res = await fetch(`/api/hr/announcements/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({
        title: "Could not withdraw it",
        description: readError(body, `Error ${res.status}`),
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Announcement withdrawn" });
    setItems((prev) => prev.filter((x) => x.id !== a.id));
  }

  const myRegion = regions.find((r) => r.id === myRegionId) ?? null;

  const formValid =
    form.title.trim().length > 0 &&
    form.content.trim().length > 0 &&
    (canApprove ? (form.isGlobal || !!form.regionId) : !!myRegionId);

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <Button size="sm" onClick={openNew}>
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
            : items.map((ann) => {
              const mine = ann.authorId === userId;
              return (
                <Card key={ann.id} className={!ann.isRead ? "border-[#0EA5E9] bg-blue-50/30 dark:bg-sky-500/10" : ""}>
                  <CardHeader className="py-3 px-4 flex flex-row items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      {!ann.isRead && <div className="w-2 h-2 rounded-full bg-[#0EA5E9] mt-1.5 shrink-0" />}
                      <div className="min-w-0">
                        <p className="font-semibold text-sm break-words">{ann.title}</p>
                        {/* A div, not a p: Badge renders a <div>, and a <div>
                            inside a <p> is invalid HTML — the browser closes
                            the paragraph early and the tree stops matching
                            what the server sent, which is a hydration error. */}
                        <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                          <span suppressHydrationWarning>{formatRelative(ann.publishedAt)}</span>
                          {ann.authorName && <span>· by {ann.authorName}</span>}
                          {ann.isGlobal
                            ? (
                              <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-1">
                                <Globe className="h-2.5 w-2.5" /> Everyone
                              </Badge>
                            )
                            : (
                              <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-1">
                                <MapPin className="h-2.5 w-2.5" /> {ann.regionName ?? "One region"}
                              </Badge>
                            )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!ann.isRead && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => markRead(ann.id)}>
                          <Eye className="h-3 w-3 mr-1" /> Mark Read
                        </Button>
                      )}
                      {canWrite && (mine || canDelete) && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => openEdit(ann)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                          title="Withdraw" onClick={() => remove(ann)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{ann.content}</p>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      <Dialog open={showForm} onOpenChange={(o) => { setShowForm(o); if (!o) setFormError(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Announcement" : "Post Announcement"}</DialogTitle>
            {/* Radix warns without one, and a screen reader otherwise opens an
                unexplained dialog. */}
            <DialogDescription>
              {editing
                ? "Change the wording, who sees it, or when it comes down."
                : "Everyone it applies to gets a notification straight away."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input
                value={form.title}
                maxLength={200}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Content *</Label>
              <Textarea
                value={form.content}
                rows={5}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Who sees it</Label>
              {/* Somebody without `approve` can only reach their own region, so
                  they are shown what will happen rather than a menu whose other
                  options the server would refuse. */}
              {!canApprove ? (
                <div className="rounded-md border px-3 py-2 text-sm">
                  {myRegion
                    ? <>Staff in <b>{myRegion.name}</b>, and nobody else.</>
                    : <span className="text-red-600">
                        Your profile has no region set, so you cannot post yet.
                        Ask an administrator to set it.
                      </span>}
                </div>
              ) : (
              <Select
                value={form.isGlobal ? "all" : (form.regionId || "pick")}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    isGlobal: v === "all",
                    regionId: v === "all" || v === "pick" ? "" : v,
                  })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone at Illume</SelectItem>
                  {regions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name} only</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              )}
              {canApprove && (
                <p className="text-xs text-muted-foreground">
                  A region-only announcement is shown to staff in that region, and nobody else.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Hide it after (optional)</Label>
              <Input
                type="date"
                value={form.expiresAt}
                min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to keep it up until you withdraw it.
              </p>
            </div>

            {!editing && (
              <label className="flex items-start gap-2 rounded-lg border p-3 cursor-pointer">
                <Checkbox
                  checked={form.notifyByEmail}
                  onCheckedChange={(v) => setForm({ ...form, notifyByEmail: v === true })}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  Email it as well
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Everyone gets a notification in the system either way. Tick this
                    only if it is urgent enough for an inbox.
                  </span>
                </span>
              </label>
            )}

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2">
                {formError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={!formValid || saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
