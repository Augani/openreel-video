import { powerSaveBlocker, type WebContents } from "electron";

interface Hold {
  wc: WebContents;
  detach: () => void;
}

const holds = new Map<string, Hold>();
let blockerId: number | null = null;

function applyThrottling(wc: WebContents, allowed: boolean): void {
  try {
    if (!wc.isDestroyed()) wc.setBackgroundThrottling(allowed);
  } catch {
    /* webContents already torn down */
  }
}

/**
 * Keeps the app from being suspended or throttled while a job runs. Holds are
 * reference counted per job id: the blocker starts on the first hold and stops
 * on the last release. Safe to call twice for the same id.
 *
 * The hold is also dropped when the renderer that owns the job goes away: it is
 * destroyed, crashes, or starts a cross-document main-frame navigation (a
 * reload). `onLost` then runs so the caller can cancel the job.
 */
export function acquirePowerHold(jobId: string, wc: WebContents, onLost?: () => void): void {
  if (holds.has(jobId)) return;
  if (blockerId === null) {
    blockerId = powerSaveBlocker.start("prevent-app-suspension");
  }
  applyThrottling(wc, false);
  const release = () => {
    releasePowerHold(jobId);
    onLost?.();
  };
  const onNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (details.isMainFrame && !details.isSameDocument) release();
  };
  wc.once("destroyed", release);
  wc.once("render-process-gone", release);
  wc.on("did-start-navigation", onNavigate);
  holds.set(jobId, {
    wc,
    detach: () => {
      wc.removeListener("destroyed", release);
      wc.removeListener("render-process-gone", release);
      wc.removeListener("did-start-navigation", onNavigate);
    },
  });
}

export function releasePowerHold(jobId: string): void {
  const hold = holds.get(jobId);
  if (!hold) return;
  holds.delete(jobId);
  hold.detach();
  const stillHeld = [...holds.values()].some((h) => h.wc === hold.wc);
  if (!stillHeld) applyThrottling(hold.wc, true);
  if (holds.size === 0 && blockerId !== null) {
    try {
      powerSaveBlocker.stop(blockerId);
    } catch {
      /* already stopped */
    }
    blockerId = null;
  }
}

export function releaseAllPowerHolds(): void {
  for (const jobId of [...holds.keys()]) releasePowerHold(jobId);
}
