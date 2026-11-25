import type { WarpAnalysis } from "./types";

/**
 * Runtime state of Warp Stabilizer analyses, deliberately tiny and dependency free (the inspector and the
 * background task list read it on the main bundle; the analysis code loads on demand): the status of each
 * clip's job, a cache of finished analyses by footage key (so a duplicate, an undo or a re-enable reuses them),
 * and where each stabilized clip's footage can be decoded from (Synthesize Edges borrows neighbouring frames).
 */
export type WarpJobState =
  | { readonly status: "idle" }
  | { readonly status: "analysing"; readonly progress: number }
  | { readonly status: "stabilizing" }
  | { readonly status: "failed"; readonly message: string };

export const IDLE_WARP_JOB: WarpJobState = { status: "idle" };

type Listener = () => void;
const CACHE_LIMIT = 16;

export interface WarpFootage {
  readonly blob: Blob;
  readonly mediaId: string;
}

export type WarpFrameDecoder = (blob: Blob, time: number, width: number, height: number) => Promise<ImageBitmap | null>;

class WarpRegistry {
  private readonly jobs = new Map<string, WarpJobState>();
  private readonly cache = new Map<string, WarpAnalysis>();
  private readonly footage = new Map<string, WarpFootage>();
  private readonly listeners = new Set<Listener>();
  private version = 0;
  private decoder: WarpFrameDecoder | null = null;

  getJob(clipId: string): WarpJobState {
    return this.jobs.get(clipId) ?? IDLE_WARP_JOB;
  }

  setJob(clipId: string, state: WarpJobState): void {
    if (state.status === "idle") this.jobs.delete(clipId);
    else this.jobs.set(clipId, state);
    this.emit();
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getCached(key: string): WarpAnalysis | undefined {
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
    }
    return hit;
  }

  putCached(key: string, analysis: WarpAnalysis): void {
    this.cache.delete(key);
    this.cache.set(key, analysis);
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  setFootage(clipId: string, footage: WarpFootage | null): void {
    if (footage) this.footage.set(clipId, footage);
    else this.footage.delete(clipId);
  }

  getFootage(clipId: string): WarpFootage | undefined {
    return this.footage.get(clipId);
  }

  setFrameDecoder(decoder: WarpFrameDecoder | null): void {
    this.decoder = decoder;
  }

  getFrameDecoder(): WarpFrameDecoder | null {
    return this.decoder;
  }

  private emit(): void {
    this.version++;
    for (const listener of [...this.listeners]) listener();
  }
}

let shared: WarpRegistry | null = null;
export function getWarpRegistry(): WarpRegistry {
  return (shared ??= new WarpRegistry());
}
export type { WarpRegistry };

/** Cache key of an analysis: the footage and the range it covers (settings do not matter: they are derived later). */
export function warpAnalysisKey(mediaId: string, blobSize: number, startTime: number, endTime: number): string {
  return `${mediaId}|${blobSize}|${startTime.toFixed(3)}|${endTime.toFixed(3)}`;
}
