"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Globe, Plus, Trash2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Region {
  id: string;
  name: string;
  code: string;
  description: string | null;
  _count: { users: number; leads: number; institutions: number };
}

export function RegionsSettingsTab() {
  const { toast } = useToast();
  const [regions, setRegions]     = useState<Region[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [form, setForm]           = useState({ name: "", code: "", description: "" });
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/settings/regions")
      .then((r) => r.json())
      .then((d) => { setRegions(d.regions || []); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  async function addRegion() {
    if (!form.name.trim() || !form.code.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/regions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create region");
      toast({ title: `Region "${form.name}" created` });
      setShowAdd(false);
      setForm({ name: "", code: "", description: "" });
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteRegion(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/settings/regions?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      toast({ title: "Region deleted" });
      setConfirmId(null);
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end"><div className="h-9 w-32 bg-muted animate-pulse rounded" /></div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-28 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{regions.length} region{regions.length !== 1 ? "s" : ""} configured</p>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Region
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {regions.map((r) => (
          <Card key={r.id} className="hover:shadow-md transition-shadow group">
            <CardContent className="pt-4 pb-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-[#0EA5E9] shrink-0" />
                  <p className="font-semibold">{r.name}</p>
                  <Badge variant="outline" className="font-mono text-xs">{r.code}</Badge>
                </div>
                <button
                  onClick={() => setConfirmId(r.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                  title="Delete region"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
              <div className="flex gap-4 text-xs text-muted-foreground pt-1">
                <span><strong>{r._count.users}</strong> users</span>
                <span><strong>{r._count.leads}</strong> leads</span>
                <span><strong>{r._count.institutions}</strong> institutions</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Region</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Region Name *</Label>
              <Input placeholder="e.g. China" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Code * <span className="text-xs text-muted-foreground">(short identifier)</span></Label>
              <Input placeholder="e.g. CN" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} maxLength={10} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input placeholder="Optional description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={addRegion} disabled={!form.name.trim() || !form.code.trim() || saving}>
              {saving ? "Creating…" : "Create Region"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!confirmId} onOpenChange={(o) => { if (!o) setConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" /> Delete Region
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the region. It cannot be deleted if it has associated users, leads, or institutions.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleting === confirmId}
              onClick={() => confirmId && deleteRegion(confirmId)}
            >
              {deleting === confirmId ? "Deleting…" : "Delete Region"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
