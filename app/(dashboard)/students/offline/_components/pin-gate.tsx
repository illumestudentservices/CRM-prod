"use client";

import * as React from "react";
import { Lock, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  hasPin,
  setPin as storePin,
  unlock,
  resetVault,
  countLegacyPlaintext,
  clearLegacyPlaintext,
} from "@/lib/offline-queue";

const MIN_PIN = 6;

/**
 * Stands in front of the capture screen until the device is unlocked.
 *
 * Leads are encrypted with a key derived from this PIN and nothing else, so
 * there is no recovery: a forgotten PIN means the held leads are gone. That is
 * stated plainly rather than buried, because the alternative — storing
 * something that can recover the key — would make the encryption pointless
 * against the one threat it exists for, which is someone picking up the phone.
 */
export function PinGate({ onUnlocked }: { onUnlocked: (key: CryptoKey) => void }) {
  const [mode, setMode] = React.useState<"loading" | "set" | "enter">("loading");
  const [pin, setPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [legacy, setLegacy] = React.useState(0);
  const [confirmingReset, setConfirmingReset] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        setLegacy(await countLegacyPlaintext());
        setMode((await hasPin()) ? "enter" : "set");
      } catch {
        setMode("set");
      }
    })();
  }, []);

  async function handleSet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pin.length < MIN_PIN) return setError(`Use at least ${MIN_PIN} digits.`);
    if (pin !== confirmPin) return setError("The two entries do not match.");
    setBusy(true);
    try {
      const key = await storePin(pin);
      if (legacy > 0) await clearLegacyPlaintext();
      onUnlocked(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the PIN.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnter(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const key = await unlock(pin);
      if (!key) {
        setError("That PIN is not right.");
        setPin("");
        return;
      }
      if (legacy > 0) await clearLegacyPlaintext();
      onUnlocked(key);
    } catch {
      setError("Could not unlock this device.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    try {
      await resetVault();
      setConfirmingReset(false);
      setPin("");
      setConfirmPin("");
      setMode("set");
      setError(null);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "loading") {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-[#1E3A5F]/10 flex items-center justify-center">
              {mode === "set" ? (
                <ShieldCheck className="h-4.5 w-4.5 text-[#1E3A5F]" />
              ) : (
                <Lock className="h-4.5 w-4.5 text-[#1E3A5F]" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {mode === "set" ? "Set a PIN for this device" : "Unlock offline capture"}
              </h2>
              <p className="text-xs text-slate-500">
                {mode === "set"
                  ? "Leads held on this device are encrypted with it."
                  : "Enter the PIN you set on this device."}
              </p>
            </div>
          </div>

          {legacy > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900 leading-relaxed">
                {legacy} lead{legacy === 1 ? "" : "s"} on this device {legacy === 1 ? "was" : "were"}{" "}
                saved before encryption was added and cannot be carried over. {legacy === 1 ? "It" : "They"}{" "}
                will be discarded when you continue. Upload from an older device first if you still need{" "}
                {legacy === 1 ? "it" : "them"}.
              </p>
            </div>
          )}

          <form onSubmit={mode === "set" ? handleSet : handleEnter} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-700">
                PIN {mode === "set" && <span className="text-slate-400">(at least {MIN_PIN} digits)</span>}
              </Label>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
                autoFocus
                className="tracking-widest text-center font-mono"
              />
            </div>

            {mode === "set" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-700">Confirm PIN</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  className="tracking-widest text-center font-mono"
                />
              </div>
            )}

            {error && <p className="text-xs text-red-600">{error}</p>}

            {mode === "set" && (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                There is no way to recover this PIN. If you forget it, leads still waiting on this
                device cannot be read and will have to be discarded — so upload at the end of each
                day.
              </p>
            )}

            <Button
              type="submit"
              disabled={busy || pin.length < MIN_PIN}
              className="w-full gap-2 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "set" ? "Set PIN and continue" : "Unlock"}
            </Button>
          </form>

          {mode === "enter" && (
            <div className="pt-1 border-t border-slate-100">
              {!confirmingReset ? (
                <button
                  type="button"
                  onClick={() => setConfirmingReset(true)}
                  className="text-xs text-slate-500 hover:text-red-600 transition-colors"
                >
                  Forgotten your PIN?
                </button>
              ) : (
                <div className="space-y-2 pt-2">
                  <p className="text-xs text-red-700 leading-relaxed">
                    Resetting clears the PIN <strong>and every lead still held on this device</strong>.
                    They are encrypted with that PIN and cannot be read without it. This cannot be
                    undone.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="destructive" size="sm" onClick={handleReset} disabled={busy}>
                      Reset and erase held leads
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setConfirmingReset(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
