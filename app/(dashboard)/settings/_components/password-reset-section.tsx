"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/utils";
import { Link2, Search } from "lucide-react";

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  role: string;
  isActive: boolean;
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: "bg-red-100 text-red-700",
  HQ_EXECUTIVE: "bg-purple-100 text-purple-700",
  HQ_ANALYTICS: "bg-indigo-100 text-indigo-700",
  REGIONAL_MANAGER: "bg-blue-100 text-blue-700",
  ICR: "bg-teal-100 text-teal-700",
  INSTITUTION_CLIENT: "bg-amber-100 text-amber-700",
  HR_MANAGER: "bg-green-100 text-green-700",
  EMPLOYEE: "bg-gray-100 text-gray-700",
};

interface ResetTarget { id: string; name: string | null; email: string; }

export function PasswordResetSection() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch("/api/settings/users")
      .then((r) => r.json())
      .then((d) => { setUsers(d.users || []); setLoading(false); });
  }, []);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return !q || (u.name ?? "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  async function handleSendLink() {
    if (!resetTarget) return;
    setSending(true);
    try {
      const res = await fetch(`/api/settings/users/${resetTarget.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error || "Failed to send reset link", variant: "destructive" });
        return;
      }
      toast({ title: "Reset link sent", description: `A secure password reset link was emailed to ${resetTarget.email}` });
      setResetTarget(null);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">User Password Reset</h3>
          <p className="text-xs text-slate-500 mt-0.5">Send a one-time magic link so users can set their own password securely.</p>
        </div>
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Search users…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />
            ))}
          </div>
        ) : (
          <div className="divide-y max-h-80 overflow-y-auto">
            {filtered.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-xs bg-[#1E3A5F] text-white">
                    {getInitials(u.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{u.name ?? u.email}</p>
                  <p className="text-xs text-slate-400 truncate">{u.email}</p>
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${ROLE_COLORS[u.role] ?? "bg-gray-100 text-gray-700"}`}>
                  {u.role.replace(/_/g, " ")}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0"
                  onClick={() => setResetTarget({ id: u.id, name: u.name, email: u.email })}
                  disabled={!u.isActive}
                >
                  <Link2 className="h-3.5 w-3.5 mr-1" />
                  Send Link
                </Button>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-sm text-slate-400 py-8">No users found.</p>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!resetTarget} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Password Reset Link</DialogTitle>
            <DialogDescription>
              A secure one-time link will be emailed to{" "}
              <strong>{resetTarget?.name ?? resetTarget?.email}</strong> ({resetTarget?.email}).
              The link expires in 24 hours and can only be used once.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              <Link2 className="h-4 w-4 mt-0.5 shrink-0 text-blue-600" />
              <p>The user will receive an email with a secure link to set their own password. No password is shared over email.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button onClick={handleSendLink} disabled={sending}>
              {sending ? "Sending…" : "Send Reset Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
