/**
 * Reference frames for the Program monitor comparison view.
 *
 * Everything here is preview-only: references are snapshots of the Program
 * canvas held in memory (never in the project), and the "ungraded" frame is
 * produced by briefly rendering the paused frame with effects/grading
 * bypassed while the comparison overlay holds the previous picture still.
 */
import { getPreviewCanvas } from "../components/editor/scopes/preview-canvas-registry";
import {
  getProgramFrameControl,
  setColorBypass,
} from "../components/editor/preview/program-frame-control";
import {
  useColorMonitorStore,
  type StillEntry,
} from "../stores/color-monitor-store";
import { useTimelineStore } from "../stores/timeline-store";
import { getEffectsBridge } from "../bridges/effects-bridge";

const stillBitmaps = new Map<string, ImageBitmap>();
let liveReference: ImageBitmap | null = null;
let captureChain: Promise<unknown> = Promise.resolve();

const THUMB_WIDTH = 96;

/** The image the comparison view should show as the reference, if any. */
export function getReferenceImage(): ImageBitmap | null {
  const { comparison } = useColorMonitorStore.getState();
  if (comparison.reference === "still") {
    return comparison.stillId ? (stillBitmaps.get(comparison.stillId) ?? null) : null;
  }
  return liveReference;
}

function setLiveReference(next: ImageBitmap | null): void {
  liveReference?.close();
  liveReference = next;
  useColorMonitorStore.getState().bumpReference();
}

async function snapshotProgramCanvas(): Promise<ImageBitmap | null> {
  const canvas = getPreviewCanvas();
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
  return createImageBitmap(canvas);
}

/** Serialises captures: each one re-renders the shared Program canvas. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = captureChain.then(task, task);
  captureChain = run.catch(() => undefined);
  return run;
}

function isPlaying(): boolean {
  return useTimelineStore.getState().playbackState === "playing";
}

/** Render `time`, snapshot the canvas, then put the playhead frame back. */
async function captureAt(
  time: number,
  options: { bypass: boolean; whiteBalanceInputClip?: string },
): Promise<ImageBitmap | null> {
  const control = getProgramFrameControl();
  const playhead = useTimelineStore.getState().playheadPosition;
  const moved = Math.abs(time - playhead) > 1e-6;
  const store = useColorMonitorStore.getState();
  const rerender = moved || options.bypass || options.whiteBalanceInputClip !== undefined;
  if (!control && rerender) return null;
  if (rerender && isPlaying()) return null;

  store.setCaptureBusy(true);
  try {
    if (options.bypass) setColorBypass(true);
    if (options.whiteBalanceInputClip !== undefined) {
      getEffectsBridge().setWhiteBalanceInputView(options.whiteBalanceInputClip);
    }
    if (control && rerender) {
      await control.renderAt(time, { scrubbing: moved });
    }
    return await snapshotProgramCanvas();
  } finally {
    if (options.bypass) setColorBypass(false);
    if (options.whiteBalanceInputClip !== undefined) getEffectsBridge().setWhiteBalanceInputView(null);
    if (control && rerender) {
      // The user may have scrubbed while the reference rendered: put back the
      // CURRENT playhead frame, not the one captured when the job started.
      await control.renderAt(useTimelineStore.getState().playheadPosition, { scrubbing: false });
    }
    useColorMonitorStore.getState().setCaptureBusy(false);
  }
}

/**
 * One-off snapshot of the Program canvas at `time` (default the playhead), with
 * colour bypassed for an "ungraded" frame. Serialised with the other captures;
 * resolves null while playing or when no Program monitor is mounted.
 */
export function captureProgramFrame(
  options: { time?: number; bypass?: boolean } = {},
): Promise<ImageBitmap | null> {
  return enqueue(() =>
    captureAt(options.time ?? useTimelineStore.getState().playheadPosition, {
      bypass: options.bypass ?? false,
    }),
  );
}

/**
 * The Program frame at the playhead with `clipId` rendered as its white balance
 * stage sees it (only the input LUT on a version 2 clip; the full grade minus
 * white balance on version 1). Composition, transforms and the other layers are
 * rendered as usual. Preview-only; resolves null while playing.
 */
export function captureWhiteBalanceInputFrame(clipId: string): Promise<ImageBitmap | null> {
  return enqueue(() =>
    captureAt(useTimelineStore.getState().playheadPosition, { bypass: false, whiteBalanceInputClip: clipId }),
  );
}

function makeThumb(bitmap: ImageBitmap): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_WIDTH;
    canvas.height = Math.max(1, Math.round((bitmap.height / bitmap.width) * THUMB_WIDTH));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return "";
  }
}

/**
 * Grab the graded Program frame (at `time`, default the playhead) as a still
 * and make it the comparison reference.
 */
export function grabStill(options: { time?: number; label?: string } = {}): Promise<StillEntry | null> {
  return enqueue(async () => {
    const playhead = useTimelineStore.getState().playheadPosition;
    const time = options.time ?? playhead;
    const bitmap = await captureAt(time, { bypass: false });
    if (!bitmap) return null;
    const store = useColorMonitorStore.getState();
    const id = `still-${crypto.randomUUID()}`;
    const entry: StillEntry = {
      id,
      label: options.label ?? `Still ${store.stills.length + 1}`,
      time,
      width: bitmap.width,
      height: bitmap.height,
      thumb: makeThumb(bitmap),
    };
    stillBitmaps.set(id, bitmap);
    store.addStill(entry);
    // Drop bitmaps of stills the store no longer lists.
    const keep = new Set(useColorMonitorStore.getState().stills.map((still) => still.id));
    for (const [stillId, image] of stillBitmaps) {
      if (!keep.has(stillId)) {
        image.close();
        stillBitmaps.delete(stillId);
      }
    }
    useColorMonitorStore.getState().bumpReference();
    return entry;
  });
}

export function removeStill(id: string): void {
  stillBitmaps.get(id)?.close();
  stillBitmaps.delete(id);
  useColorMonitorStore.getState().removeStill(id);
}

/**
 * Refresh the live reference for the "ungraded" and "playhead position"
 * references. Stills never need refreshing.
 */
export function refreshReference(): Promise<void> {
  return enqueue(async () => {
    const { comparison } = useColorMonitorStore.getState();
    if (comparison.mode === "off") {
      // Comparison closed: do not keep a full frame alive for nothing.
      if (liveReference) setLiveReference(null);
      return;
    }
    if (comparison.reference === "still") return;
    const playhead = useTimelineStore.getState().playheadPosition;
    const bypass = comparison.reference === "bypass";
    const refTime = bypass ? playhead : (comparison.refTime ?? playhead);
    const bitmap = await captureAt(refTime, { bypass });
    if (!bitmap) return;
    // A capture that finished after the reference / mode / pinned time changed
    // would show the wrong frame under the new label: drop it.
    const now = useColorMonitorStore.getState().comparison;
    if (now.mode === "off" || now.reference !== comparison.reference || now.refTime !== comparison.refTime) {
      bitmap.close();
      return;
    }
    setLiveReference(bitmap);
  });
}

/** Pin the "playhead position" reference to the current playhead. */
export function pinReferenceToPlayhead(): void {
  useColorMonitorStore.getState().setComparison({
    reference: "playhead",
    refTime: useTimelineStore.getState().playheadPosition,
  });
}
