"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { checkUploadSizes, checkUploadSize, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, formatBytes } from "@/lib/uploads";
import { Search, BookOpen, Plus, Eye, Paperclip, Download, Trash2, X, Upload } from "lucide-react";


interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

interface Article {
  id: string;
  title: string;
  content?: string;
  category: string;
  tags: string[];
  views: number;
  isPublished: boolean;
  createdAt: string;
  attachments: Attachment[];
}


export function KnowledgeBaseView({ isHR }: { isHR: boolean }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [articles, setArticles] = useState<Article[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", category: "", tags: "" });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  // View dialog
  const [viewing, setViewing] = useState<Article | null>(null);
  const [uploading, setUploading] = useState(false);
  const viewFileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    const res = await fetch(`/api/hr/knowledge-base?${params}`);
    const data = await res.json();
    setArticles(data.articles || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [search]);

  function pickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Reports every oversized file at once rather than one per attempt.
    const check = checkUploadSizes(files);
    if (!check.ok) {
      toast({ title: "File too large", description: check.message, variant: "destructive" });
    }
    setPendingFiles((prev) => [...prev, ...files.filter((f) => f.size <= MAX_UPLOAD_BYTES)]);
    e.target.value = "";
  }

  async function uploadFile(articleId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/hr/knowledge-base/attachments?articleId=${articleId}`, { method: "POST", body: fd });
    if (!res.ok) {
      let message = `Upload failed (${res.status})`;
      try {
        const err = await res.json();
        if (err?.error) message = err.error;
      } catch { /* non-JSON body */ }
      throw new Error(message);
    }
    const data = await res.json();
    if (!data?.attachment) throw new Error("No attachment returned from server");
    return data.attachment as Attachment;
  }

  async function create() {
    setSaving(true);
    try {
      const res = await fetch("/api/hr/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean) }),
      });
      if (!res.ok) throw new Error("Failed to create article");
      const { article } = await res.json();

      // Upload pending files
      for (const file of pendingFiles) {
        try { await uploadFile(article.id, file); }
        catch (e) {
          toast({
            title: `Failed to upload ${file.name}`,
            description: e instanceof Error ? e.message : "Unknown error",
            variant: "destructive",
          });
        }
      }

      toast({ title: "Article created" });
      setShowForm(false);
      setForm({ title: "", content: "", category: "", tags: "" });
      setPendingFiles([]);
      load();
    } catch {
      toast({ title: "Failed to create article", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function addAttachmentToViewing(e: React.ChangeEvent<HTMLInputElement>) {
    if (!viewing) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const check = checkUploadSize(file);
    if (!check.ok) {
      toast({ title: "File too large", description: check.message, variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const att = await uploadFile(viewing.id, file);
      const updated = { ...viewing, attachments: [...viewing.attachments, att] };
      setViewing(updated);
      setArticles((prev) => prev.map((a) => a.id === updated.id ? updated : a));
      toast({ title: "File attached" });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function deleteAttachment(articleId: string, attId: string) {
    await fetch(`/api/hr/knowledge-base/attachments/${attId}`, { method: "DELETE" });
    const updateAtts = (atts: Attachment[]) => atts.filter((a) => a.id !== attId);
    setArticles((prev) => prev.map((a) => a.id === articleId ? { ...a, attachments: updateAtts(a.attachments) } : a));
    if (viewing?.id === articleId) setViewing((v) => v ? { ...v, attachments: updateAtts(v.attachments) } : v);
    toast({ title: "Attachment removed" });
  }

  const grouped = articles.reduce<Record<string, Article[]>>((acc, a) => {
    if (!acc[a.category]) acc[a.category] = [];
    acc[a.category].push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search knowledge base..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isHR && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Article
          </Button>
        )}
      </div>

      {loading
        ? <div className="h-32 bg-muted animate-pulse rounded-lg" />
        : Object.keys(grouped).length === 0
          ? (
            <div className="text-center py-12 text-muted-foreground">
              <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>No articles found</p>
            </div>
          )
          : Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h3 className="font-semibold text-sm mb-2 text-muted-foreground uppercase tracking-wide">{category}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map((article) => (
                  <Card key={article.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setViewing(article)}>
                    <CardHeader className="py-3 px-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm">{article.title}</p>
                        <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                          {article.attachments.length > 0 && (
                            <span className="flex items-center gap-0.5">
                              <Paperclip className="h-3 w-3" />{article.attachments.length}
                            </span>
                          )}
                          <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{article.views}</span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <div className="flex flex-wrap gap-1">
                        {article.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}

      {/* ── Create article dialog ── */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Knowledge Base Article</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Category *</Label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Onboarding, SOPs, Policies" />
            </div>
            <div className="space-y-2">
              <Label>Content *</Label>
              <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={5} />
            </div>
            <div className="space-y-2">
              <Label>Tags (comma separated)</Label>
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="visa, student, process" />
            </div>

            {/* File attachments */}
            <div className="space-y-2">
              <Label>Attachments <span className="text-xs text-muted-foreground font-normal">(max {MAX_UPLOAD_MB} MB each)</span></Label>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={pickFiles} />
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> Choose files
              </Button>
              {pendingFiles.length > 0 && (
                <div className="space-y-1">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-muted rounded px-2 py-1">
                      <span className="truncate max-w-[260px]">{f.name}</span>
                      <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                        <span>{formatBytes(f.size)}</span>
                        <button onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}>
                          <X className="h-3 w-3 hover:text-destructive" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setPendingFiles([]); }}>Cancel</Button>
            <Button onClick={create} disabled={!form.title || !form.content || saving}>
              {saving ? "Publishing..." : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View article dialog ── */}
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        {viewing && (
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{viewing.title}</DialogTitle>
              <div className="flex flex-wrap gap-1 pt-1">
                {viewing.tags.map((t) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
              </div>
            </DialogHeader>

            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{viewing.content ?? ""}</p>

            {/* Attachments section */}
            <div className="border-t pt-4 mt-2 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Paperclip className="h-4 w-4" /> Attachments
                  {viewing.attachments.length > 0 && <span className="text-muted-foreground">({viewing.attachments.length})</span>}
                </p>
                {isHR && (
                  <>
                    <input ref={viewFileRef} type="file" className="hidden" onChange={addAttachmentToViewing} />
                    <Button size="sm" variant="outline" disabled={uploading} onClick={() => viewFileRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5 mr-1" /> {uploading ? "Uploading..." : "Attach file"}
                    </Button>
                  </>
                )}
              </div>

              {viewing.attachments.length === 0
                ? <p className="text-xs text-muted-foreground">No attachments</p>
                : (
                  <div className="space-y-1">
                    {viewing.attachments.map((att) => (
                      <div key={att.id} className="flex items-center justify-between text-sm bg-muted rounded px-3 py-2">
                        <span className="truncate max-w-[340px] font-medium">{att.name}</span>
                        <div className="flex items-center gap-2 shrink-0 text-muted-foreground text-xs">
                          <span>{formatBytes(att.size)}</span>
                          <a href={`/api/hr/knowledge-base/attachments/${att.id}`} download={att.name} className="hover:text-foreground">
                            <Download className="h-4 w-4" />
                          </a>
                          {isHR && (
                            <button onClick={() => deleteAttachment(viewing.id, att.id)} className="hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
