import { GLOBAL_TOUCH, type WireAction } from "./protocol";

/** The slice of a project the touch classifier reads (structural, so tests need no full Project). */
export interface TouchProject {
  readonly activeSequenceId?: string;
  readonly sequences?: ReadonlyArray<{ readonly id: string; readonly timeline: TouchTimeline }>;
  readonly timeline?: TouchTimeline;
  readonly mediaLibrary?: { readonly items: ReadonlyArray<{ readonly id: string; readonly binId?: string }> };
}
interface TouchTimeline {
  readonly tracks: ReadonlyArray<{ readonly id: string; readonly clips: ReadonlyArray<{ readonly id: string }> }>;
}

export interface Touches {
  readonly touches: string[];
  readonly locks: string[];
}

/** Action families whose edits live on the (active) sequence timeline and so honour a sequence soft lock. */
const TIMELINE_PREFIXES = ["clip/", "track/", "transition/", "keyframe/", "effect/", "transform/", "audio/", "speed/", "marker/", "text/", "shape/", "svg/", "sticker/", "subtitle/", "mask/", "multicam/", "nested/", "adjustment/", "particle/", "motion/"];

/** Actions that replace the project wholesale: they conflict with everything concurrent. */
const GLOBAL_TYPES = new Set(["project/applyEditSnapshot", "project/create"]);

const ENTITY_KEYS: Record<string, string> = {
  clipId: "clip",
  clipAId: "clip",
  clipBId: "clip",
  rightClipId: "clip",
  trackId: "track",
  targetTrackId: "track",
  mediaId: "media",
  effectId: "effect",
  keyframeId: "keyframe",
  transitionId: "transition",
  markerId: "marker",
  textId: "text",
  shapeId: "shape",
  svgId: "svg",
  stickerId: "sticker",
  subtitleId: "subtitle",
  compositionId: "motion",
  instanceId: "motion-instance",
  sequenceId: "sequence-edit",
  binId: "bin",
};

const LIST_KEYS: Record<string, string> = {
  clipIds: "clip",
  trackIds: "track",
  mediaIds: "media",
  removeItemIds: "media",
};

const MAP_KEYS: Record<string, string> = {
  itemPatches: "media",
  clipLabels: "clip",
};

const MAX_DEPTH = 5;

function clipTrackIndex(project: TouchProject): Map<string, string> {
  const index = new Map<string, string>();
  const visit = (timeline?: TouchTimeline) => {
    for (const track of timeline?.tracks ?? []) for (const clip of track.clips) index.set(clip.id, track.id);
  };
  visit(project.timeline);
  for (const sequence of project.sequences ?? []) visit(sequence.timeline);
  return index;
}

function collect(value: unknown, depth: number, out: Set<string>, binTargets: Set<string>): void {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, depth + 1, out, binTargets);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const entity = ENTITY_KEYS[key];
    if (entity && typeof child === "string") {
      out.add(`${entity}:${child}`);
      if (key === "binId") binTargets.add(child);
      continue;
    }
    const listEntity = LIST_KEYS[key];
    if (listEntity && Array.isArray(child)) {
      for (const id of child) if (typeof id === "string") out.add(`${listEntity}:${id}`);
      continue;
    }
    const mapEntity = MAP_KEYS[key];
    if (mapEntity && child && typeof child === "object" && !Array.isArray(child)) {
      for (const id of Object.keys(child as Record<string, unknown>)) out.add(`${mapEntity}:${id}`);
      if (key === "itemPatches") {
        for (const patch of Object.values(child as Record<string, unknown>)) {
          const target = (patch as { binId?: unknown } | null)?.binId;
          if (typeof target === "string") binTargets.add(target);
        }
      }
      continue;
    }
    if (key === "bins" && Array.isArray(child)) {
      out.add("bins:tree");
      continue;
    }
    if (key === "smartBins") {
      out.add("bins:smart");
      continue;
    }
    collect(child, depth + 1, out, binTargets);
  }
}

/**
 * Entity keys an action writes (conflict detection) and soft-lockable
 * resources it edits. Computed on the author's side against its own project,
 * because only the author can map a clip id to its track.
 *
 * Granularity is deliberate: any edit that names a clip also touches that
 * clip's track, so two people cannot concurrently add/move/trim on one track
 * (overlap and ripple outcomes depend on order), while edits on different
 * tracks, and independent properties of unrelated clips, proceed in parallel.
 */
export function computeTouches(actions: readonly WireAction[], project: TouchProject): Touches {
  const touches = new Set<string>();
  const locks = new Set<string>();
  const clipTrack = clipTrackIndex(project);
  const mediaBin = new Map((project.mediaLibrary?.items ?? []).map((m) => [m.id, m.binId]));
  for (const action of actions) {
    if (GLOBAL_TYPES.has(action.type)) {
      touches.add(GLOBAL_TOUCH);
      continue;
    }
    const keys = new Set<string>();
    const binTargets = new Set<string>();
    collect(action.params, 0, keys, binTargets);
    for (const key of keys) {
      touches.add(key);
      if (key.startsWith("clip:")) {
        const track = clipTrack.get(key.slice(5));
        if (track) touches.add(`track:${track}`);
      }
      if (key.startsWith("media:")) {
        const bin = mediaBin.get(key.slice(6));
        if (bin) binTargets.add(bin);
      }
    }
    for (const bin of binTargets) locks.add(`bin:${bin}`);
    if (action.type === "project/rename") touches.add("project:name");
    if (action.type === "project/updateSettings" || action.type === "project/setCanvasBackground") touches.add("project:settings");
    if (project.sequences?.length && project.activeSequenceId && TIMELINE_PREFIXES.some((p) => action.type.startsWith(p))) {
      locks.add(`sequence:${project.activeSequenceId}`);
    }
  }
  // A timeline-wide ripple or a tool edit names its targets in `edits`; scanning above catches them.
  return { touches: [...touches].sort(), locks: [...locks].sort() };
}

/** True when two ops write something in common (a global touch overlaps everything). */
export function touchesOverlap(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.includes(GLOBAL_TOUCH) || b.includes(GLOBAL_TOUCH)) return true;
  const set = new Set(a);
  return b.some((key) => set.has(key));
}

/** Actions that cannot cross the wire (they carry a File/handle) are not synced. */
export function toWireAction(action: { type: string; id: string; timestamp: number; params: Record<string, unknown> }): WireAction | null {
  if (action.type === "media/import") return null;
  try {
    const params = JSON.parse(JSON.stringify(action.params ?? {})) as Record<string, unknown>;
    return { type: action.type, id: action.id, timestamp: action.timestamp, params };
  } catch {
    return null;
  }
}
