"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { EmailLink } from "@/components/shared/email-link";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export interface Contact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

interface ContactsPanelProps {
  contacts: Contact[];
  institutionId: string;
  /** Gate the Add/Edit/Delete controls; the API enforces it too. */
  canWrite: boolean;
}

export function ContactsPanel({ contacts, institutionId, canWrite }: ContactsPanelProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Contact | null>(null);
  const [form, setForm] = React.useState({ name: "", title: "", email: "", phone: "", isPrimary: false });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  function openAdd() {
    setEditing(null);
    setForm({ name: "", title: "", email: "", phone: "", isPrimary: false });
    setError(null);
    setDialogOpen(true);
  }
  function openEdit(c: Contact) {
    setEditing(c);
    setForm({ name: c.name, title: c.title ?? "", email: c.email ?? "", phone: c.phone ?? "", isPrimary: c.isPrimary });
    setError(null);
    setDialogOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required."); return; }
    setLoading(true);
    setError(null);
    try {
      const url = editing
        ? `/api/institutions/${institutionId}/contacts/${editing.id}`
        : `/api/institutions/${institutionId}/contacts`;
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save contact");
      setDialogOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this contact? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/contacts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to delete");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete contact");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex justify-end">
          <Button size="sm" onClick={openAdd} className="gap-2 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90">
            <Plus className="h-4 w-4" />
            Add Contact
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80 dark:bg-slate-900/40">
                <TableHead>Name</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Primary</TableHead>
                {canWrite && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canWrite ? 6 : 5} className="text-center text-slate-400 dark:text-slate-500 py-8">
                    No contacts added yet.
                  </TableCell>
                </TableRow>
              ) : (
                contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="font-medium">{contact.name}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{contact.title ?? "—"}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      <EmailLink email={contact.email} kind="business" />
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{contact.phone ?? "—"}</TableCell>
                    <TableCell>
                      {contact.isPrimary && (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30 text-xs">
                          Primary
                        </Badge>
                      )}
                    </TableCell>
                    {canWrite && (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(contact)} aria-label="Edit contact">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-600 hover:text-red-700" disabled={deletingId === contact.id} onClick={() => remove(contact.id)} aria-label="Delete contact">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Contact" : "Add Contact"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Name <span className="text-red-500">*</span></Label>
              <Input id="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-title">Title</Label>
              <Input id="c-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Director of Partnerships" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Phone</Label>
              <Input id="c-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Optional" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={form.isPrimary} onCheckedChange={(v) => setForm({ ...form, isPrimary: !!v })} />
              Set as primary contact
            </label>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md dark:bg-red-500/15 dark:text-red-300">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={loading} className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90">
                {loading ? "Saving..." : editing ? "Save Changes" : "Add Contact"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
