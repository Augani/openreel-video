import { drawStabilized, type DrawLayer } from "./render-canvas";
import { neighbourIndices } from "./render-cpu";
import { buildPlan, frameAt, hasUncoveredEdge, type WarpPlan } from "./plan";
import { getWarpRegistry } from "./registry";
import { isWarpAnalysis, normalizeWarpSettings, type WarpAnalysis, type WarpSettings } from "./types";

/**
 * The seam the program monitor and the export both call: given a clip with a finished Warp Stabilizer analysis
 * and the frame decoded for a source time, return the stabilized frame. Everything else (Result, Method,
 * Framing, Rolling Shutter, the crop budget) is derived here from the clip's settings and cached analysis.
 */
export interface WarpClipLike {
  readonly id: string;
  readonly stabilization?: {
    readonly enabled: boolean;
    readonly warp?: Partial<WarpSettings>;
    readonly warpAnalysis?: WarpAnalysis;
  };
}

export function clipHasWarp(clip: WarpClipLike | undefined): boolean {
  const s = clip?.stabilization;
  return Boolean(s?.enabled && s.warpAnalysis && isWarpAnalysis(s.warpAnalysis));
}

const plans = new WeakMap<WarpAnalysis, Map<string, WarpPlan>>();

/** The plan for a clip's analysis and settings, built once per combination. */
export function warpPlanFor(clip: WarpClipLike): WarpPlan | null {
  const s = clip.stabilization;
  if (!s?.enabled || !s.warpAnalysis || !isWarpAnalysis(s.warpAnalysis)) return null;
  const settings = normalizeWarpSettings(s.warp);
  const key = JSON.stringify(settings);
  let byKey = plans.get(s.warpAnalysis);
  if (!byKey) {
    byKey = new Map();
    plans.set(s.warpAnalysis, byKey);
  }
  let plan = byKey.get(key);
  if (!plan) {
    plan = buildPlan(s.warpAnalysis, settings);
    if (byKey.size >= 8) byKey.delete(byKey.keys().next().value as string);
    byKey.set(key, plan);
  }
  return plan;
}

const NEIGHBOUR_LIMIT = 9;
const neighbours = new Map<string, Promise<ImageBitmap | null>>();

function neighbourFrame(clipId: string, plan: WarpPlan, index: number, width: number, height: number): Promise<ImageBitmap | null> {
  const key = `${clipId}:${index}:${width}x${height}`;
  const cached = neighbours.get(key);
  if (cached) {
    neighbours.delete(key);
    neighbours.set(key, cached);
    return cached;
  }
  const registry = getWarpRegistry();
  const footage = registry.getFootage(clipId);
  const decode = registry.getFrameDecoder();
  const pending: Promise<ImageBitmap | null> =
    footage && decode ? decode(footage.blob, plan.startTime + index / plan.fps, width, height).catch(() => null) : Promise.resolve(null);
  neighbours.set(key, pending);
  while (neighbours.size > NEIGHBOUR_LIMIT) {
    const oldest = neighbours.keys().next().value as string;
    neighbours.delete(oldest);
  }
  return pending;
}

/** Frames cached for a clip are stale once its footage or settings change. */
export function dropWarpNeighbours(clipId?: string): void {
  for (const key of [...neighbours.keys()]) if (!clipId || key.startsWith(`${clipId}:`)) neighbours.delete(key);
}

export async function applyWarpStabilizer(frame: ImageBitmap, clip: WarpClipLike, sourceTime: number): Promise<ImageBitmap> {
  const plan = warpPlanFor(clip);
  if (!plan || typeof OffscreenCanvas === "undefined") return frame;
  const shown = frameAt(plan, sourceTime);
  if (shown === null) return frame;
  const { width, height } = frame;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return frame;
  const layers: DrawLayer[] = [];
  if (plan.settings.framing === "synthesizeEdges" && hasUncoveredEdge(plan, shown)) {
    const wanted = neighbourIndices(plan, shown).sort((a, b) => Math.abs(b - shown) - Math.abs(a - shown));
    const loaded = await Promise.all(wanted.map((index) => neighbourFrame(clip.id, plan, index, width, height)));
    wanted.forEach((index, i) => {
      const source = loaded[i];
      if (source && source.width === width && source.height === height) layers.push({ source, captured: index });
    });
  }
  layers.push({ source: frame, captured: shown });
  drawStabilized(ctx, layers, plan, shown, width, height);
  return canvas.transferToImageBitmap();
}
