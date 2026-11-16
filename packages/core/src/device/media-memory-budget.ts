/**
 * One policy for how much RAM decoded media may occupy, split across the caches that hold it.
 *
 * Measured on the 4K soak (docs/soak-report.md, apps/web/e2e/soak/playback-4k-memory.spec.ts): four
 * ten-minute sources decoded to whole-file AudioBuffers (~230 MB each, never evicted) plus a 500 MB
 * frame cache plus the video decoders pushed the browser to 5.4 GB on a machine with 16 GB.
 *
 * The total scales with system RAM (about 12 %) and is clamped so a 4 GB machine still gets a
 * usable cache and a 64 GB workstation does not hoard. The split favours audio (whole-file buffers
 * are the largest single items) and decoded video frames.
 */
import { getMemoryGovernor } from "./memory-governor";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export interface MediaMemoryBudget {
  /** Upper bound for every decoded-media cache combined. */
  totalBytes: number;
  /** VideoEngine decoded frame cache (ImageBitmaps; scale with frame size, so 4K holds fewer frames). */
  videoFrameBytes: number;
  /** Decoded AudioBuffers kept for playback scheduling. */
  audioBufferBytes: number;
  /** Downscaled frames kept while scrubbing. */
  scrubFrameBytes: number;
  /** Decoded still images / motion assets. */
  imageBitmapBytes: number;
  /** Sparse low-res seek anchors (all media combined). Small next to the rest: anchors are 256 px wide. */
  seekAnchorBytes: number;
}

const MIN_TOTAL_BYTES = 384 * MB;
const MAX_TOTAL_BYTES = 2 * GB;
const TOTAL_RAM_FRACTION = 0.12;
const SEEK_ANCHOR_MAX_BYTES = 48 * MB;
/** What `navigator.deviceMemory` assumes when nothing is reported (it is also clamped to 8 by browsers). */
const DEFAULT_SYSTEM_MEMORY_BYTES = 4 * GB;

export function computeMediaMemoryBudget(systemMemoryBytes: number | null | undefined): MediaMemoryBudget {
  const ram = systemMemoryBytes && systemMemoryBytes > 0 ? systemMemoryBytes : DEFAULT_SYSTEM_MEMORY_BYTES;
  const totalBytes = Math.floor(Math.min(MAX_TOTAL_BYTES, Math.max(MIN_TOTAL_BYTES, ram * TOTAL_RAM_FRACTION)));
  return {
    totalBytes,
    audioBufferBytes: Math.floor(totalBytes * 0.35),
    videoFrameBytes: Math.floor(totalBytes * 0.35),
    scrubFrameBytes: Math.floor(totalBytes * 0.1),
    imageBitmapBytes: Math.floor(totalBytes * 0.15),
    seekAnchorBytes: Math.floor(Math.min(SEEK_ANCHOR_MAX_BYTES, totalBytes * 0.05)),
  };
}

/**
 * System RAM known synchronously: `navigator.deviceMemory` (GB, capped at 8 by browsers), or null.
 * The desktop shell reports the real figure through the hardware probe; see `getMediaMemoryBudget`.
 */
export function readDeviceMemoryBytes(): number | null {
  const gb = (globalThis as unknown as { navigator?: { deviceMemory?: number } }).navigator?.deviceMemory;
  return typeof gb === "number" && gb > 0 ? gb * GB : null;
}

/** The budget before the memory governor's pressure scale. */
let base: MediaMemoryBudget = computeMediaMemoryBudget(readDeviceMemoryBytes());
let pressureScale = 1;
let current: MediaMemoryBudget = base;
const listeners = new Set<(budget: MediaMemoryBudget) => void>();
let probeStarted = false;

/** Current budget. Starts from `navigator.deviceMemory`; on desktop it is refined by the hardware probe. */
export function getMediaMemoryBudget(): MediaMemoryBudget {
  if (!probeStarted) {
    probeStarted = true;
    void refineFromHardwareProbe();
  }
  return current;
}

export function subscribeMediaMemoryBudget(listener: (budget: MediaMemoryBudget) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every cache budget times the governor's pressure scale (1 when memory is fine). */
export function scaleMediaMemoryBudget(budget: MediaMemoryBudget, scale: number): MediaMemoryBudget {
  if (scale >= 1) return budget;
  return {
    totalBytes: Math.floor(budget.totalBytes * scale),
    videoFrameBytes: Math.floor(budget.videoFrameBytes * scale),
    audioBufferBytes: Math.floor(budget.audioBufferBytes * scale),
    scrubFrameBytes: Math.floor(budget.scrubFrameBytes * scale),
    imageBitmapBytes: Math.floor(budget.imageBitmapBytes * scale),
    seekAnchorBytes: Math.floor(budget.seekAnchorBytes * scale),
  };
}

function publish(): MediaMemoryBudget {
  current = scaleMediaMemoryBudget(base, pressureScale);
  for (const listener of listeners) listener(current);
  return current;
}

/** Replaces the budget (hardware probe result, tests) and tells the caches to resize. */
export function setMediaMemoryBudgetFromSystemMemory(systemMemoryBytes: number | null): MediaMemoryBudget {
  base = computeMediaMemoryBudget(systemMemoryBytes);
  getMemoryGovernor().setSystemMemory(systemMemoryBytes);
  return publish();
}

// Under memory pressure the governor shrinks every cache through the same listeners that resize them
// when the hardware probe lands, so no cache needs to know about the governor itself.
getMemoryGovernor().subscribe((policy) => {
  pressureScale = policy.cacheScale;
  publish();
});

async function refineFromHardwareProbe(): Promise<void> {
  const bridge = (globalThis as unknown as {
    openreel?: { platform?: string; probeHardware?: () => Promise<{ memory?: { totalBytes?: number } }> };
  }).openreel;
  if (bridge?.platform !== "desktop" || typeof bridge.probeHardware !== "function") return;
  try {
    const info = await bridge.probeHardware();
    const total = info.memory?.totalBytes;
    if (typeof total === "number" && total > 0) setMediaMemoryBudgetFromSystemMemory(total);
  } catch {
    // Keep the deviceMemory-based budget.
  }
}
