"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const IDLE_MS = 120 * 60 * 1000;      // 120 minutes
const WARN_BEFORE_MS = 10 * 60 * 1000; // warn at 110 minutes
const ACTIVITY_EVENTS = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"] as const;

export function IdleTimeoutProvider({ children }: { children: React.ReactNode }) {
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(WARN_BEFORE_MS / 1000);
  const warnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const logoutTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const resetTimers = useCallback(() => {
    setShowWarning(false);
    setCountdown(WARN_BEFORE_MS / 1000);

    clearTimeout(warnTimer.current);
    clearTimeout(logoutTimer.current);
    clearInterval(countdownTimer.current);

    warnTimer.current = setTimeout(() => {
      setShowWarning(true);
      let remaining = WARN_BEFORE_MS / 1000;
      countdownTimer.current = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) clearInterval(countdownTimer.current);
      }, 1000);
    }, IDLE_MS - WARN_BEFORE_MS);

    logoutTimer.current = setTimeout(() => {
      signOut({ callbackUrl: "/login?reason=idle" });
    }, IDLE_MS);
  }, []);

  useEffect(() => {
    resetTimers();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, resetTimers, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetTimers));
      clearTimeout(warnTimer.current);
      clearTimeout(logoutTimer.current);
      clearInterval(countdownTimer.current);
    };
  }, [resetTimers]);

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const timeStr = minutes > 0
    ? `${minutes}m ${String(seconds).padStart(2, "0")}s`
    : `${seconds}s`;

  return (
    <>
      {children}
      <Dialog open={showWarning} onOpenChange={(open) => { if (!open) resetTimers(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Session Expiring Soon</DialogTitle>
            <DialogDescription>
              You&apos;ve been inactive for a while. Your session will automatically sign you out in{" "}
              <span className="font-semibold text-foreground">{timeStr}</span>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => signOut({ callbackUrl: "/login" })}>
              Sign Out
            </Button>
            <Button onClick={resetTimers}>Stay Signed In</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
