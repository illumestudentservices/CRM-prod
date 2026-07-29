"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, AlertTriangle, AlertCircle, Paperclip, Download, Trash2, FileIcon, Upload, ChevronDown, ChevronRight } from "lucide-react";
import { differenceInDays } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { checkUploadSize, MAX_UPLOAD_MB } from "@/lib/uploads";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

interface Contract {
  id: string;
  title: string;
  value: number | null;
  startDate: Date | string;
  endDate: Date | string;
  status: string;
  documentUrl: string | null;
  notes: string | null;
  attachments?: Attachment[];
}

interface ContractListProps {
  contracts: Contract[];
  institutionId: string;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Renewal warning ──────────────────────────────────────────────────────

function RenewalBadge({ endDate }: { endDate: Date | string }) {
  const daysLeft = differenceInDays(new Date(endDate), new Date());

  if (daysLeft < 0) {
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1">
        <AlertCircle className="h-3 w-3" />
        Expired
      </Badge>
    );
  }
  if (daysLeft < 30) {
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1">
        <AlertCircle className="h-3 w-3" />
        {daysLeft}d left
      </Badge>
    );
  }
  if (daysLeft < 60) {
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1">
        <AlertTriangle className="h-3 w-3" />
        {daysLeft}d left
      </Badge>
    );
  }
  return null;
}

// ─── Status badge ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, string> = {
    ACTIVE: "bg-green-50 text-green-700 border-green-200",
    EXPIRED: "bg-red-50 text-red-700 border-red-200",
    PENDING: "bg-amber-50 text-amber-700 border-amber-200",
    CANCELLED: "bg-slate-50 text-slate-600 border-slate-200",
  };
  return (
    <Badge
      variant="outline"
      className={cn("text-xs", config[status] ?? "bg-slate-50 text-slate-600 border-slate-200")}
    >
      {status}
    </Badge>
  );
}

// ─── Schema ────────────────────────────────────────────────────────────────

const contractSchema = z.object({
  title: z.string().min(1, "Title is required"),
  value: z.coerce.number().positive().optional(),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  status: z.string().default("ACTIVE"),
  notes: z.string().optional(),
});

type ContractFormValues = z.infer<typeof contractSchema>;

// ─── Add Contract Dialog ───────────────────────────────────────────────────

function AddContractDialog({ institutionId }: { institutionId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ContractFormValues>({
    resolver: zodResolver(contractSchema) as never,
    defaultValues: { status: "ACTIVE" },
  });

  const onSubmit = async (data: ContractFormValues) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/contracts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to create contract");
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90">
          <Plus className="h-4 w-4" />
          Add Contract
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Contract</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="title">
              Title <span className="text-red-500">*</span>
            </Label>
            <Input id="title" {...register("title")} placeholder="Contract title" />
            {errors.title && <p className="text-xs text-red-500">{errors.title.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="value">Contract Value (USD)</Label>
            <Input id="value" type="number" step="0.01" {...register("value")} placeholder="0.00" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="startDate">
                Start Date <span className="text-red-500">*</span>
              </Label>
              <Input id="startDate" type="date" {...register("startDate")} />
              {errors.startDate && (
                <p className="text-xs text-red-500">{errors.startDate.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate">
                End Date <span className="text-red-500">*</span>
              </Label>
              <Input id="endDate" type="date" {...register("endDate")} />
              {errors.endDate && (
                <p className="text-xs text-red-500">{errors.endDate.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              defaultValue="ACTIVE"
              onValueChange={(v) => setValue("status", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" {...register("notes")} rows={3} />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90"
            >
              {loading ? "Saving..." : "Create Contract"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Attachment Section ───────────────────────────────────────────────────

function AttachmentSection({
  contractId,
  institutionId,
  initialAttachments,
}: {
  contractId: string;
  institutionId: string;
  initialAttachments: Attachment[];
}) {
  const [attachments, setAttachments] = React.useState<Attachment[]>(initialAttachments);
  const [uploading, setUploading] = React.useState(false);
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const check = checkUploadSize(file);
    if (!check.ok) {
      toast({ title: "File too large", description: check.message, variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/institutions/${institutionId}/contracts/${contractId}/attachments`,
        { method: "POST", body: fd }
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Upload failed");
      }
      const newAtt: Attachment = await res.json();
      setAttachments((prev) => [newAtt, ...prev]);
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (attachmentId: string) => {
    if (!confirm("Delete this attachment?")) return;
    try {
      const res = await fetch(
        `/api/institutions/${institutionId}/contracts/${contractId}/attachments/${attachmentId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      }
    } catch {
      toast({ title: "Could not delete attachment", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={handleUpload}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv,.zip"
        />
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-7 text-xs"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="h-3 w-3" />
          {uploading ? "Uploading..." : "Attach File"}
        </Button>
        {attachments.length > 0 && (
          <span className="text-xs text-slate-500">{attachments.length} file(s)</span>
        )}
      </div>

      {attachments.length > 0 && (
        <div className="space-y-1">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-sm group"
            >
              <FileIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="truncate flex-1 text-slate-700">{att.name}</span>
              <span className="text-xs text-slate-400 shrink-0">{formatFileSize(att.size)}</span>
              <a
                href={`/api/institutions/${institutionId}/contracts/${contractId}/attachments/${att.id}`}
                className="text-blue-600 hover:text-blue-800 shrink-0"
                title="Download"
              >
                <Download className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={() => handleDelete(att.id)}
                className="text-slate-400 hover:text-red-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Contract Row ─────────────────────────────────────────────────────────

function ContractRow({
  contract,
  institutionId,
}: {
  contract: Contract;
  institutionId: string;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-slate-50/50" onClick={() => setExpanded(!expanded)}>
        <TableCell className="font-medium">
          <div className="flex items-center gap-1.5">
            {expanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
            {contract.title}
          </div>
        </TableCell>
        <TableCell>{formatCurrency(contract.value)}</TableCell>
        <TableCell>{formatDate(contract.startDate)}</TableCell>
        <TableCell>{formatDate(contract.endDate)}</TableCell>
        <TableCell>
          <StatusBadge status={contract.status} />
        </TableCell>
        <TableCell>
          <RenewalBadge endDate={contract.endDate} />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1 text-slate-500">
            <Paperclip className="h-3.5 w-3.5" />
            <span className="text-xs">{contract.attachments?.length ?? 0}</span>
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className="bg-slate-50/50 border-t-0">
            <div className="py-2 px-2">
              <AttachmentSection
                contractId={contract.id}
                institutionId={institutionId}
                initialAttachments={contract.attachments ?? []}
              />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ContractList({ contracts, institutionId }: ContractListProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddContractDialog institutionId={institutionId} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Title</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Renewal</TableHead>
                <TableHead>Files</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-400 py-8">
                    No contracts yet.
                  </TableCell>
                </TableRow>
              ) : (
                contracts.map((contract) => (
                  <ContractRow
                    key={contract.id}
                    contract={contract}
                    institutionId={institutionId}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
