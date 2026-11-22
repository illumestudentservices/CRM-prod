"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Monitor, LogOut, Loader2 } from "lucide-react";

interface SessionRow {
  id: string;
  label: string;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

function when(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function SessionsCard() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // sid or "others"

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/sessions");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSessions(data.data ?? []);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function revoke(body: { sid?: string; scope?: "others" }, key: string, label: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/account/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: label });
      await load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Could not log out that session", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const others = (sessions ?? []).filter((s) => !s.current);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Monitor className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              Devices &amp; sessions
            </CardTitle>
            <CardDescription className="mt-1">
              Where you&apos;re signed in. Log out any device you don&apos;t recognise.
            </CardDescription>
          </div>
          {others.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => revoke({ scope: "others" }, "others", "Logged out all other devices")}
              disabled={busy !== null}
              className="gap-2 shrink-0"
            >
              {busy === "others" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Log out all others
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {sessions === null && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…
          </div>
        )}
        {sessions !== null && sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">No active sessions found.</p>
        )}
        {(sessions ?? []).map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium flex items-center gap-2">
                <span className="truncate">{s.label}</span>
                {s.current && (
                  <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30">
                    This device
                  </Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.ipAddress ? `${s.ipAddress} · ` : ""}Signed in {when(s.createdAt)}
              </p>
            </div>
            {!s.current && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => revoke({ sid: s.id }, s.id, "Device logged out")}
                disabled={busy !== null}
                className="gap-1.5 shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                {busy === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Log out
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
