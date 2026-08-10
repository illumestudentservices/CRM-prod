"use client";

import * as React from "react";
import { Camera, X, AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseBadge, describeBadge, hasUsableFields, type ScannedBadge } from "@/lib/badge-scan";

/**
 * Minimal shape of the BarcodeDetector API, which TypeScript does not ship
 * types for. Chrome and Android have it natively; Safari and Firefox do not,
 * which is why the component checks before offering the button rather than
 * failing when it is pressed.
 */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: {
      new (opts?: { formats?: string[] }): BarcodeDetectorLike;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

export function isScanningSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.BarcodeDetector !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export function BadgeScanner({
  open,
  onClose,
  onScanned,
}: {
  open: boolean;
  onClose: () => void;
  onScanned: (badge: ScannedBadge) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(true);
  const [result, setResult] = React.useState<ScannedBadge | null>(null);

  const stop = React.useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    // Releasing every track matters: a camera left running keeps the indicator
    // light on, which reads to the person opposite as still being filmed.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => {
    if (!open) {
      stop();
      setResult(null);
      setError(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setStarting(true);
      setError(null);
      try {
        if (!isScanningSupported()) {
          throw new Error(
            "This browser cannot scan badges. Chrome on Android supports it; iPhone does not yet."
          );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const detector = new window.BarcodeDetector!({
          formats: ["qr_code", "data_matrix", "pdf417", "code_128", "aztec"],
        });

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            if (found.length > 0 && found[0].rawValue) {
              const badge = parseBadge(found[0].rawValue);
              setResult(badge);
              stop();
              return;
            }
          } catch {
            // A frame that cannot be decoded is the normal case, not an error.
          }
          rafRef.current = requestAnimationFrame(() => void tick());
        };
        rafRef.current = requestAnimationFrame(() => void tick());
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error && err.name === "NotAllowedError"
              ? "Camera access was refused. Allow it in your browser settings to scan badges."
              : err instanceof Error
                ? err.message
                : "Could not start the camera."
          );
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, stop]);

  function apply() {
    if (result) onScanned(result);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scan a badge</DialogTitle>
        </DialogHeader>

        {error ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">{error}</p>
          </div>
        ) : result ? (
          <div className="space-y-3">
            <div
              className={
                hasUsableFields(result)
                  ? "rounded-lg border border-green-200 bg-green-50 dark:border-green-500/30 dark:bg-green-500/10 px-3 py-2.5"
                  : "rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 px-3 py-2.5"
              }
            >
              <div className="flex items-start gap-2.5">
                {hasUsableFields(result) ? (
                  <Check className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-900 dark:text-slate-100">
                    {hasUsableFields(result) ? "Read from the badge" : "Nothing usable on this badge"}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 break-words">{describeBadge(result)}</p>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Only the fields above will be filled in, and you can change any of them. Badges vary
              between organisers, so check what was read before saving.
            </p>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setResult(null)}>
                Scan again
              </Button>
              <Button
                size="sm"
                onClick={apply}
                disabled={!hasUsableFields(result)}
                className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90"
              >
                Use these details
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative rounded-lg overflow-hidden bg-slate-900 aspect-[4/3]">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {starting && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-white/70" />
                </div>
              )}
              <div className="absolute inset-8 border-2 border-white/50 rounded-lg pointer-events-none" />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
              Hold the badge inside the frame.
            </p>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5">
            <X className="h-3.5 w-3.5" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { Camera };
