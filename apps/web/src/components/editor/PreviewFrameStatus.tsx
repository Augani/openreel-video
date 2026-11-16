import { useEffect, useState } from "react";
import { Button, Spinner } from "@openreel/ui";

export function PreviewFrameStatus({
  busy,
  failed,
  reason,
  onRetry,
}: {
  busy: boolean;
  failed: boolean;
  /** Why the frame cannot be shown, when known (for example a codec this browser cannot decode). */
  reason?: string | null;
  onRetry: () => void;
}) {
  const [showBusy, setShowBusy] = useState(false);
  useEffect(() => {
    if (!busy) {
      setShowBusy(false);
      return;
    }
    const timer = setTimeout(() => setShowBusy(true), 150);
    return () => clearTimeout(timer);
  }, [busy]);
  if (!failed && !(busy && showBusy)) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-bg-2 px-2.5 py-1.5 text-[11px] text-fg-2 shadow-sm ${failed && reason ? "w-max max-w-[min(92%,34rem)]" : "whitespace-nowrap"}`}
    >
      {failed ? (
        <>
          <span data-testid="preview-failure-reason">{reason ?? "Preview unavailable"}</span>
          <Button
            variant="ghost"
            aria-label="Retry preview"
            onClick={onRetry}
            className="h-6 px-1.5 text-[11px]"
          >
            Retry
          </Button>
        </>
      ) : (
        <>
          <Spinner aria-hidden className="size-3 text-fg-muted" />
          <span>Updating preview…</span>
        </>
      )}
    </div>
  );
}
