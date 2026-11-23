import { create } from "zustand";
import {
  activePluginRackTargets,
  applyRackStemsToTimeline,
  audioRangeFingerprint,
  getAudioEngine,
  pluginRackSignature,
  pluginRackSteps,
  rackStemSeconds,
  trackStemSeconds,
  buildMasterStemProject,
  buildTrackStemProject,
  MASTER_RACK_TARGET,
  rackStemTrackId,
  stemmedTargets,
  type AudioClipSchedule,
  type Project,
  type RackStemResult,
  type Timeline,
} from "@openreel/core";
import { syncLiveInserts } from "./live-plugin-insert-state";

/**
 * Live preview of hosted plugins on tracks, buses and the master. The processed stems are the SAME buffers the export mixes (one cache
 * in core, keyed by the exact inputs), so what plays is what exports:
 *
 *  - an edit that changes a stem's dry signal or its plugin chain drops the ready stem at once (a stale render never plays)
 *    and renders the new one in the background; until it is ready the track / bus plays dry;
 *  - when it is ready the processed stem is scheduled as one long source on its track (or, for a bus, on a synthetic track
 *    that feeds the bus after everything that used to feed it was parked on a muted sink), and the preview re-schedules;
 *  - plugins that are missing, blocked or have no host are bypassed and reported in the state.
 */

export interface PluginRackPreviewState {
  readonly status: "idle" | "rendering" | "ready" | "failed";
  readonly error?: string;
  /** Targets (track / bus ids, or the master's reserved id) whose processed stem is playing. */
  readonly stemmed: readonly string[];
  /** Bypassed plugin effect ids per target, with the reason. */
  readonly bypassed: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const IDLE: PluginRackPreviewState = { status: "idle", stemmed: [], bypassed: {} };
export const usePluginRackPreviewState = create<PluginRackPreviewState>(() => IDLE);

const EVALUATE_DEBOUNCE_MS = 200;

const invalidate = (): void => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("openreel:preview-invalidate", { detail: { audioOnly: true } }));
};

class PluginRackPreview {
  private results = new Map<string, RackStemResult>();
  private cheapKey = "";
  private fullKey = "";
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latest: Project | null = null;
  private readonly bypass = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private memo: { tracks: unknown; buses: unknown; stemmed: string; timeline: Timeline } | null = null;
  /** Targets that currently play LIVE: their processed stem keeps rendering in the background (it is what the export reuses) but is not substituted. */
  private liveTargets: ReadonlySet<string> = new Set();
  /** While every active target plays live and the transport runs, the background render waits (it would compete with the helpers for CPU). */
  private renderDeferred = false;
  private deferredPending = false;

  /** Rack plugin effects set to "hear dry" (preview only, never saved). */
  setPreviewBypass(effectId: string, bypassed: boolean): void {
    if (bypassed === this.bypass.has(effectId)) return;
    if (bypassed) this.bypass.add(effectId);
    else this.bypass.delete(effectId);
    if (this.latest) this.update(this.latest, true);
  }

  isPreviewBypassed(effectId: string): boolean {
    return this.bypass.has(effectId);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The project with the "hear dry" flags applied to rack plugins (what the preview renders). */
  private effective(project: Project): Project {
    if (this.bypass.size === 0) return project;
    const flag = <T extends { pluginRack?: { plugins: Array<{ id: string; metadata?: Record<string, unknown> }> } }>(owner: T): T =>
      owner.pluginRack && owner.pluginRack.plugins.some((plugin) => this.bypass.has(plugin.id))
        ? ({ ...owner, pluginRack: { ...owner.pluginRack, plugins: owner.pluginRack.plugins.map((plugin) => (this.bypass.has(plugin.id) ? { ...plugin, metadata: { ...plugin.metadata, previewBypass: true } } : plugin)) } } as T)
        : owner;
    const timeline = project.timeline;
    const master = timeline.masterPluginRack ? flag({ pluginRack: timeline.masterPluginRack }).pluginRack : undefined;
    return { ...project, timeline: { ...timeline, tracks: timeline.tracks.map(flag), ...(timeline.audioBuses ? { audioBuses: timeline.audioBuses.map(flag) } : {}), ...(master ? { masterPluginRack: master } : {}) } as Timeline } as Project;
  }

  /** Cheap, synchronous part of a project change: the plugin chains themselves. */
  update(project: Project, force = false): void {
    if (!force && project === this.latest) return;
    this.latest = project;
    const effective = this.effective(project);
    syncLiveInserts(effective);
    const targets = activePluginRackTargets(effective.timeline);
    if (targets.length === 0) {
      this.cheapKey = "";
      this.fullKey = "";
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (this.results.size > 0 || usePluginRackPreviewState.getState() !== IDLE) {
        this.generation += 1;
        this.results = new Map();
        usePluginRackPreviewState.setState(IDLE, true);
        this.notify(true);
      }
      return;
    }
    const cheap = JSON.stringify(targets.map((target) => [target.id, pluginRackSignature(pluginRackSteps(target.rack, { preview: true }))]));
    if (cheap !== this.cheapKey) {
      this.cheapKey = cheap;
      this.drop();
      usePluginRackPreviewState.setState({ status: "rendering", stemmed: [], bypassed: {} }, true);
    }
    // The expensive part (does anything that reaches a stem's dry signal differ?) waits for the edits to settle.
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.evaluate();
    }, EVALUATE_DEBOUNCE_MS);
  }

  private drop(): void {
    this.generation += 1;
    this.fullKey = "";
    if (this.results.size > 0) {
      this.results = new Map();
      this.notify(true);
    }
  }

  /**
   * What reaches the stems' dry signal. A track stem depends only on its own track, so an edit elsewhere leaves it (and the
   * stems already playing) alone; any bus makes the key global because a bus sums whatever feeds it. Mute / solo decide
   * which targets are audible, so they are always part of the key.
   */
  private dryKey(effective: Project, targets: ReturnType<typeof activePluginRackTargets>): string {
    const timeline = effective.timeline;
    const audibility = JSON.stringify(timeline.tracks.map((t) => [t.id, t.muted, t.solo, t.soloSafe]));
    // The master stem is the whole mix: any audio edit reaches it.
    if (targets.some((target) => target.kind === "master")) return `${audibility}|${audioRangeFingerprint(buildMasterStemProject(effective), 0, rackStemSeconds(timeline))}`;
    if (targets.some((target) => target.kind === "bus")) return `${audibility}|${audioRangeFingerprint(effective, 0, rackStemSeconds(timeline))}`;
    const parts = targets.map((target) => {
      const track = timeline.tracks.find((t) => t.id === target.id);
      const stemProject = track ? buildTrackStemProject(effective, target.id, true) : undefined;
      return stemProject && track ? `${target.id}:${audioRangeFingerprint(stemProject, 0, trackStemSeconds(track))}` : target.id;
    });
    return `${audibility}|${parts.join(",")}`;
  }

  /** The targets whose preview is the live insert right now; their cached stems are not played. Triggers a re-schedule when it changes. */
  setLiveTargets(ids: ReadonlySet<string>): void {
    const same = ids.size === this.liveTargets.size && [...ids].every((id) => this.liveTargets.has(id));
    if (same) return;
    this.liveTargets = ids;
    this.memo = null;
    this.notify(true);
  }

  /** Playback is running with every rack live: hold the background render until it stops (then catch up, so the export cache stays warm). */
  setRenderDeferred(deferred: boolean): void {
    if (deferred === this.renderDeferred) return;
    this.renderDeferred = deferred;
    if (!deferred && this.deferredPending) {
      this.deferredPending = false;
      void this.evaluate();
    }
  }

  /** Results that actually replace the live signal: everything that is not playing live. */
  private get audible(): Map<string, RackStemResult> {
    if (this.liveTargets.size === 0) return this.results;
    return new Map([...this.results].filter(([id]) => !this.liveTargets.has(id)));
  }

  private async evaluate(): Promise<void> {
    if (this.renderDeferred) {
      this.deferredPending = true;
      return;
    }
    const project = this.latest;
    if (!project) return;
    const effective = this.effective(project);
    const targets = activePluginRackTargets(effective.timeline);
    if (targets.length === 0) return;
    const key = `${this.cheapKey}|${this.dryKey(effective, targets)}`;
    if (key === this.fullKey) return;
    if (this.fullKey !== "" || this.results.size > 0) this.drop();
    this.fullKey = key;
    const generation = this.generation;
    usePluginRackPreviewState.setState({ status: "rendering", stemmed: [], bypassed: {} }, true);
    try {
      const engine = getAudioEngine();
      if (!engine.isInitialized()) await engine.initialize();
      const results = await engine.resolvePluginRackStems(effective, { preview: true });
      if (generation !== this.generation) return;
      this.results = new Map([...results].filter(([, result]) => result.buffer && !result.allBypassed));
      const bypassed: Record<string, Record<string, string>> = {};
      for (const [id, result] of results) if (result.bypassed.size > 0) bypassed[id] = Object.fromEntries(result.bypassed);
      usePluginRackPreviewState.setState({ status: "ready", stemmed: [...stemmedTargets(results)], bypassed }, true);
      this.notify(true);
    } catch (error) {
      if (generation !== this.generation) return;
      this.fullKey = "";
      usePluginRackPreviewState.setState({ status: "failed", error: error instanceof Error ? error.message : String(error), stemmed: [], bypassed: {} }, true);
    }
  }

  private notify(reschedule: boolean): void {
    for (const listener of [...this.listeners]) listener();
    if (reschedule) invalidate();
  }

  /** Tracks whose clips are replaced by their processed stem while it plays (every track, while the master's stem plays). */
  stemmedTrackIds(project: Project): Set<string> {
    const ids = new Set<string>();
    const audible = this.audible;
    if (audible.has(MASTER_RACK_TARGET)) {
      for (const track of project.timeline.tracks) ids.add(track.id);
      return ids;
    }
    for (const id of audible.keys()) if (project.timeline.tracks.some((track) => track.id === id)) ids.add(id);
    return ids;
  }

  /** The graph's timeline: stemmed buses parked behind their synthetic stem track (identity-stable between edits). */
  timelineFor(timeline: Timeline): Timeline {
    const audible = this.audible;
    if (audible.size === 0) return timeline;
    const stemmed = [...audible.keys()].sort().join(",");
    if (this.memo && this.memo.tracks === timeline.tracks && this.memo.buses === timeline.audioBuses && this.memo.stemmed === stemmed) return this.memo.timeline;
    const next = applyRackStemsToTimeline(timeline, new Set(audible.keys()));
    this.memo = { tracks: timeline.tracks, buses: timeline.audioBuses, stemmed, timeline: next };
    return next;
  }

  /** The processed stems as schedules: one long source per target, covering the whole timeline. */
  schedulesAt(project: Project, time: number): AudioClipSchedule[] {
    const out: AudioClipSchedule[] = [];
    const audible = this.audible;
    const master = audible.get(MASTER_RACK_TARGET);
    for (const [id, result] of master ? new Map([[MASTER_RACK_TARGET, master]]) : audible) {
      if (!result.buffer || time >= result.seconds) continue;
      const isTrack = project.timeline.tracks.some((track) => track.id === id);
      out.push({
        clipId: `rack-stem:${id}`,
        trackId: isTrack ? id : rackStemTrackId(id),
        audioBuffer: result.buffer,
        startTime: 0,
        endTime: result.seconds,
        mediaOffset: 0,
        volume: 1,
        volumeAutomation: [],
        pan: 0,
        effects: [],
        speed: 1,
      });
    }
    return out;
  }

  reset(): void {
    this.generation += 1;
    this.results = new Map();
    this.cheapKey = "";
    this.fullKey = "";
    this.memo = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    usePluginRackPreviewState.setState(IDLE, true);
  }
}

let shared: PluginRackPreview | null = null;
export const getPluginRackPreview = (): PluginRackPreview => (shared ??= new PluginRackPreview());
export type { PluginRackPreview };
