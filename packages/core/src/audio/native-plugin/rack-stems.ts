/**
 * Resolves the processed stems of every track / bus that carries hosted plugins. Shared by the export mixdown (AudioEngine)
 * and the live preview, so both play the same cached buffers; the rendering itself is injected (the engine's offline mixdown
 * and the plugin render cache), which keeps this module free of Web Audio and unit-testable in node.
 *
 * A stem is cached by the exact fingerprint of everything that decides its dry signal plus the plugin chain's signature
 * (plugin, state chunk, values and baked automation lanes of every step): any edit that reaches the stem changes the key,
 * so a stale render is never served, and an unchanged rack is never re-rendered (export after preview, second export...).
 */
import type { Timeline } from "../../types/timeline";
import { computeBusAudibility } from "../audio-routing";
import {
  activePluginRackTargets,
  MASTER_RACK_NAME,
  MASTER_RACK_TARGET,
  buildBusStemProject,
  buildMasterStemProject,
  buildTrackStemProject,
  pluginRackSignature,
  pluginRackSteps,
  rackStemSeconds,
  trackStemSeconds,
  type PluginRackKind,
} from "./native-plugin-rack";

export const RACK_STEM_CACHE_ENTRIES = 3;

export interface RackStemResult {
  readonly kind: PluginRackKind;
  readonly id: string;
  /** The processed stem (timeline time 0 .. `seconds`); null when no plugin could run at all (the target plays dry). */
  readonly buffer: AudioBuffer | null;
  readonly seconds: number;
  /** Plugin effect ids that were bypassed, with the reason. */
  readonly bypassed: ReadonlyMap<string, string>;
  /** Every plugin of the rack was bypassed: the target keeps its clips / inputs as they are. */
  readonly allBypassed: boolean;
}

interface ProjectLike {
  readonly timeline: Timeline;
}

export interface RackStemDeps<P extends ProjectLike> {
  /** Renders the dry mixdown of a stem project over [0, seconds]. */
  renderStem(project: P, seconds: number): Promise<AudioBuffer>;
  /** Runs the plugin chain over the dry stem (the shared, cached plugin render). */
  runChain(buffer: AudioBuffer, steps: ReturnType<typeof pluginRackSteps>, label: string): Promise<{ buffer: AudioBuffer; bypassed: ReadonlyMap<string, string> }>;
  /** Exact fingerprint of the dry stem's inputs (the mixdown cache key of the stem project). */
  fingerprint(project: P, seconds: number): string;
  /** False when there is no plugin host at all (web build): every plugin is bypassed without rendering anything. */
  hasHost: boolean;
  /** Track audibility in the real project (mute / solo / solo-safe). */
  audibility: ReadonlyMap<string, boolean>;
  /** Preview render: rack plugins set to "hear dry" are skipped. */
  preview: boolean;
  /** The dry stem is rendered the way the preview renders (clip effects set to "hear dry" skipped); false shares the export's stems. Defaults to `preview`. */
  renderPreview?: boolean;
  /** 5.1 sequences are not hosted (the plugins would see six channels): they are bypassed. */
  surround?: boolean;
  /**
   * Counts the plugin bypasses (missing plugin / no host) found so far by the renderer, including those in the nested
   * resolutions a stem's dry render triggers. A stem whose dry signal was rendered while the count moved depends on the host's
   * availability right now, so (like a bypass itself) it is never cached.
   */
  bypassEvents?: () => number;
}

export class RackStemCache {
  private readonly entries = new Map<string, Promise<RackStemResult>>();
  constructor(private readonly max = RACK_STEM_CACHE_ENTRIES) {}
  get(key: string): Promise<RackStemResult> | undefined {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }
  set(key: string, value: Promise<RackStemResult>): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    value.catch(() => {
      if (this.entries.get(key) === value) this.entries.delete(key);
    });
  }
  delete(key: string): void {
    this.entries.delete(key);
  }
  has(key: string): boolean {
    return this.entries.has(key);
  }
  clear(): void {
    this.entries.clear();
  }
  get size(): number {
    return this.entries.size;
  }
}

let sharedStemCache: RackStemCache | null = null;
export const getSharedRackStemCache = (): RackStemCache => (sharedStemCache ??= new RackStemCache());

/** A human name for the target ("Track Drums" / "Bus Music"), shown in the background-task panel while its plugins render. */
const targetLabel = (timeline: Timeline, target: { kind: PluginRackKind; id: string }): string => {
  if (target.kind === "master") return MASTER_RACK_NAME;
  const name = target.kind === "track" ? timeline.tracks.find((t) => t.id === target.id)?.name : timeline.audioBuses?.find((b) => b.id === target.id)?.name;
  return `${target.kind === "track" ? "Track" : "Bus"} ${name?.trim() || target.id}`;
};

const bypassAll = (kind: PluginRackKind, id: string, seconds: number, steps: ReturnType<typeof pluginRackSteps>, reason: string): RackStemResult => ({
  kind,
  id,
  buffer: null,
  seconds,
  bypassed: new Map(steps.map((step) => [step.effectId, reason])),
  allBypassed: true,
});

/** Master first: when its stem plays, it already contains every track and bus (and their plugins), so those are not resolved again. */
const masterFirst = <T extends { kind: PluginRackKind }>(targets: T[]): T[] => [...targets.filter((t) => t.kind === "master"), ...targets.filter((t) => t.kind !== "master")];

/**
 * Renders (or fetches) the processed stem of every active rack target. Targets that are muted / silenced are skipped (they
 * make no sound whatever their plugins do). Rejects when a plugin fails while rendering, so an export fails loudly instead
 * of silently changing the audio.
 */
export async function resolveRackStems<P extends ProjectLike>(project: P, deps: RackStemDeps<P>, cache: RackStemCache = getSharedRackStemCache()): Promise<Map<string, RackStemResult>> {
  const timeline = project.timeline;
  const out = new Map<string, RackStemResult>();
  const targets = activePluginRackTargets(timeline);
  if (targets.length === 0) return out;
  const busSeconds = rackStemSeconds(timeline);
  const busAudible = computeBusAudibility(timeline.audioBuses ?? []);
  for (const target of masterFirst(targets)) {
    // The master stem is the whole mix: once it exists, nothing upstream is substituted again in this (outer) render.
    if (target.kind !== "master" && out.get(MASTER_RACK_TARGET)?.buffer) continue;
    // A track's stem only reaches as far as the track's own clips (plus the tail): edits elsewhere leave its window, and so its cached render, alone.
    const seconds = target.kind === "track" ? trackStemSeconds(timeline.tracks.find((t) => t.id === target.id) ?? { clips: [] }) : busSeconds;
    const steps = pluginRackSteps(target.rack, { preview: deps.preview });
    if (steps.length === 0) continue;
    const audible = target.kind === "track" ? deps.audibility.get(target.id) !== false : target.kind === "master" ? true : busAudible.get(target.id) !== false;
    if (!audible) continue;
    if (deps.surround) {
      out.set(target.id, bypassAll(target.kind, target.id, seconds, steps, "hosted plugins on tracks, buses and the master need a stereo or mono sequence"));
      continue;
    }
    if (!deps.hasHost) {
      out.set(target.id, bypassAll(target.kind, target.id, seconds, steps, "plugin hosting needs the OpenReel desktop app"));
      continue;
    }
    const stemProject = target.kind === "track" ? buildTrackStemProject(project, target.id, true) : target.kind === "master" ? buildMasterStemProject(project) : buildBusStemProject(project, target.id, deps.audibility);
    if (!stemProject) continue;
    const key = `${target.kind}:${target.id}|${deps.fingerprint(stemProject, seconds)}|${pluginRackSignature(steps)}|${(deps.renderPreview ?? deps.preview) ? "p" : "e"}`;
    let pending = cache.get(key);
    const bypassesBefore = deps.bypassEvents?.() ?? 0;
    if (!pending) {
      pending = (async (): Promise<RackStemResult> => {
        const dry = await deps.renderStem(stemProject, seconds);
        const processed = await deps.runChain(dry, steps, targetLabel(timeline, target));
        const allBypassed = steps.every((step) => processed.bypassed.has(step.effectId));
        return { kind: target.kind, id: target.id, buffer: allBypassed ? null : processed.buffer, seconds, bypassed: processed.bypassed, allBypassed };
      })();
      cache.set(key, pending);
    }
    const result = await pending;
    // A bypass is a statement about the host right now (a plugin installed or unblocked later should be picked up): never cached.
    if (result.bypassed.size > 0 || (deps.bypassEvents?.() ?? 0) !== bypassesBefore) cache.delete(key);
    out.set(target.id, result);
  }
  return out;
}

/** The ids whose processed stem replaces their signal (everything that has a buffer). */
export function stemmedTargets(results: ReadonlyMap<string, RackStemResult>): Set<string> {
  const ids = new Set<string>();
  for (const [id, result] of results) if (result.buffer && !result.allBypassed) ids.add(id);
  return ids;
}
