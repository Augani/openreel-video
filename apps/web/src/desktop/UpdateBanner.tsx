import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Button } from "@openreel/ui";

import type { OpenReelUpdaterStatus } from "../types/global";

// Notify → (consented) download → install. Subscribes to main-process update
// status and drives download/install through window.openreel.updater. The
// install path quits through the normal guarded flow, so unsaved changes are
// still protected.
export function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<OpenReelUpdaterStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const updater = window.openreel?.updater;
    if (!updater) return;
    return updater.onStatus((next) => {
      setStatus(next);
      if (next.state === "available" || next.state === "downloaded") {
        setDismissed(false);
      }
    });
  }, []);

  if (!status || dismissed) return null;

  const visible =
    status.state === "available" ||
    status.state === "downloading" ||
    status.state === "downloaded";
  if (!visible) return null;

  const card =
    "fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-bg-elev p-4 text-fg shadow-2xl";
  return (
    <div className={card} role="status" aria-live="polite">
      {status.state === "available" && (
        <>
          <span className="text-fg-2 font-bold block text-sm">
            Update {status.version} available
          </span>
          <span className="text-fg-2 font-normal block mt-1 text-xs">
            A new version of OpenReel is ready to download.
          </span>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void window.openreel?.updater.download()} type="button" aria-label="Download" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90">
              <span className="truncate">{"Download"}</span>
            </Button>
            <Button onClick={() => setDismissed(true)} type="button" aria-label="Later" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-transparent text-fg-2 hover:bg-bg-2 hover:text-fg">
              <span className="truncate">{"Later"}</span>
            </Button>
          </div>
        </>
      )}

      {status.state === "downloading" && (
        <>
          <span className="text-fg-2 font-bold block text-sm">
            Downloading update…
          </span>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${status.percent}%` }}
            />
          </div>
          <span className="text-fg-2 font-normal block mt-1 text-xs">
            {status.percent}%
          </span>
        </>
      )}

      {status.state === "downloaded" && (
        <>
          <span className="text-fg-2 font-bold block text-sm">
            Update {status.version} ready
          </span>
          <span className="text-fg-2 font-normal block mt-1 text-xs">
            Restart to install — you’ll be asked to save any unsaved changes
            first.
          </span>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void window.openreel?.updater.install()} type="button" aria-label="Restart & Install" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90">
              <span className="truncate">{"Restart & Install"}</span>
            </Button>
            <Button onClick={() => setDismissed(true)} type="button" aria-label="Later" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-transparent text-fg-2 hover:bg-bg-2 hover:text-fg">
              <span className="truncate">{"Later"}</span>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
