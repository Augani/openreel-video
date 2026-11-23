/**
 * The block loop every native plugin render follows, as pure functions: the editor's pipe driver (desktop main), the
 * Swift helper's offline CLI and the tests all implement exactly this, so their output is comparable sample for sample.
 *
 * Latency compensation: a plugin that reports L samples of latency emits the result of input sample i at output sample
 * i + L. The render therefore feeds N + L input frames (the last L are silence), and the N frames starting at output
 * frame L are the aligned result. The compensation is exact for any L, including L larger than a block.
 */
import type { NativePluginLane } from "./native-plugin-types";

export const NATIVE_PLUGIN_BLOCK_FRAMES = 512;
/** Upper bound for a plugin's reported latency (5 s at 48 kHz); anything above is treated as a broken plugin. */
export const NATIVE_PLUGIN_MAX_LATENCY_SECONDS = 5;

export interface NativeRenderPlan {
  /** Frames fed to the plugin: input plus latency flush. */
  readonly totalFrames: number;
  /** Leading output frames dropped (the plugin's latency). */
  readonly trimFrames: number;
  /** Frames kept (equals the input length). */
  readonly keepFrames: number;
  readonly blocks: number;
}

export function sanitizeLatencySamples(raw: unknown, sampleRate: number): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : 0;
  return Math.max(0, Math.min(value, Math.floor(NATIVE_PLUGIN_MAX_LATENCY_SECONDS * sampleRate)));
}

export function planNativeRender(inputFrames: number, latencySamples: number, block = NATIVE_PLUGIN_BLOCK_FRAMES): NativeRenderPlan {
  const n = Math.max(0, Math.floor(inputFrames));
  const latency = Math.max(0, Math.floor(latencySamples));
  const size = Math.max(1, Math.floor(block));
  const totalFrames = n + latency;
  return { totalFrames, trimFrames: latency, keepFrames: n, blocks: Math.ceil(totalFrames / size) };
}

/** Drops the latency from the head of the raw plugin output and returns the aligned `keepFrames`. */
export function compensateLatency(rawOutput: Float32Array, plan: NativeRenderPlan): Float32Array {
  return rawOutput.slice(plan.trimFrames, plan.trimFrames + plan.keepFrames);
}

/** Value of a lane at `time` (seconds): linear between breakpoints, held before the first and after the last. Undefined for an empty lane. */
export function evaluateLane(lane: NativePluginLane, time: number): number | undefined {
  const count = lane.length;
  if (count === 0) return undefined;
  if (time <= lane[0][0]) return lane[0][1];
  if (time >= lane[count - 1][0]) return lane[count - 1][1];
  let lo = 0;
  let hi = count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lane[mid][0] <= time) lo = mid;
    else hi = mid;
  }
  const a = lane[lo];
  const b = lane[hi];
  const span = b[0] - a[0];
  if (span <= 0) return b[1];
  return a[1] + (b[1] - a[1]) * ((time - a[0]) / span);
}

/**
 * The parameter values to apply before the block that starts at input frame `startFrame`: the base values, overridden by
 * every lane's value at that block's start time. Block-rate automation: the resolution is one block (512 frames = 10.7 ms at 48 kHz).
 */
export function blockParameterValues(
  base: Readonly<Record<string, number>>,
  lanes: Readonly<Record<string, NativePluginLane>>,
  startFrame: number,
  sampleRate: number,
): Record<string, number> {
  const out: Record<string, number> = { ...base };
  const time = startFrame / sampleRate;
  for (const key of Object.keys(lanes)) {
    const value = evaluateLane(lanes[key], time);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Same values, only for keys whose value differs from what the plugin already holds (keeps block messages small). */
export function changedParameterValues(next: Readonly<Record<string, number>>, previous: Record<string, number>): Record<string, number> {
  const changed: Record<string, number> = {};
  for (const key of Object.keys(next)) {
    if (previous[key] !== next[key]) {
      changed[key] = next[key];
      previous[key] = next[key];
    }
  }
  return changed;
}

/** Planar float32 bytes of one block: channel 0's frames, then channel 1's, and so on. Frames past the input are silence. */
export function packBlock(channels: readonly Float32Array[], start: number, frames: number): Float32Array {
  const out = new Float32Array(channels.length * frames);
  channels.forEach((channel, c) => {
    const end = Math.min(channel.length, start + frames);
    if (end > start) out.set(channel.subarray(start, end), c * frames);
  });
  return out;
}

export function unpackBlock(planar: Float32Array, channelCount: number, frames: number, into: readonly Float32Array[], start: number): void {
  for (let c = 0; c < channelCount; c += 1) into[c].set(planar.subarray(c * frames, (c + 1) * frames), start);
}
