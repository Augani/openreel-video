import {
  AudioEngine,
  createTimelineClipCapabilityResolver,
  getCompoundClipId,
  getTrackTransitionAudioFades,
  resolveClipAudioEffects,
  resolveClipVolumeAutomation,
  type AudioClipSchedule,
  type Clip,
  type Project,
  type Track,
} from "@openreel/core";
import { sameProjectForPlayback } from "../components/editor/preview/playback-project";

export interface CompoundAudioOwner {
  project: Project;
  actionExecutor: unknown;
  hasOpenProject: boolean;
}
type Renderer = Pick<AudioEngine, "initialize" | "renderAudio" | "dispose">;
interface AudioWindow {
  key: string;
  schedule: AudioClipSchedule;
  bytes: number;
  used: number;
}
export function requiresComposedAudio(
  clip: Pick<Clip, "mediaId" | "metadata" | "speed" | "reversed">,
): boolean {
  return (
    !!getCompoundClipId(clip) ||
    clip.reversed === true ||
    (clip.speed ?? 1) !== 1
  );
}
const blobIds = new WeakMap<Blob, number>();
let nextBlobId = 0;
function sourceId(blob: Blob | null) {
  if (!blob) return 0;
  let id = blobIds.get(blob);
  if (!id) {
    id = ++nextBlobId;
    blobIds.set(blob, id);
  }
  return id;
}

/** Audio data only: names, visual effects, thumbnails and waveforms cannot invalidate a mix. */
export function compoundAudioSignature(project: Project): string {
  const media = new Map(
    project.mediaLibrary.items.map((item) => [item.id, item]),
  );
  const definitions = new Map(
    (project.compoundClips ?? []).map((item) => [item.id, item]),
  );
  const describe = (
    clip: Clip,
    tracks: readonly Track[],
    ancestors: Set<string>,
  ): unknown => {
    const id = getCompoundClipId(clip),
      item = media.get(clip.mediaId);
    let content: unknown = [
      sourceId(item?.blob ?? null),
      item?.metadata.hasAudio,
      item?.metadata.channels,
      item?.metadata.sampleRate,
    ];
    if (id) {
      const definition = definitions.get(id);
      content =
        !definition || ancestors.has(id) || ancestors.size >= 32
          ? ["missing-or-cycle", id]
          : [
              id,
              definition.content.duration,
              definition.content.tracks.map((track) => [
                track.id,
                track.hidden,
                track.muted,
                track.solo,
                track.clips.map((child) =>
                  describe(
                    child,
                    definition.content.tracks,
                    new Set(ancestors).add(id),
                  ),
                ),
              ]),
            ];
    }
    const timeline = { tracks: tracks as Track[] };
    const track = tracks.find((track) => track.id === clip.trackId);
    return [
      clip.id,
      clip.mediaId,
      clip.startTime,
      clip.duration,
      clip.inPoint,
      clip.outPoint,
      clip.speed ?? 1,
      clip.reversed ?? false,
      clip.audioTrackIndex ?? 0,
      clip.volume,
      clip.fade,
      resolveClipVolumeAutomation(clip, timeline),
      resolveClipAudioEffects(clip, timeline).filter(
        (effect) => effect.metadata?.previewBypass !== true,
      ),
      track ? getTrackTransitionAudioFades(track, clip.id) : null,
      content,
    ];
  };
  return JSON.stringify([
    project.id,
    project.settings.sampleRate,
    project.settings.channels,
    project.timeline.tracks.map((track) => [
      track.id,
      track.clips
        .filter((clip) => requiresComposedAudio(clip))
        .map((clip) => describe(clip, project.timeline.tracks, new Set())),
    ]),
  ]);
}

/** Demand-render short canonical audio windows; retain only useful windows and owned work. */
export class CompoundAudioPreview {
  private renderer: Renderer | null = null;
  private initialized: Promise<void> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  private retired = new Set<Promise<void>>();
  private projectId: string | null = null;
  private executor: unknown;
  private signature = "";
  private format = "";
  private signatures = new WeakMap<Project, string>();
  private audibleRoots = new WeakMap<
    Project,
    Array<{ clip: Clip; track: Track }>
  >();
  private windows = new Map<string, AudioWindow>();
  private pending = new Map<string, Promise<void>>();
  private failures = new Map<string, number>();
  private wanted = new Set<string>();
  private disposed = false;
  private clock = 0;
  constructor(
    private readonly owner: () => CompoundAudioOwner,
    private readonly createRenderer: (
      settings: Project["settings"],
    ) => Renderer = (settings) =>
      new AudioEngine({
        sampleRate: settings.sampleRate,
        channels: settings.channels,
      }),
    private readonly windowSeconds = 4,
    private readonly lookAheadSeconds = 2,
    private readonly maxCacheBytes = 64 * 1024 * 1024,
  ) {}

  private audioSignature(project: Project) {
    let signature = this.signatures.get(project);
    if (!signature) {
      signature = compoundAudioSignature(project);
      this.signatures.set(project, signature);
    }
    return signature;
  }
  private synchronize(project: Project): boolean {
    const owner = this.owner();
    // The preview passes its playback-stable project (same identity while only waveforms/thumbnails change).
    if (this.disposed || !owner.hasOpenProject || !sameProjectForPlayback(owner.project, project))
      return false;
    const signature = this.audioSignature(project);
    const format = `${project.settings.sampleRate}:${project.settings.channels}`;
    const changedOwner =
      this.projectId !== project.id ||
      this.executor !== owner.actionExecutor ||
      this.format !== format;
    if (changedOwner || signature !== this.signature) {
      this.generation++;
      this.windows.clear();
      this.pending.clear();
      this.failures.clear();
      this.wanted.clear();
      if (changedOwner && this.renderer) {
        const previous = this.renderer,
          completed = this.tail,
          initialized = this.initialized;
        const retired = completed
          .catch(() => {})
          .then(() => initialized?.catch(() => {}))
          .then(() => previous.dispose())
          .catch(() => {});
        this.retired.add(retired);
        void retired.finally(() => this.retired.delete(retired));
        this.renderer = null;
        this.initialized = null;
        this.tail = Promise.resolve();
      }
      this.projectId = project.id;
      this.executor = owner.actionExecutor;
      this.signature = signature;
      this.format = format;
    }
    return true;
  }
  private owned(generation: number): boolean {
    const owner = this.owner();
    return (
      !this.disposed &&
      this.generation === generation &&
      owner.hasOpenProject &&
      owner.project.id === this.projectId &&
      owner.actionExecutor === this.executor &&
      this.audioSignature(owner.project) === this.signature
    );
  }
  private candidates(project: Project, time: number) {
    let roots = this.audibleRoots.get(project);
    if (!roots) {
      const resolve = createTimelineClipCapabilityResolver(
        project.mediaLibrary,
        project.compoundClips,
      );
      const solo = project.timeline.tracks.some(
        (track) =>
          !track.hidden &&
          track.solo &&
          track.clips.some((clip) => resolve(clip).audio),
      );
      roots = project.timeline.tracks
        .filter(
          (track) => !track.hidden && !track.muted && (!solo || track.solo),
        )
        .flatMap((track) =>
          track.clips
            .filter(
              (clip) =>
                requiresComposedAudio(clip) &&
                resolve(clip).audio &&
                clip.duration > 0,
            )
            .map((clip) => ({ clip, track })),
        );
      this.audibleRoots.set(project, roots);
    }
    return roots.filter(
      ({ clip }) =>
        clip.startTime + clip.duration > time &&
        clip.startTime <= time + this.lookAheadSeconds,
    );
  }
  private key(clip: Clip, start: number) {
    return `${this.generation}:${clip.id}:${start}`;
  }
  private prune() {
    let bytes = [...this.windows.values()].reduce(
      (total, item) => total + item.bytes,
      0,
    );
    const evictable = [...this.windows.values()]
      .filter((item) => !this.wanted.has(item.key))
      .sort((a, b) => a.used - b.used);
    for (const item of evictable) {
      if (bytes <= this.maxCacheBytes) break;
      this.windows.delete(item.key);
      bytes -= item.bytes;
    }
  }
  private request(
    project: Project,
    clip: Clip,
    track: Track,
    start: number,
  ): Promise<void> {
    const key = this.key(clip, start),
      generation = this.generation;
    if (this.windows.has(key) || (this.failures.get(key) ?? 0) > Date.now())
      return Promise.resolve();
    const existing = this.pending.get(key);
    if (existing) return existing;
    const duration = Math.min(
      this.windowSeconds,
      clip.startTime + clip.duration - start,
    );
    const job = this.tail
      .catch(() => {})
      .then(async () => {
        if (!this.owned(generation)) return;
        this.renderer ??= this.createRenderer(project.settings);
        const renderer = this.renderer;
        this.initialized ??= renderer.initialize().catch(async (error) => {
          await renderer.dispose().catch(() => {});
          if (this.renderer === renderer) {
            this.renderer = null;
            this.initialized = null;
          }
          throw error;
        });
        await this.initialized;
        if (!this.owned(generation)) return;
        const compiledClip: Clip = {
          ...clip,
          audioEffects: resolveClipAudioEffects(clip, project.timeline),
          automation: {
            ...clip.automation,
            volume: resolveClipVolumeAutomation(clip, project.timeline),
          },
        };
        // The live graph applies this track's rack and the master rack to the
        // scheduled buffer, so the offline pre-mix must not bake them in too.
        // Likewise its output assignment, sends and volume/pan automation lanes
        // (the buses and lanes are applied by the live graph; baking them in squares them).
        const { audioRack: _trackRack, pluginRack: _trackPlugins, output: _output, sends: _sends, automation: _trackAutomation, ...trackWithoutRack } = track;
        void _trackRack;
        void _trackPlugins;
        void _output;
        void _sends;
        void _trackAutomation;
        const { masterAudioRack: _masterRack, masterPluginRack: _masterPlugins, audioBuses: _buses, ...timelineWithoutMaster } = project.timeline;
        void _masterRack;
        void _masterPlugins;
        void _buses;
        const renderProject: Project = {
          ...project,
          timeline: {
            ...timelineWithoutMaster,
            tracks: [
              {
                ...trackWithoutRack,
                clips: [compiledClip],
                hidden: false,
                muted: false,
                solo: false,
              },
            ],
          },
        };
        const audio = await renderer.renderAudio(
          renderProject,
          start,
          duration,
          { preview: true },
        );
        if (!this.owned(generation)) return;
        const schedule: AudioClipSchedule = {
          clipId: `compound-audio:${clip.id}:${start}`,
          trackId: track.id,
          audioBuffer: audio.buffer,
          startTime: start,
          endTime: start + duration,
          mediaOffset: 0,
          volume: 1,
          volumeAutomation: [],
          pan: 0,
          effects: [],
          speed: 1,
        };
        this.windows.set(key, {
          key,
          schedule,
          bytes: audio.buffer.length * audio.buffer.numberOfChannels * 4,
          used: ++this.clock,
        });
        this.prune();
      })
      .catch((error) => {
        if (this.owned(generation)) {
          this.failures.set(key, Date.now() + 2000);
          console.warn("[Compound audio] Preview window failed", error);
        }
      })
      .finally(() => {
        if (this.pending.get(key) === job) this.pending.delete(key);
      });
    this.tail = job;
    this.pending.set(key, job);
    return job;
  }
  async prepareAt(project: Project, time: number): Promise<void> {
    if (!this.synchronize(project) || !Number.isFinite(time)) return;
    const current: Promise<void>[] = [];
    const future: Array<() => Promise<void>> = [];
    this.wanted.clear();
    for (const { clip, track } of this.candidates(project, time)) {
      const first =
        clip.startTime +
        Math.max(0, Math.floor((time - clip.startTime) / this.windowSeconds)) *
          this.windowSeconds;
      for (
        let start = first;
        start < clip.startTime + clip.duration &&
        start <= time + this.lookAheadSeconds;
        start += this.windowSeconds
      ) {
        this.wanted.add(this.key(clip, start));
        const request = () => this.request(project, clip, track, start);
        if (start <= time) current.push(request());
        else future.push(request);
      }
    }
    for (const request of future) void request();
    this.prune();
    await Promise.all(current);
  }
  schedulesAt(project: Project, time: number): AudioClipSchedule[] {
    if (!this.synchronize(project)) return [];
    void this.prepareAt(project, time);
    const result: AudioClipSchedule[] = [];
    for (const item of this.windows.values()) {
      if (
        item.schedule.endTime > time &&
        item.schedule.startTime <= time + this.lookAheadSeconds &&
        this.wanted.has(item.key)
      ) {
        item.used = ++this.clock;
        result.push(item.schedule);
      }
    }
    return result;
  }
  stats() {
    return {
      windows: this.windows.size,
      pending: this.pending.size,
      bytes: [...this.windows.values()].reduce((n, item) => n + item.bytes, 0),
    };
  }
  async dispose() {
    this.disposed = true;
    this.generation++;
    this.windows.clear();
    this.wanted.clear();
    this.failures.clear();
    const renderer = this.renderer;
    await this.tail.catch(() => {});
    await this.initialized?.catch(() => {});
    await renderer?.dispose();
    await Promise.all(this.retired);
    this.renderer = null;
    this.pending.clear();
  }
}
