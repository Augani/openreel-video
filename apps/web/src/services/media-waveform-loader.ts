import type { MediaItem, Project } from "@openreel/core";

export const hasMediaWaveform = (item: MediaItem): boolean => {
  const peaks = item.waveformData;
  return (
    (peaks instanceof Float32Array || Array.isArray(peaks)) && peaks.length > 0
  );
};

const hasAudio = (item: MediaItem) =>
  item.type === "audio" ||
  (item.type === "video" &&
    (item.metadata.hasAudio ||
      item.metadata.channels > 0 ||
      (item.metadata.audioTrackCount ?? 0) > 0));

type Job = {
  projectId: string;
  item: MediaItem & { blob: Blob };
  controller: AbortController;
};
interface WaveformLoaderOptions {
  generate: (
    item: MediaItem & { blob: Blob },
    signal: AbortSignal,
  ) => Promise<Float32Array | null>;
  publish: (
    projectId: string,
    item: MediaItem & { blob: Blob },
    peaks: Float32Array,
  ) => void;
}

/** Rebuild runtime peaks without delaying project recovery or changing edit history. */
export class MediaWaveformLoader {
  private projectId = "";
  private items = new Map<string, MediaItem>();
  private queued: Job[] = [];
  private active = new Map<string, Job>();
  private failed = new Map<string, Blob>();
  private disposed = false;
  private ready = false;
  private includeVideo = true;
  constructor(private readonly options: WaveformLoaderOptions) {}

  update(project: Project, ready: boolean, includeVideo: boolean): void {
    if (this.disposed) return;
    if (this.projectId !== project.id || !ready) this.failed.clear();
    this.projectId = project.id;
    this.items = new Map(
      project.mediaLibrary.items.map((item) => [item.id, item]),
    );
    for (const [id, blob] of this.failed) {
      if (this.items.get(id)?.blob !== blob) this.failed.delete(id);
    }
    this.ready = ready;
    this.includeVideo = includeVideo;
    for (const job of this.active.values()) {
      if (!this.current(job)) job.controller.abort();
    }
    this.queued = project.mediaLibrary.items.flatMap((item) => {
      const running = this.active.get(item.id);
      if (
        !this.eligible(item) ||
        this.failed.get(item.id) === item.blob ||
        (running &&
          running.projectId === project.id &&
          running.item.blob === item.blob &&
          !running.controller.signal.aborted)
      )
        return [];
      return [
        { projectId: project.id, item, controller: new AbortController() },
      ];
    });
    this.pump();
  }

  private eligible(item: MediaItem): item is MediaItem & { blob: Blob } {
    return (
      this.ready &&
      !item.isPlaceholder &&
      !item.isPending &&
      item.blob instanceof Blob &&
      hasAudio(item) &&
      (item.type !== "video" || this.includeVideo) &&
      !hasMediaWaveform(item)
    );
  }
  private current(job: Job): boolean {
    const item = this.items.get(job.item.id);
    return (
      !this.disposed &&
      !job.controller.signal.aborted &&
      job.projectId === this.projectId &&
      !!item &&
      item.blob === job.item.blob &&
      this.eligible(item)
    );
  }
  private pump(): void {
    if (this.disposed || !this.ready) return;
    while (this.active.size < 2) {
      const index = this.queued.findIndex(
        (job) => !this.active.has(job.item.id),
      );
      if (index < 0) return;
      const [job] = this.queued.splice(index, 1);
      if (!this.current(job) || this.failed.get(job.item.id) === job.item.blob)
        continue;
      this.active.set(job.item.id, job);
      void this.run(job);
    }
  }
  private async run(job: Job): Promise<void> {
    try {
      const peaks = await this.options.generate(
        job.item,
        job.controller.signal,
      );
      if (!this.current(job)) return;
      if (peaks?.length && peaks.every(Number.isFinite)) {
        this.options.publish(job.projectId, job.item, peaks);
      } else this.failed.set(job.item.id, job.item.blob);
    } catch {
      if (this.current(job)) this.failed.set(job.item.id, job.item.blob);
    } finally {
      if (this.active.get(job.item.id) === job) this.active.delete(job.item.id);
      this.pump();
    }
  }
  dispose(): void {
    this.disposed = true;
    this.queued = [];
    this.failed.clear();
    for (const job of this.active.values()) job.controller.abort();
  }
}
