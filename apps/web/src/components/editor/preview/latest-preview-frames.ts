export interface PreviewFrameRequest {
  readonly signal: AbortSignal;
  /**
   * True for a scrub-drag request: the frame may be committed even though the
   * playhead has already moved on (it was allowed to finish instead of being
   * aborted), so slow seeks still present frames while the pointer is moving.
   */
  readonly allowStale: boolean;
  isCurrent(): boolean;
}

export interface PreviewFrameRequestOptions {
  /** Dragging the playhead: let an in-flight scrub render finish and present. */
  readonly scrubbing?: boolean;
}

type PreviewFrameRenderer = (
  time: number,
  request: PreviewFrameRequest,
) => Promise<boolean>;
export interface PreviewFrameState {
  readonly busy: boolean;
  readonly time: number | null;
  readonly error: string | null;
}

/** Serializes frame work while retaining the newest time AND renderer closure. */
export class LatestPreviewFrames {
  private version = 0;
  private active: AbortController | null = null;
  private running = false;
  private activeScrubbing = false;
  private pending: {
    time: number;
    version: number;
    render: PreviewFrameRenderer;
    scrubbing: boolean;
  } | null = null;
  private state: PreviewFrameState = { busy: false, time: null, error: null };
  private listeners = new Set<(state: PreviewFrameState) => void>();

  subscribe(listener: (state: PreviewFrameState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  request(
    time: number,
    render: PreviewFrameRenderer,
    options: PreviewFrameRequestOptions = {},
  ): void {
    if (!Number.isFinite(time)) return;
    const scrubbing = options.scrubbing === true;
    const version = ++this.version;
    // Seeking a long-GOP clip takes ~100 ms, far longer than a pointer-move
    // interval. Aborting each in-flight scrub seek would starve the preview
    // until the pointer paused, so a scrub render that is already running is
    // allowed to finish and present; only the newest request waits behind it.
    const keepInFlight = scrubbing && this.running && this.activeScrubbing;
    if (!keepInFlight) this.active?.abort();
    this.pending = { time, version, render, scrubbing };
    this.publish({ busy: true, time, error: null });
    void this.drain();
  }
  cancel(): void {
    ++this.version;
    this.pending = null;
    this.active?.abort();
    if (this.state.busy || this.state.error)
      this.publish({ ...this.state, busy: false, error: null });
  }
  private publish(state: PreviewFrameState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = null;
        const controller = new AbortController();
        this.active = controller;
        this.activeScrubbing = job.scrubbing;
        const request: PreviewFrameRequest = {
          signal: controller.signal,
          allowStale: job.scrubbing,
          isCurrent: () =>
            !controller.signal.aborted &&
            (job.scrubbing || job.version === this.version),
        };
        try {
          await job.render(job.time, request);
          if (request.isCurrent() && !this.pending)
            this.publish({ busy: false, time: job.time, error: null });
        } catch (error) {
          if (request.isCurrent())
            this.publish({
              busy: false,
              time: job.time,
              error:
                error instanceof Error
                  ? error.message
                  : "Could not update preview",
            });
        } finally {
          if (this.active === controller) this.active = null;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
