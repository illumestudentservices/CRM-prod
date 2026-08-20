"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpen,
  Building2,
  Globe,
  FileText,
  Plus,
  Search,
  Eye,
  Calendar,
  Tag,
  Paperclip,
  Upload,
  Download,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { checkUploadSize } from "@/lib/uploads";
import { ExportButton } from "@/components/shared/export-button";

// ─── Types ───────────────────────────────────────────────────────────────────

interface KbAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

interface Article {
  id: string;
  /** Already returned by all three knowledge endpoints; the UI simply never read it. */
  attachments?: KbAttachment[];
  title: string;
  content: string;
  category: string;
  knowledgeType: string;
  tags: string[];
  views: number;
  createdAt: string;
  institutionId?: string | null;
  marketId?: string | null;
}

interface Institution {
  id: string;
  name: string;
}

interface Market {
  id: string;
  name: string;
}

interface KnowledgeClientProps {
  generalArticles: Article[];
  institutions: Institution[];
  markets: Market[];
  proposalArticles: Article[];
  /**
   * Attaching is decided per article, because the three knowledge bases are
   * gated differently — a Regional Manager may attach to a client or market
   * article but not a general one. Mirrors canWriteKbArticle in lib/kb-access.ts.
   */
  canWriteGeneral: boolean;
  canWriteInstitutions: boolean;
  canWriteMarkets: boolean;
}

// ─── Article Card ────────────────────────────────────────────────────────────

function ArticleCard({
  article,
  onClick,
}: {
  article: Article;
  onClick: () => void;
}) {
  const excerpt =
    article.content.length > 150
      ? article.content.slice(0, 150) + "..."
      : article.content;

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow border-slate-200 dark:border-slate-800"
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 line-clamp-2">
            {article.title}
          </h3>
          <Badge
            variant="secondary"
            className="shrink-0 text-xs bg-[#0EA5E9]/10 text-[#0EA5E9] border-0"
          >
            {article.category}
          </Badge>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-3">
          {excerpt}
        </p>
        {article.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {article.tags.slice(0, 4).map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400"
              >
                {tag}
              </Badge>
            ))}
            {article.tags.length > 4 && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400"
              >
                +{article.tags.length - 4}
              </Badge>
            )}
          </div>
        )}
        <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500 pt-0.5">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {new Date(article.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </span>
          {/* An unread article reading "0 views" on every card is just noise */}
          {article.views > 0 && (
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {article.views} {article.views === 1 ? "view" : "views"}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


/** Human-readable file size. 1 kB rather than 1024 B, as file managers show. */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Attachments on a knowledge article.
 *
 * One component for all three knowledge bases — General, Client and Market —
 * because all three write to the same table and share this dialog. The upload
 * endpoint lives under /api/hr/ for historical reasons but is not HR-specific:
 * it takes any article id, and since lib/kb-access.ts it authorises against the
 * article rather than a fixed role list.
 */
function ArticleAttachments({
  article,
  canEdit,
  onChanged,
}: {
  article: Article;
  canEdit: boolean;
  onChanged: (next: KbAttachment[]) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const items = article.attachments ?? [];

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const check = checkUploadSize(file);
    if (!check.ok) {
      toast({ title: "File too large", description: check.message, variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/hr/knowledge-base/attachments?articleId=${article.id}`, {
        method: "POST", body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Upload failed");
      onChanged([...(article.attachments ?? []), data.attachment]);
      toast({ title: "Attached", description: file.name });
    } catch (err) {
      toast({
        title: "Could not attach",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(att: KbAttachment) {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/knowledge-base/attachments/${att.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Delete failed");
      }
      onChanged(items.filter((a) => a.id !== att.id));
      toast({ title: "Attachment removed", description: att.name });
    } catch (err) {
      toast({
        title: "Could not remove",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit && items.length === 0) return null;

  return (
    <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" />
          Attachments{items.length > 0 ? ` (${items.length})` : ""}
        </p>
        {canEdit && (
          <>
            <input ref={inputRef} type="file" className="hidden" onChange={upload} />
            <Button
              size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {busy ? "Working…" : "Add file"}
            </Button>
          </>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">No files attached.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-800 px-2.5 py-1.5"
            >
              <a
                href={`/api/hr/knowledge-base/attachments/${a.id}`}
                className="text-xs text-[#0EA5E9] hover:underline truncate flex items-center gap-1.5 min-w-0"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{a.name}</span>
              </a>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-slate-400 dark:text-slate-500">{fileSize(a.size)}</span>
                {canEdit && (
                  <button
                    onClick={() => remove(a)}
                    disabled={busy}
                    aria-label={`Remove ${a.name}`}
                    className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Article Detail Dialog ─────────────────────────────────────────────

function ArticleDialog({
  article,
  open,
  onClose,
  canEdit,
  onArticleChanged,
}: {
  article: Article | null;
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
  onArticleChanged: (next: Article) => void;
}) {
  if (!article) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{article.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-[#0EA5E9]/10 text-[#0EA5E9] border-0">
              {article.category}
            </Badge>
            {article.tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="text-xs border-slate-300 dark:border-slate-700"
              >
                <Tag className="h-3 w-3 mr-1" />
                {tag}
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {article.views} views
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(article.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
          <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
            {article.content}
          </div>
          <ArticleAttachments
            article={article}
            canEdit={canEdit}
            onChanged={(next) => onArticleChanged({ ...article, attachments: next })}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Article Dialog ───────────────────────────────────────────────────

function CreateArticleDialog({
  open,
  onClose,
  onSubmit,
  categories,
  title: dialogTitle,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    content: string;
    category: string;
    tags: string[];
  }) => Promise<void>;
  categories: string[];
  title: string;
}) {
  const [formTitle, setFormTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [tagsInput, setTagsInput] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async () => {
    if (!formTitle || !content || !category) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: formTitle,
        content,
        category,
        tags: tagsInput
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setFormTitle("");
      setContent("");
      setCategory("");
      setTagsInput("");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="article-title">Title</Label>
            <Input
              id="article-title"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Article title"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="article-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="article-content">Content</Label>
            <Textarea
              id="article-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your content here..."
              rows={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="article-tags">Tags (comma-separated)</Label>
            <Input
              id="article-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. admissions, scholarships, 2024"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !formTitle || !content || !category}
              className="bg-[#0EA5E9] hover:bg-[#0EA5E9]/90"
            >
              {submitting ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Articles Grid ───────────────────────────────────────────────────────────

/**
 * Matches a query against everything a reader might reasonably search for —
 * title, body, category and tags — rather than title alone. A knowledge base
 * is only as useful as its retrieval.
 */
function filterArticles(articles: Article[], query: string): Article[] {
  const q = query.trim().toLowerCase();
  if (!q) return articles;
  const terms = q.split(/\s+/);
  return articles.filter((a) => {
    const haystack = [a.title, a.content, a.category, ...a.tags]
      .join(" ")
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/** Search field shared by every tab's toolbar. */
function KbSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1 max-w-sm">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8 h-9"
      />
    </div>
  );
}

function ArticlesGrid({
  articles,
  onArticleClick,
  emptyMessage,
}: {
  articles: Article[];
  onArticleClick: (article: Article) => void;
  emptyMessage?: string;
}) {
  if (articles.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400 dark:text-slate-500">
        <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">{emptyMessage || "No articles found"}</p>
      </div>
    );
  }

  // Group by category
  const grouped = articles.reduce(
    (acc, article) => {
      const cat = article.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(article);
      return acc;
    },
    {} as Record<string, Article[]>
  );

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat}>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0EA5E9]" />
            {cat}
            <Badge variant="secondary" className="text-[10px] ml-1">
              {items.length}
            </Badge>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                onClick={() => onArticleClick(article)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

const GENERAL_CATEGORIES = [
  "Policies",
  "Procedures",
  "Training",
  "Guidelines",
  "FAQ",
  "Templates",
];
const INSTITUTION_CATEGORIES = [
  "Programs",
  "Selling Points",
  "Scholarships",
  "Admissions Requirements",
];
const MARKET_CATEGORIES = [
  "Country Reports",
  "Competitor Analysis",
  "Regulatory Updates",
];
const PROPOSAL_CATEGORIES = [
  "GCU",
  "Cardiff",
  "TAFE",
  "Brock",
  "Kent",
  "Waterloo",
  "Custom",
];

export function KnowledgeClient({
  canWriteGeneral,
  canWriteInstitutions,
  canWriteMarkets,
  generalArticles: initialGeneral,
  institutions,
  markets,
  proposalArticles: initialProposals,
}: KnowledgeClientProps) {
  const router = useRouter();

  // State
  const [viewArticle, setViewArticle] = React.useState<Article | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createContext, setCreateContext] = React.useState<{
    tab: string;
    categories: string[];
    title: string;
  }>({ tab: "general", categories: GENERAL_CATEGORIES, title: "Create Article" });

  // General KB
  const [generalArticles] = React.useState<Article[]>(initialGeneral);

  // Institution KB
  const [selectedInstitution, setSelectedInstitution] = React.useState("");
  const [institutionArticles, setInstitutionArticles] = React.useState<Article[]>([]);
  const [loadingInstitution, setLoadingInstitution] = React.useState(false);

  // Market KB
  const [selectedMarket, setSelectedMarket] = React.useState("");
  const [marketArticles, setMarketArticles] = React.useState<Article[]>([]);
  const [loadingMarket, setLoadingMarket] = React.useState(false);

  // Proposal Library
  const [proposalArticles, setProposalArticles] = React.useState<Article[]>(initialProposals);
  const [proposalSearch, setProposalSearch] = React.useState("");
  const [generalSearch, setGeneralSearch] = React.useState("");
  const [institutionSearch, setInstitutionSearch] = React.useState("");
  const [marketSearch, setMarketSearch] = React.useState("");
  const [proposalCategory, setProposalCategory] = React.useState("");

  // ─── Fetch institution articles ────────────────────────────────────────────

  React.useEffect(() => {
    if (!selectedInstitution) {
      setInstitutionArticles([]);
      return;
    }
    setLoadingInstitution(true);
    fetch(`/api/institutions/${selectedInstitution}/knowledge`)
      .then((r) => r.json())
      .then((data) => setInstitutionArticles(data.articles ?? []))
      .catch(() => setInstitutionArticles([]))
      .finally(() => setLoadingInstitution(false));
  }, [selectedInstitution]);

  // ─── Fetch market articles ─────────────────────────────────────────────────

  React.useEffect(() => {
    if (!selectedMarket) {
      setMarketArticles([]);
      return;
    }
    setLoadingMarket(true);
    fetch(`/api/markets/${selectedMarket}/knowledge`)
      .then((r) => r.json())
      .then((data) => setMarketArticles(data.articles ?? []))
      .catch(() => setMarketArticles([]))
      .finally(() => setLoadingMarket(false));
  }, [selectedMarket]);

  // ─── Fetch proposal articles with filters ──────────────────────────────────

  const fetchProposals = React.useCallback(() => {
    const params = new URLSearchParams();
    if (proposalCategory && proposalCategory !== "all") params.set("category", proposalCategory);
    if (proposalSearch) params.set("search", proposalSearch);
    fetch(`/api/knowledge/proposals?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setProposalArticles(data.articles ?? []))
      .catch(() => {});
  }, [proposalCategory, proposalSearch]);

  React.useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  // ─── Create handlers ──────────────────────────────────────────────────────

  const handleCreateGeneral = async (data: {
    title: string;
    content: string;
    category: string;
    tags: string[];
  }) => {
    await fetch("/api/hr/knowledge-base", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, knowledgeType: "GENERAL" }),
    });
    router.refresh();
  };

  const handleCreateInstitution = async (data: {
    title: string;
    content: string;
    category: string;
    tags: string[];
  }) => {
    if (!selectedInstitution) return;
    await fetch(`/api/institutions/${selectedInstitution}/knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    // Refetch
    const res = await fetch(`/api/institutions/${selectedInstitution}/knowledge`);
    const result = await res.json();
    setInstitutionArticles(result.articles ?? []);
    router.refresh();
  };

  const handleCreateMarket = async (data: {
    title: string;
    content: string;
    category: string;
    tags: string[];
  }) => {
    if (!selectedMarket) return;
    await fetch(`/api/markets/${selectedMarket}/knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const res = await fetch(`/api/markets/${selectedMarket}/knowledge`);
    const result = await res.json();
    setMarketArticles(result.articles ?? []);
    router.refresh();
  };

  const handleCreateProposal = async (data: {
    title: string;
    content: string;
    category: string;
    tags: string[];
  }) => {
    await fetch("/api/knowledge/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    fetchProposals();
    router.refresh();
  };

  const openCreate = (
    tab: string,
    categories: string[],
    title: string
  ) => {
    setCreateContext({ tab, categories, title });
    setCreateOpen(true);
  };

  const handleCreateSubmit = async (data: {
    title: string;
    content: string;
    category: string;
    tags: string[];
  }) => {
    switch (createContext.tab) {
      case "general":
        return handleCreateGeneral(data);
      case "institution":
        return handleCreateInstitution(data);
      case "market":
        return handleCreateMarket(data);
      case "proposal":
        return handleCreateProposal(data);
    }
  };

  return (
    <>
      <Tabs defaultValue="general" className="space-y-4">
        <div className="flex items-center justify-between">
        <TabsList className="bg-slate-100 dark:bg-slate-800">
          <TabsTrigger value="general" className="gap-1.5">
            <BookOpen className="h-4 w-4" />
            General KB
          </TabsTrigger>
          <TabsTrigger value="institution" className="gap-1.5">
            <Building2 className="h-4 w-4" />
            Institution KB
          </TabsTrigger>
          <TabsTrigger value="market" className="gap-1.5">
            <Globe className="h-4 w-4" />
            Market KB
          </TabsTrigger>
          <TabsTrigger value="proposal" className="gap-1.5">
            <FileText className="h-4 w-4" />
            Proposal Library
          </TabsTrigger>
        </TabsList>
        <ExportButton
          exports={[
            {
              label: "General Articles",
              data: generalArticles.map((a) => ({
                title: a.title,
                category: a.category,
                tags: a.tags.join(", ") || "—",
                views: a.views,
                createdAt: new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
              })),
              columns: [
                { key: "title", header: "Title" },
                { key: "category", header: "Category" },
                { key: "tags", header: "Tags" },
                { key: "views", header: "Views" },
                { key: "createdAt", header: "Created At" },
              ],
              filename: "general-articles",
            },
            {
              label: "Proposals",
              data: proposalArticles.map((a) => ({
                title: a.title,
                category: a.category,
                tags: a.tags.join(", ") || "—",
                views: a.views,
                createdAt: new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
              })),
              columns: [
                { key: "title", header: "Title" },
                { key: "category", header: "Category" },
                { key: "tags", header: "Tags" },
                { key: "views", header: "Views" },
                { key: "createdAt", header: "Created At" },
              ],
              filename: "proposals",
            },
          ]}
          title="Export Knowledge Base"
        />
        </div>

        {/* ─── General KB ─────────────────────────────────────────────────── */}
        <TabsContent value="general" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <KbSearch
              value={generalSearch}
              onChange={setGeneralSearch}
              placeholder="Search articles, tags, categories..."
            />
            <Button
              size="sm"
              className="bg-[#0EA5E9] hover:bg-[#0EA5E9]/90 gap-1.5 shrink-0"
              onClick={() =>
                openCreate("general", GENERAL_CATEGORIES, "Create Article")
              }
            >
              <Plus className="h-4 w-4" />
              Create Article
            </Button>
          </div>
          <ArticlesGrid
            articles={filterArticles(generalArticles, generalSearch)}
            onArticleClick={setViewArticle}
            emptyMessage={
              generalSearch
                ? `No articles match "${generalSearch}"`
                : "No general knowledge base articles yet"
            }
          />
        </TabsContent>

        {/* ─── Institution KB ─────────────────────────────────────────────── */}
        <TabsContent value="institution" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="w-72">
              <Select
                value={selectedInstitution}
                onValueChange={setSelectedInstitution}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select institution..." />
                </SelectTrigger>
                <SelectContent>
                  {institutions.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedInstitution && (
              <>
                <KbSearch
                  value={institutionSearch}
                  onChange={setInstitutionSearch}
                  placeholder="Search this institution's entries..."
                />
                <Button
                  size="sm"
                  className="bg-[#0EA5E9] hover:bg-[#0EA5E9]/90 gap-1.5 shrink-0"
                  onClick={() =>
                    openCreate(
                      "institution",
                      INSTITUTION_CATEGORIES,
                      "Add Institution Entry"
                    )
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add Entry
                </Button>
              </>
            )}
          </div>
          {!selectedInstitution ? (
            <div className="text-center py-12 text-slate-400 dark:text-slate-500">
              <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">
                Select an institution to view its knowledge base
              </p>
            </div>
          ) : loadingInstitution ? (
            <div className="text-center py-12 text-slate-400 dark:text-slate-500">
              <p className="text-sm">Loading...</p>
            </div>
          ) : (
            <ArticlesGrid
              articles={filterArticles(institutionArticles, institutionSearch)}
              onArticleClick={setViewArticle}
              emptyMessage={
                institutionSearch
                  ? `No entries match "${institutionSearch}"`
                  : "No entries for this institution yet"
              }
            />
          )}
        </TabsContent>

        {/* ─── Market KB ──────────────────────────────────────────────────── */}
        <TabsContent value="market" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="w-72">
              <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                <SelectTrigger>
                  <SelectValue placeholder="Select market..." />
                </SelectTrigger>
                <SelectContent>
                  {markets.map((mkt) => (
                    <SelectItem key={mkt.id} value={mkt.id}>
                      {mkt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedMarket && (
              <>
                <KbSearch
                  value={marketSearch}
                  onChange={setMarketSearch}
                  placeholder="Search this market's entries..."
                />
                <Button
                  size="sm"
                  className="bg-[#0EA5E9] hover:bg-[#0EA5E9]/90 gap-1.5 shrink-0"
                  onClick={() =>
                    openCreate("market", MARKET_CATEGORIES, "Add Market Entry")
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add Entry
                </Button>
              </>
            )}
          </div>
          {!selectedMarket ? (
            <div className="text-center py-12 text-slate-400 dark:text-slate-500">
              <Globe className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">
                Select a market to view its knowledge base
              </p>
            </div>
          ) : loadingMarket ? (
            <div className="text-center py-12 text-slate-400 dark:text-slate-500">
              <p className="text-sm">Loading...</p>
            </div>
          ) : (
            <ArticlesGrid
              articles={filterArticles(marketArticles, marketSearch)}
              onArticleClick={setViewArticle}
              emptyMessage={
                marketSearch
                  ? `No entries match "${marketSearch}"`
                  : "No entries for this market yet"
              }
            />
          )}
        </TabsContent>

        {/* ─── Proposal Library ───────────────────────────────────────────── */}
        <TabsContent value="proposal" className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search proposals..."
                  value={proposalSearch}
                  onChange={(e) => setProposalSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="w-48">
                <Select
                  value={proposalCategory}
                  onValueChange={setProposalCategory}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {PROPOSAL_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              size="sm"
              className="bg-[#0EA5E9] hover:bg-[#0EA5E9]/90 gap-1.5"
              onClick={() =>
                openCreate(
                  "proposal",
                  PROPOSAL_CATEGORIES,
                  "Add Proposal Section"
                )
              }
            >
              <Plus className="h-4 w-4" />
              Add Proposal Section
            </Button>
          </div>
          <ArticlesGrid
            articles={proposalArticles}
            onArticleClick={setViewArticle}
            emptyMessage="No proposal sections found"
          />
        </TabsContent>
      </Tabs>

      {/* View Article Dialog */}
      <ArticleDialog
        article={viewArticle}
        open={!!viewArticle}
        onClose={() => setViewArticle(null)}
        canEdit={
          viewArticle?.institutionId
            ? canWriteInstitutions
            : viewArticle?.marketId
            ? canWriteMarkets
            : canWriteGeneral
        }
        onArticleChanged={(next) => setViewArticle(next)}
      />

      {/* Create Article Dialog */}
      <CreateArticleDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateSubmit}
        categories={createContext.categories}
        title={createContext.title}
      />
    </>
  );
}
