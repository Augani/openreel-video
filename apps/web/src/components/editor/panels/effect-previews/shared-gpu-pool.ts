/**
 * The effect-preview pipeline's GPU budget.
 *
 * Every Effects / Transitions / Color / Motion panel mount used to build its own engines (a WebGL2 context each) and
 * drop them on unmount; a context lives until its canvas is garbage collected, so a few panel switches stacked up past
 * Chrome's ~16 live WebGL contexts and the browser force-lost the oldest ones, which could be the Program monitor's.
 *
 * Now ONE set of preview resources (at most MAX_PREVIEW_LANES lanes, each with one reusable offscreen renderer per kind)
 * is shared by every preview engine. Panels lease it; the last release disposes it after a short idle grace period
 * (so switching tabs reuses it), and disposal explicitly releases every GL context. Cards only ever receive 2D
 * ImageBitmaps, drawn into their own 2D canvases.
 */

/** Concurrent renders the shared set serves. More slots than this queue behind the same lanes. */
export const MAX_PREVIEW_LANES = 2;
/** How long the shared set outlives its last lease, so panel switches reuse it. */
export const PREVIEW_GPU_IDLE_MS = 3000;

export interface PoolResource {
  dispose(): void;
}

export interface PoolLease<R extends PoolResource> {
  readonly resources: R;
  release(): void;
}

export interface PoolStats {
  /** Leases currently held. */
  leases: number;
  /** True while the shared resources exist. */
  live: boolean;
  /** How many times the shared resources were built / disposed since the page loaded. */
  builds: number;
  disposals: number;
}

export class SharedResourcePool<R extends PoolResource> {
  private resources: R | null = null;
  private leases = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private builds = 0;
  private disposals = 0;

  constructor(
    private readonly build: () => R,
    private readonly idleMs: number = PREVIEW_GPU_IDLE_MS,
  ) {}

  acquire(): PoolLease<R> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const pool = this;
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.ensure();
    this.leases++;
    let released = false;
    return {
      // Looked up on every use: after reset() (device loss) a holder transparently gets the rebuilt set.
      get resources(): R {
        return pool.ensure();
      },
      release: () => {
        if (released) return;
        released = true;
        this.leases--;
        if (this.leases === 0) this.scheduleDispose();
      },
    };
  }

  private ensure(): R {
    if (!this.resources) {
      this.resources = this.build();
      this.builds++;
    }
    return this.resources;
  }

  /**
   * Drops the shared resources (every GL context released) while leases stay valid: the next use builds a fresh set.
   * Used after a GPU device / context loss, when the engines inside may be holding dead contexts.
   */
  reset(): void {
    this.disposeNow();
  }

  private scheduleDispose(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    if (this.idleMs <= 0) {
      this.disposeNow();
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.leases === 0) this.disposeNow();
    }, this.idleMs);
  }

  /** Disposes the shared resources immediately (also used when the page is torn down). Live leases rebuild on next use. */
  disposeNow(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const resources = this.resources;
    this.resources = null;
    if (resources) {
      this.disposals++;
      resources.dispose();
    }
  }

  /** The live resources, if any (diagnostics). */
  peek(): R | null {
    return this.resources;
  }

  stats(): PoolStats {
    return { leases: this.leases, live: this.resources !== null, builds: this.builds, disposals: this.disposals };
  }
}

/**
 * A bounded set of lanes. A lane is created on first use and owns the (non-shareable between two renders in flight)
 * engines of one render at a time: `run` serialises work per lane, so two preview engines leasing the same set never
 * touch one lane's reusable canvases concurrently.
 */
export class LaneSet<L> implements PoolResource {
  private readonly lanes: Array<Promise<L>> = [];
  private readonly tails: Array<Promise<unknown>> = [];
  private disposed = false;
  private created = 0;

  constructor(
    private readonly createLane: (index: number) => Promise<L>,
    private readonly disposeLane: (lane: L) => void,
    readonly maxLanes: number = MAX_PREVIEW_LANES,
    private readonly onDispose?: () => void,
  ) {}

  laneIndex(slot: number): number {
    const n = Number.isFinite(slot) ? Math.trunc(slot) : 0;
    return ((n % this.maxLanes) + this.maxLanes) % this.maxLanes;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Lanes built so far (never more than maxLanes). */
  get laneCount(): number {
    return this.created;
  }

  run<T>(slot: number, work: (lane: L, index: number) => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("renderer disposed"));
    const index = this.laneIndex(slot);
    const previous = this.tails[index] ?? Promise.resolve();
    const result = previous.then(async () => {
      if (this.disposed) throw new Error("renderer disposed");
      if (!this.lanes[index]) {
        this.created++;
        const building = this.createLane(index);
        this.lanes[index] = building;
        // A lane that failed to build is forgotten (and its slot freed), so the next render retries instead of re-throwing forever.
        building.catch(() => {
          if (this.lanes[index] === building) {
            delete this.lanes[index];
            this.created--;
          }
        });
      }
      const lane = await this.lanes[index];
      if (this.disposed) throw new Error("renderer disposed");
      return work(lane, index);
    });
    this.tails[index] = result.catch(() => undefined);
    return result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.lanes) {
      if (!pending) continue;
      void pending.then((lane) => this.disposeLane(lane), () => undefined);
    }
    this.lanes.length = 0;
    this.onDispose?.();
  }
}
