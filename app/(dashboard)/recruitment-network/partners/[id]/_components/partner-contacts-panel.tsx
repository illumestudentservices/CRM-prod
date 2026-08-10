"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Contact {
  id: string;
  fullName: string;
  position: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

const ROLE_OPTIONS = ["COUNSELLOR", "OWNER", "BRANCH_MANAGER", "SENIOR_COUNSELLOR", "ADVISOR", "OTHER"];

export function PartnerContactsPanel({
  partnerId,
  initialContacts,
}: {
  partnerId: string;
  initialContacts: Contact[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    position: "",
    role: "COUNSELLOR",
    email: "",
    phone: "",
    isPrimary: false,
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.fullName.trim()) {
      setError("Full name is required.");
      return;
    }
    const resp = await fetch("/api/partner-contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partnerId, ...form }),
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      setError(j?.error ?? `HTTP ${resp.status}`);
      return;
    }
    setForm({ fullName: "", position: "", role: "COUNSELLOR", email: "", phone: "", isPrimary: false });
    setShowAdd(false);
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    if (!confirm("Deactivate this contact?")) return;
    await fetch(`/api/partner-contacts/${id}`, { method: "DELETE" });
    startTransition(() => router.refresh());
  }

  return (
    <div className="border rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">Contacts</h3>
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="text-sm px-3 py-1 border rounded hover:bg-muted"
        >
          {showAdd ? "Cancel" : "+ Add contact"}
        </button>
      </div>

      {initialContacts.length === 0 && !showAdd && (
        <p className="text-sm text-muted-foreground">No contacts yet.</p>
      )}

      {initialContacts.length > 0 && (
        <ul className="space-y-2 mb-3">
          {initialContacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between border-b py-2">
              <div>
                <div className="text-sm font-medium">
                  {c.fullName}
                  {c.isPrimary && <span className="ml-2 text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 rounded">Primary</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.role}{c.position ? ` · ${c.position}` : ""}
                  {c.email && <> · {c.email}</>}
                  {c.phone && <> · {c.phone}</>}
                </div>
              </div>
              <button onClick={() => remove(c.id)} className="text-xs text-red-600 dark:text-red-400 hover:underline">
                Deactivate
              </button>
            </li>
          ))}
        </ul>
      )}

      {showAdd && (
        <form onSubmit={submit} className="space-y-2 mt-3 pt-3 border-t">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Full name *"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
              required
            />
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            >
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
            </select>
            <input
              placeholder="Position"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            />
            <input
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            />
            <input
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isPrimary}
                onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
              />
              Primary contact
            </label>
          </div>
          <button type="submit" disabled={pending} className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 disabled:opacity-50">
            {pending ? "Saving..." : "Save contact"}
          </button>
        </form>
      )}
    </div>
  );
}
