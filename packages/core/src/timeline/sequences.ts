/**
 * Multi-sequence projects (Premiere-style sequences and nests).
 *
 * DESIGN (the contract every consumer relies on)
 * ----------------------------------------------
 * 1. `project.timeline` and `project.settings` ARE the active sequence. The
 *    whole editor (actions, preview, export, render cache, loudness, agent,
 *    portable documents) keeps reading them exactly as before: no consumer
 *    needed restructuring. Activating a sequence swaps them (`activateSequence`).
 * 2. `project.sequences` lists every sequence. The stored entry of the ACTIVE
 *    sequence may be stale (edits land on `project.timeline`); call
 *    `syncActiveSequence` before reading stored sequences (the serializer, edit
 *    snapshots and `getSequence` do).
 * 3. A nest is an ordinary timeline clip whose `mediaId` is
 *    `compound:<sequenceId>` (the existing compound-clip convention, so the
 *    render, audio, capability and render-cache code resolving compounds keeps
 *    working). `project.compoundClips` is a DERIVED projection of every
 *    non-active sequence (`withNestProjection`); sequences are the single source
 *    of truth. Editing inside a nested sequence therefore changes every
 *    instance in every parent, for render and audio alike.
 * 4. Pre-sequence projects migrate (`ensureSequences`): the timeline becomes
 *    one sequence and every legacy compound clip becomes a sequence that keeps
 *    its id, so existing nest clips keep resolving and become openable.
 * 5. A sequence can never nest itself directly or indirectly
 *    (`wouldCreateSequenceCycle`); every authoring entry point checks it.
 *
 * Every function here is pure: it returns a new Project (or the same object
 * when nothing changed) and never touches the history. The caller commits the
 * result as ONE undo step through `project/applyEditSnapshot`.
 */
import type { Clip, Subtitle, Timeline, Track, Transform } from "../types/timeline";
import type { Project, ProjectSettings, Sequence } from "../types/project";
import type {
  CompoundClip,
  CompoundClipInstance,
} from "./nested-sequence-engine";
import { getCompoundClipId } from "./timeline-items";
import { findLinkedPartners } from "../editing/split-edit";
import { splitAt } from "../editing/premiere-edits";
import { graphicInstanceOfClip, expectedMemberIds } from "../graphic-templates/instances";
import { resolveTimelinePlacement } from "./timeline-placement";

export type SequenceEditResult =
  | { readonly ok: true; readonly project: Project; readonly sequenceId?: string; readonly clipId?: string }
  | { readonly ok: false; readonly message: string };

export const MAIN_SEQUENCE_ID = "seq_main";
const NEST_COLORS = ["#8b5cf6", "#ec4899", "#f97316", "#22c55e", "#06b6d4", "#3b82f6", "#eab308", "#ef4444"];
const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

const fail = (message: string): SequenceEditResult => ({ ok: false, message });

export function isNestClip(clip: Pick<Clip, "mediaId" | "metadata">): boolean {
  return getCompoundClipId(clip) !== null;
}

/** End of the last clip, in seconds. */
export function sequenceContentDuration(timeline: Pick<Timeline, "tracks">): number {
  let end = 0;
  for (const track of timeline.tracks) for (const clip of track.clips) end = Math.max(end, clip.startTime + clip.duration);
  return end;
}

function emptyTimeline(): Timeline {
  const track = (type: Track["type"], name: string, role: NonNullable<Track["role"]>): Track => ({
    id: newId("track"), type, name, role, mode: "standard", clips: [], transitions: [],
    locked: false, hidden: false, muted: false, solo: false,
  });
  return {
    tracks: [track("video", "Video 1", "general"), track("audio", "Audio 1", "dialogue")],
    subtitles: [], duration: 0, markers: [],
  };
}

// ---------------------------------------------------------------------------
// Active-sequence mirror and nest projection
// ---------------------------------------------------------------------------

/** Write the live timeline/settings back into the stored active entry. */
export function syncActiveSequence(project: Project): Project {
  const { sequences, activeSequenceId } = project;
  if (!sequences || !activeSequenceId) return project;
  const index = sequences.findIndex((sequence) => sequence.id === activeSequenceId);
  if (index < 0) return project;
  const current = sequences[index];
  if (current.timeline === project.timeline && current.settings === project.settings) return project;
  const next = sequences.slice();
  next[index] = { ...current, timeline: project.timeline, settings: project.settings };
  return { ...project, sequences: next };
}

export function getSequence(project: Project, sequenceId: string): Sequence | undefined {
  return syncActiveSequence(project).sequences?.find((sequence) => sequence.id === sequenceId);
}

export function listSequences(project: Project): readonly Sequence[] {
  return syncActiveSequence(project).sequences ?? [];
}

const projectionCache = new WeakMap<Timeline, { name: string; color: string; compound: CompoundClip }>();

function nestColor(sequence: Sequence, index: number): string {
  return sequence.color ?? NEST_COLORS[index % NEST_COLORS.length];
}

function toCompound(sequence: Sequence, index: number): CompoundClip {
  const color = nestColor(sequence, index);
  const cached = projectionCache.get(sequence.timeline);
  if (cached && cached.name === sequence.name && cached.color === color && cached.compound.settings === sequence.settings) return cached.compound;
  const tracks = sequence.timeline.tracks;
  const compound: CompoundClip = {
    id: sequence.id,
    name: sequence.name,
    content: {
      clips: tracks.flatMap((track) => track.clips),
      tracks,
      duration: sequenceContentDuration(sequence.timeline),
      ...(sequence.timeline.subtitles?.length ? { subtitles: sequence.timeline.subtitles } : {}),
      ...(sequence.timeline.audioBuses?.length ? { audioBuses: sequence.timeline.audioBuses } : {}),
    },
    createdAt: sequence.createdAt,
    modifiedAt: sequence.modifiedAt,
    color,
    settings: sequence.settings,
  };
  projectionCache.set(sequence.timeline, { name: sequence.name, color, compound });
  return compound;
}

/** Recompute `compoundClips` from the non-active sequences (see header, point 3). */
export function withNestProjection(project: Project): Project {
  const { sequences, activeSequenceId } = project;
  if (!sequences) return project;
  const ids = new Set(sequences.map((sequence) => sequence.id));
  const next: CompoundClip[] = [];
  sequences.forEach((sequence, index) => {
    if (sequence.id !== activeSequenceId) next.push(toCompound(sequence, index));
  });
  for (const legacy of project.compoundClips ?? []) {
    if (!ids.has(legacy.id)) next.push(legacy);
  }
  const previous = project.compoundClips ?? [];
  if (previous.length === next.length && previous.every((item, i) => item === next[i])) return project;
  return { ...project, compoundClips: next };
}

// ---------------------------------------------------------------------------
// Migration (ordered: 1 create the main sequence, 2 lift legacy compounds,
// 3 repair active/open ids, 4 project nests). Idempotent.
// ---------------------------------------------------------------------------

function isSequence(value: unknown): value is Sequence {
  const candidate = value as Partial<Sequence> | null;
  return !!candidate && typeof candidate.id === "string" && typeof candidate.name === "string" &&
    !!candidate.timeline && Array.isArray(candidate.timeline.tracks) && !!candidate.settings;
}

export function ensureSequences(project: Project): Project {
  const now = project.modifiedAt ?? 0;
  const stored = Array.isArray(project.sequences) ? project.sequences.filter(isSequence) : [];
  const seen = new Set<string>();
  let sequences: Sequence[] = stored.filter((sequence) => (seen.has(sequence.id) ? false : (seen.add(sequence.id), true)));
  let changed = sequences.length !== (project.sequences?.length ?? 0) || project.sequences === undefined;

  // 1. The project's own timeline becomes the main sequence.
  let activeId = project.activeSequenceId && seen.has(project.activeSequenceId) ? project.activeSequenceId : undefined;
  if (sequences.length === 0) {
    sequences = [{
      id: MAIN_SEQUENCE_ID, name: "Sequence 1", settings: project.settings, timeline: project.timeline,
      createdAt: project.createdAt ?? now, modifiedAt: now,
    }];
    seen.add(MAIN_SEQUENCE_ID);
    activeId = MAIN_SEQUENCE_ID;
    changed = true;
  }

  // 2. Legacy compound clips become sequences that keep their id.
  for (const compound of project.compoundClips ?? []) {
    if (seen.has(compound.id)) continue;
    seen.add(compound.id);
    sequences.push({
      id: compound.id, name: compound.name, settings: project.settings,
      timeline: { tracks: compound.content.tracks, subtitles: [], duration: compound.content.duration, markers: [] },
      color: compound.color, createdAt: compound.createdAt, modifiedAt: compound.modifiedAt,
    });
    changed = true;
  }

  // 3. Repair the active id and the tab list.
  if (!activeId) {
    activeId = sequences[0].id;
    changed = true;
  }
  const open = (project.openSequenceIds ?? []).filter((id, i, all) => seen.has(id) && all.indexOf(id) === i);
  if (!open.includes(activeId)) open.unshift(activeId);
  if (open.length !== (project.openSequenceIds?.length ?? -1) || open.some((id, i) => id !== project.openSequenceIds?.[i])) changed = true;

  const next: Project = changed
    ? { ...project, sequences, activeSequenceId: activeId, openSequenceIds: open }
    : project;
  // 4. Project nests for the non-active sequences.
  return withNestProjection(next);
}

// ---------------------------------------------------------------------------
// Nest graph and cycle detection
// ---------------------------------------------------------------------------

/** Sequence ids nested directly by one timeline. */
export function nestedSequenceIds(timeline: Pick<Timeline, "tracks">): Set<string> {
  const ids = new Set<string>();
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const id = getCompoundClipId(clip);
      if (id) ids.add(id);
    }
  }
  return ids;
}

/** Every sequence reachable by nesting from `sequenceId` (excluding itself unless a cycle exists). */
export function descendantSequenceIds(project: Project, sequenceId: string): Set<string> {
  const sequences = new Map(listSequences(project).map((sequence) => [sequence.id, sequence]));
  const found = new Set<string>();
  const stack = [sequenceId];
  while (stack.length) {
    const current = sequences.get(stack.pop() as string);
    if (!current) continue;
    for (const id of nestedSequenceIds(current.timeline)) {
      if (found.has(id)) continue;
      found.add(id);
      stack.push(id);
    }
  }
  return found;
}

/** True when nesting `childId` inside `parentId` would make a sequence contain itself. */
export function wouldCreateSequenceCycle(project: Project, parentId: string, childId: string): boolean {
  return parentId === childId || descendantSequenceIds(project, childId).has(parentId);
}

export function cycleMessage(project: Project, parentId: string, childId: string): string {
  const parent = getSequence(project, parentId)?.name ?? "this sequence";
  const child = getSequence(project, childId)?.name ?? "that sequence";
  return parentId === childId
    ? `A sequence cannot be nested inside itself ("${parent}").`
    : `Cannot nest "${child}" inside "${parent}": "${child}" already contains "${parent}", so one would contain itself.`;
}

/** Number of nest clips (in any sequence) that reference `sequenceId`. */
export function countSequenceInstances(project: Project, sequenceId: string): number {
  let count = 0;
  for (const sequence of listSequences(project)) {
    for (const track of sequence.timeline.tracks) {
      for (const clip of track.clips) if (getCompoundClipId(clip) === sequenceId) count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Structural operations
// ---------------------------------------------------------------------------

function replaceSequences(project: Project, sequences: readonly Sequence[], patch: Partial<Project> = {}): Project {
  return withNestProjection(syncActiveSequence({ ...project, ...patch, sequences, modifiedAt: Date.now() }));
}

function uniqueName(project: Project, base: string): string {
  const names = new Set(listSequences(project).map((sequence) => sequence.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate)) return candidate;
  }
}

/** Make `sequenceId` the live timeline and open its tab. */
export function activateSequence(input: Project, sequenceId: string): SequenceEditResult {
  const project = ensureSequences(input);
  if (project.activeSequenceId === sequenceId) {
    const open = project.openSequenceIds ?? [];
    return { ok: true, project: open.includes(sequenceId) ? project : { ...project, openSequenceIds: [...open, sequenceId] }, sequenceId };
  }
  const flushed = syncActiveSequence(project);
  const target = flushed.sequences?.find((sequence) => sequence.id === sequenceId);
  if (!target) return fail("That sequence no longer exists.");
  const open = flushed.openSequenceIds ?? [];
  const next: Project = {
    ...flushed,
    timeline: target.timeline,
    settings: target.settings,
    activeSequenceId: sequenceId,
    openSequenceIds: open.includes(sequenceId) ? open : [...open, sequenceId],
  };
  return { ok: true, project: withNestProjection(next), sequenceId };
}

/** The project as if `sequenceId` were active; used to render or export a sequence without opening it. */
export function projectForSequence(project: Project, sequenceId: string): Project | null {
  const result = activateSequence(project, sequenceId);
  return result.ok ? result.project : null;
}

export interface NewSequenceOptions {
  readonly name?: string;
  readonly settings?: Partial<ProjectSettings>;
  readonly activate?: boolean;
}

export function createSequence(input: Project, options: NewSequenceOptions = {}): SequenceEditResult {
  const project = syncActiveSequence(ensureSequences(input));
  const now = Date.now();
  const name = options.name?.trim() ? options.name.trim() : uniqueName(project, `Sequence ${(project.sequences?.length ?? 0) + 1}`);
  const settings: ProjectSettings = { ...project.settings, ...options.settings };
  for (const key of ["width", "height", "frameRate", "sampleRate"] as const) {
    if (!(settings[key] > 0) || !Number.isFinite(settings[key])) return fail(`Sequence ${key} must be a positive number.`);
  }
  const sequence: Sequence = { id: newId("seq"), name, settings, timeline: emptyTimeline(), createdAt: now, modifiedAt: now };
  const added = replaceSequences(project, [...(project.sequences ?? []), sequence]);
  if (options.activate === false) return { ok: true, project: added, sequenceId: sequence.id };
  return activateSequence(added, sequence.id);
}

/** New sequence matching a media item's size and frame rate, holding it from 0. */
export function createSequenceFromMedia(input: Project, mediaId: string, name?: string): SequenceEditResult {
  const project = ensureSequences(input);
  const media = project.mediaLibrary.items.find((item) => item.id === mediaId);
  if (!media) return fail("That clip's media is missing.");
  const meta = media.metadata;
  const settings: Partial<ProjectSettings> = {
    ...(meta.width > 0 && meta.height > 0 ? { width: meta.width, height: meta.height } : {}),
    ...(meta.frameRate > 0 ? { frameRate: meta.frameRate } : {}),
    ...(meta.sampleRate > 0 ? { sampleRate: meta.sampleRate } : {}),
  };
  const created = createSequence(project, { name: name ?? uniqueName(project, media.name.replace(/\.[^.]+$/, "")), settings, activate: false });
  if (!created.ok || !created.sequenceId) return created;
  const duration = media.type === "image" ? 5 : meta.duration > 0 ? meta.duration : 5;
  const sequence = created.project.sequences!.find((item) => item.id === created.sequenceId)!;
  const trackType: Track["type"] = media.type === "audio" ? "audio" : "video";
  const tracks = sequence.timeline.tracks.map((track) => track.type === trackType
    ? { ...track, clips: [{ id: newId("clip"), mediaId, trackId: track.id, startTime: 0, duration, inPoint: 0, outPoint: duration,
        effects: [], audioEffects: [], transform: IDENTITY_TRANSFORM, volume: 1, keyframes: [] } as Clip] }
    : track);
  const filled: Sequence = { ...sequence, timeline: { ...sequence.timeline, tracks, duration } };
  const next = replaceSequences(created.project, created.project.sequences!.map((item) => (item.id === filled.id ? filled : item)));
  return activateSequence(next, filled.id);
}

export function renameSequence(input: Project, sequenceId: string, rawName: string): SequenceEditResult {
  const project = syncActiveSequence(ensureSequences(input));
  const name = rawName.trim();
  if (!name) return fail("A sequence needs a name.");
  const current = project.sequences?.find((sequence) => sequence.id === sequenceId);
  if (!current) return fail("That sequence no longer exists.");
  if (current.name === name) return { ok: true, project, sequenceId };
  const rename = (track: Track): Track => track.clips.some((clip) => getCompoundClipId(clip) === sequenceId)
    ? { ...track, clips: track.clips.map((clip) => getCompoundClipId(clip) === sequenceId ? { ...clip, metadata: { ...clip.metadata, compoundClipName: name } } : clip) }
    : track;
  const sequences = project.sequences!.map((sequence) => {
    const tracks = sequence.timeline.tracks.map(rename);
    const timeline = tracks.some((track, i) => track !== sequence.timeline.tracks[i]) ? { ...sequence.timeline, tracks } : sequence.timeline;
    return sequence.id === sequenceId ? { ...sequence, name, timeline, modifiedAt: Date.now() } : timeline !== sequence.timeline ? { ...sequence, timeline } : sequence;
  });
  const active = sequences.find((sequence) => sequence.id === project.activeSequenceId);
  return { ok: true, sequenceId, project: replaceSequences(project, sequences, active ? { timeline: active.timeline } : {}) };
}

function remapTimeline(timeline: Timeline): { timeline: Timeline; trackMap: Map<string, string>; clipMap: Map<string, string> } {
  const trackMap = new Map<string, string>();
  const clipMap = new Map<string, string>();
  for (const track of timeline.tracks) {
    trackMap.set(track.id, newId("track"));
    for (const clip of track.clips) clipMap.set(clip.id, newId("clip"));
  }
  const tracks = timeline.tracks.map((track): Track => ({
    ...track,
    id: trackMap.get(track.id) as string,
    clips: track.clips.map((clip) => ({ ...clip, id: clipMap.get(clip.id) as string, trackId: trackMap.get(track.id) as string })),
    transitions: track.transitions.map((transition) => ({
      ...transition, id: newId("transition"),
      clipAId: clipMap.get(transition.clipAId) ?? transition.clipAId,
      ...(transition.clipBId ? { clipBId: clipMap.get(transition.clipBId) ?? transition.clipBId } : {}),
    })),
  }));
  return { timeline: { ...timeline, tracks: structuredClone(tracks) }, trackMap, clipMap };
}

/** A copied overlay is a plain clip: it must not claim membership of the original's graphic instance. */
function detachFromGraphic<T extends object>(input: T): T {
  const item = input as T & { metadata?: { [key: string]: unknown } };
  if (!item.metadata || !("graphicInstanceId" in item.metadata)) return item;
  const { graphicInstanceId: _owner, graphicLayerId: _layer, ...rest } = item.metadata;
  void _owner;
  void _layer;
  return { ...item, metadata: Object.keys(rest).length ? rest : undefined };
}

export function duplicateSequence(input: Project, sequenceId: string): SequenceEditResult {
  const project = syncActiveSequence(ensureSequences(input));
  const source = project.sequences?.find((sequence) => sequence.id === sequenceId);
  if (!source) return fail("That sequence no longer exists.");
  const { timeline, trackMap } = remapTimeline(source.timeline);
  const now = Date.now();
  const { sourceTrackIds, ...rest } = source;
  const copy: Sequence = {
    ...rest, id: newId("seq"), name: uniqueName(project, `${source.name} (Copy)`), timeline, createdAt: now, modifiedAt: now,
    ...(sourceTrackIds ? { sourceTrackIds: Object.fromEntries(Object.entries(sourceTrackIds).flatMap(([inner, parent]) => trackMap.has(inner) ? [[trackMap.get(inner) as string, parent]] : [])) } : {}),
  };
  const overlays = (items: readonly { id: string; trackId: string }[] | undefined) =>
    (items ?? []).filter((item) => trackMap.has(item.trackId)).map((item) => ({ ...detachFromGraphic(structuredClone(item)), id: newId("overlay"), trackId: trackMap.get(item.trackId) as string }));
  const index = project.sequences!.findIndex((sequence) => sequence.id === sequenceId);
  const sequences = project.sequences!.slice();
  sequences.splice(index + 1, 0, copy);
  const patch: Partial<Project> = {
    ...(overlays(project.textClips).length ? { textClips: [...(project.textClips ?? []), ...overlays(project.textClips) as unknown as NonNullable<Project["textClips"]>] } : {}),
    ...(overlays(project.shapeClips).length ? { shapeClips: [...(project.shapeClips ?? []), ...overlays(project.shapeClips) as unknown as NonNullable<Project["shapeClips"]>] } : {}),
    ...(overlays(project.svgClips).length ? { svgClips: [...(project.svgClips ?? []), ...overlays(project.svgClips) as unknown as NonNullable<Project["svgClips"]>] } : {}),
    ...(overlays(project.stickerClips).length ? { stickerClips: [...(project.stickerClips ?? []), ...overlays(project.stickerClips) as unknown as NonNullable<Project["stickerClips"]>] } : {}),
  };
  return { ok: true, sequenceId: copy.id, project: replaceSequences(project, sequences, patch) };
}

/** Delete a sequence. Refused while it is nested anywhere or when it is the last one. */
export function deleteSequence(input: Project, sequenceId: string): SequenceEditResult {
  const project = syncActiveSequence(ensureSequences(input));
  const sequences = project.sequences!;
  const target = sequences.find((sequence) => sequence.id === sequenceId);
  if (!target) return fail("That sequence no longer exists.");
  if (sequences.length <= 1) return fail("A project needs at least one sequence.");
  const uses = countSequenceInstances(project, sequenceId);
  if (uses > 0) return fail(`"${target.name}" is nested ${uses} time${uses === 1 ? "" : "s"}. Remove or un-nest those clips first.`);
  let next = project;
  if (project.activeSequenceId === sequenceId) {
    const open = (project.openSequenceIds ?? []).filter((id) => id !== sequenceId);
    const fallback = open[Math.max(0, (project.openSequenceIds ?? []).indexOf(sequenceId) - 1)] ?? sequences.find((s) => s.id !== sequenceId)!.id;
    const switched = activateSequence(project, fallback);
    if (!switched.ok) return switched;
    next = switched.project;
  }
  const remaining = (next.sequences ?? []).filter((sequence) => sequence.id !== sequenceId);
  const trackIds = new Set(target.timeline.tracks.map((track) => track.id));
  const keep = <T extends { trackId: string }>(items: readonly T[] | undefined) => items?.filter((item) => !trackIds.has(item.trackId));
  return {
    ok: true, sequenceId,
    project: replaceSequences(next, remaining, {
      openSequenceIds: (next.openSequenceIds ?? []).filter((id) => id !== sequenceId),
      ...(next.textClips ? { textClips: keep(next.textClips) } : {}),
      ...(next.shapeClips ? { shapeClips: keep(next.shapeClips) } : {}),
      ...(next.svgClips ? { svgClips: keep(next.svgClips) } : {}),
      ...(next.stickerClips ? { stickerClips: keep(next.stickerClips) } : {}),
      nestedInstances: (next.nestedInstances ?? []).filter((instance) => instance.compoundClipId !== sequenceId),
    }),
  };
}

/** Close a sequence tab. The last open tab stays; closing the active tab opens its neighbour. */
export function closeSequenceTab(input: Project, sequenceId: string): SequenceEditResult {
  const project = ensureSequences(input);
  const open = project.openSequenceIds ?? [];
  if (!open.includes(sequenceId)) return { ok: true, project, sequenceId };
  if (open.length <= 1) return fail("The last open sequence cannot be closed.");
  const at = open.indexOf(sequenceId);
  const neighbour = open[at - 1] ?? open[at + 1];
  const base = project.activeSequenceId === sequenceId ? activateSequence(project, neighbour) : { ok: true as const, project };
  if (!base.ok) return base;
  return { ok: true, sequenceId, project: { ...base.project, openSequenceIds: (base.project.openSequenceIds ?? []).filter((id) => id !== sequenceId) } };
}

/** Move an open tab so it sits at `toIndex`. */
export function reorderOpenSequences(input: Project, sequenceId: string, toIndex: number): SequenceEditResult {
  const project = ensureSequences(input);
  const open = [...(project.openSequenceIds ?? [])];
  const from = open.indexOf(sequenceId);
  if (from < 0) return fail("That sequence is not open.");
  const to = Math.max(0, Math.min(open.length - 1, Math.round(toIndex)));
  if (from === to) return { ok: true, project, sequenceId };
  open.splice(from, 1);
  open.splice(to, 0, sequenceId);
  return { ok: true, sequenceId, project: { ...project, openSequenceIds: open } };
}

export function setSequenceRange(input: Project, sequenceId: string, range: { inPoint?: number; outPoint?: number }): SequenceEditResult {
  const project = syncActiveSequence(ensureSequences(input));
  const target = project.sequences?.find((sequence) => sequence.id === sequenceId);
  if (!target) return fail("That sequence no longer exists.");
  const merged = { ...target, ...range };
  if (merged.inPoint !== undefined && merged.outPoint !== undefined && merged.inPoint >= merged.outPoint) return fail("The in point must be before the out point.");
  return { ok: true, sequenceId, project: replaceSequences(project, project.sequences!.map((sequence) => (sequence.id === sequenceId ? merged : sequence))) };
}

// ---------------------------------------------------------------------------
// Nesting
// ---------------------------------------------------------------------------

function buildNestClip(sequence: Sequence, trackId: string, startTime: number, duration: number, id = newId("nest")): { clip: Clip; instance: CompoundClipInstance } {
  const clip: Clip = {
    id, mediaId: `compound:${sequence.id}`, trackId, startTime, duration, inPoint: 0, outPoint: duration,
    effects: [], audioEffects: [], transform: IDENTITY_TRANSFORM, volume: 1, keyframes: [],
    metadata: { compoundClipId: sequence.id, compoundClipName: sequence.name, compoundClipColor: sequence.color ?? NEST_COLORS[0] },
  };
  const instance: CompoundClipInstance = { id, compoundClipId: sequence.id, trackId, startTime, duration, inPoint: 0, outPoint: duration, transform: IDENTITY_TRANSFORM, volume: 1 };
  return { clip, instance };
}

function overlaps(clips: readonly Clip[], start: number, duration: number): boolean {
  return clips.some((clip) => start < clip.startTime + clip.duration - 1e-4 && clip.startTime < start + duration - 1e-4);
}

type OverlayField = "textClips" | "shapeClips" | "svgClips" | "stickerClips" | "adjustmentLayers";
const OVERLAY_FIELDS: readonly OverlayField[] = ["textClips", "shapeClips", "svgClips", "stickerClips", "adjustmentLayers"];
interface OverlayLike { readonly id: string; readonly trackId: string; readonly startTime: number; readonly duration: number; readonly metadata?: { readonly [key: string]: unknown } }
const overlaysOf = (project: Project, field: OverlayField): readonly OverlayLike[] => (project[field] as readonly OverlayLike[] | undefined) ?? [];
const RANGE_EPS = 1e-4;

export interface NestOptions {
  /** Also nest the linked video/audio partners of the selected clips (default true, like the timeline selection). */
  readonly linked?: boolean;
}

/**
 * Premiere's "Nest...": move the selected items into a new sequence and put one
 * nest clip over the same span. No time is added or removed on the timeline, so
 * the sync-lock planners are not involved (a nest never ripples).
 *
 * Everything that belongs to the moved span travels with it, so the parent
 * renders identically afterwards: media clips (keyframes, effects and masks keep
 * their ids), the transitions between two moved clips, selected overlays (text,
 * shape, SVG, sticker, adjustment layers, plus captions bound to a moved clip),
 * linked audio, and the timeline captions and markers lying inside the span.
 * Times become nest-local; overlays get the nest's own track ids.
 */
export function nestClips(input: Project, itemIds: readonly string[], name?: string, options: NestOptions = {}): SequenceEditResult {
  const project = syncActiveSequence(ensureSequences(input));
  const allTracks = project.timeline.tracks;
  const selected = new Set(itemIds);
  const mediaOf = (ids: ReadonlySet<string>) => allTracks.flatMap((track) => track.clips).filter((clip) => ids.has(clip.id));
  if (options.linked !== false) {
    for (const clip of mediaOf(new Set(selected))) {
      for (const partner of findLinkedPartners(clip, allTracks)) selected.add(partner.clip.id);
    }
  }
  // A graphic is one bar on the timeline, selected by its anchor layer: take every layer along.
  for (const id of [...selected]) {
    const owner = graphicInstanceOfClip(project, id);
    if (owner) for (const memberId of expectedMemberIds(owner, project.settings)) selected.add(memberId);
  }
  const clips = mediaOf(selected);
  const movedMedia = new Set(clips.map((clip) => clip.id));
  // Captions generated from a moved clip move with it.
  const overlays = new Map<OverlayField, OverlayLike[]>();
  let overlayCount = 0;
  for (const field of OVERLAY_FIELDS) {
    const picked = overlaysOf(project, field).filter((item) => {
      const source = item.metadata?.captionSourceClipId;
      return selected.has(item.id) || (typeof source === "string" && movedMedia.has(source));
    });
    if (picked.length) overlays.set(field, picked);
    overlayCount += picked.length;
  }
  if (clips.length + overlayCount === 0) return fail("Select at least one clip to nest.");
  const tracksById = new Map(allTracks.map((track) => [track.id, track]));
  const touchedTrackIds = new Set<string>(clips.map((clip) => clip.trackId));
  for (const list of overlays.values()) for (const item of list) if (tracksById.has(item.trackId)) touchedTrackIds.add(item.trackId);
  for (const id of touchedTrackIds) {
    if (tracksById.get(id)?.locked) return fail("Unlock the tracks of the selected clips before nesting.");
  }
  const spans = [
    ...clips.map((clip) => [clip.startTime, clip.startTime + clip.duration] as const),
    ...[...overlays.values()].flat().map((item) => [item.startTime, item.startTime + item.duration] as const),
  ];
  const start = Math.min(...spans.map((span) => span[0]));
  const end = Math.max(...spans.map((span) => span[1]));
  const duration = end - start;
  const ordered = allTracks.filter((track) => touchedTrackIds.has(track.id));
  const nestable = (track: Track) => track.type !== "text" && track.type !== "graphics" && !track.locked;
  const free = (track: Track) => !overlaps(track.clips.filter((clip) => !movedMedia.has(clip.id)), start, duration);
  const candidates = [
    ...ordered.filter(nestable),
    ...allTracks.filter((track) => !touchedTrackIds.has(track.id) && track.type === "video" && nestable(track)),
  ];
  const nestTrack = [...candidates].sort((a, b) => Number(b.type === "video") - Number(a.type === "video")).find(free);
  if (!nestTrack) return fail("The nest would overlap other clips on every selected track. Move those clips or select them too.");

  const now = Date.now();
  // The nested sequence gets its own track ids: overlays, masks and instances are keyed by
  // track id project-wide, so sharing ids with the parent would leak them across sequences.
  const innerTrackIds = new Map(ordered.map((track) => [track.id, newId("track")]));
  const moved = clips.map((clip) => ({ ...clip, startTime: clip.startTime - start, trackId: innerTrackIds.get(clip.trackId) as string }));
  const movedById = new Map(moved.map((clip) => [clip.id, clip]));
  const sequenceId = newId("seq");
  // Output/sends name the PARENT's buses, which the nest does not have: drop them.
  const sequenceTracks: Track[] = ordered.map(({ output: _output, sends: _sends, ...track }) => ({
    ...track,
    id: innerTrackIds.get(track.id) as string,
    clips: track.clips.filter((clip) => movedById.has(clip.id)).map((clip) => movedById.get(clip.id) as Clip),
    transitions: track.transitions.filter((t) => movedById.has(t.clipAId) && (!t.clipBId || movedById.has(t.clipBId))),
  }));
  const inRange = (from: number, to: number) => from >= start - RANGE_EPS && to <= end + RANGE_EPS;
  const movedSubtitles = (project.timeline.subtitles ?? []).filter((cue) => inRange(cue.startTime, cue.endTime));
  const movedSubtitleIds = new Set(movedSubtitles.map((cue) => cue.id));
  const movedMarkers = (project.timeline.markers ?? []).filter((marker) => marker.time >= start - RANGE_EPS && marker.time < end - RANGE_EPS);
  const movedMarkerIds = new Set(movedMarkers.map((marker) => marker.id));
  const sequence: Sequence = {
    id: sequenceId,
    name: name?.trim() ? name.trim() : nextNestName(project),
    settings: project.settings,
    timeline: {
      tracks: sequenceTracks,
      subtitles: movedSubtitles.map((cue) => shiftSubtitle(cue, -start)),
      duration,
      markers: movedMarkers.map((marker) => ({ ...marker, time: marker.time - start })),
    },
    color: NEST_COLORS[(project.sequences?.length ?? 0) % NEST_COLORS.length],
    sourceTrackIds: Object.fromEntries(ordered.map((track) => [innerTrackIds.get(track.id) as string, track.id])),
    createdAt: now, modifiedAt: now,
  };
  const { clip: nest, instance } = buildNestClip(sequence, nestTrack.id, start, duration);
  const timeline: Timeline = {
    ...project.timeline,
    subtitles: (project.timeline.subtitles ?? []).filter((cue) => !movedSubtitleIds.has(cue.id)),
    markers: (project.timeline.markers ?? []).filter((marker) => !movedMarkerIds.has(marker.id)),
    tracks: allTracks.map((track) => {
      const remaining = track.clips.filter((clip) => !movedMedia.has(clip.id));
      return {
        ...track,
        clips: track.id === nestTrack.id ? [...remaining, nest] : remaining,
        // A transition that touches a moved clip cannot stay behind pointing at a clip that is gone.
        transitions: track.transitions.filter((t) => !(movedMedia.has(t.clipAId) || (t.clipBId && movedMedia.has(t.clipBId)))),
      };
    }),
  };
  const patch: Partial<Project> = { nestedInstances: [...(project.nestedInstances ?? []), instance] };
  for (const [field, list] of overlays) {
    const ids = new Set(list.map((item) => item.id));
    (patch as Record<string, unknown>)[field] = (project[field] as readonly OverlayLike[]).map((item) => ids.has(item.id)
      ? { ...item, trackId: innerTrackIds.get(item.trackId) ?? item.trackId, startTime: item.startTime - start }
      : item);
  }
  const next = replaceSequences({ ...project, timeline }, [...project.sequences!, sequence], patch);
  return { ok: true, project: next, sequenceId, clipId: nest.id };
}

function shiftSubtitle(cue: Subtitle, delta: number): Subtitle {
  return {
    ...structuredClone(cue),
    startTime: cue.startTime + delta,
    endTime: cue.endTime + delta,
    ...(cue.words ? { words: cue.words.map((word) => ({ ...word, startTime: word.startTime + delta, endTime: word.endTime + delta })) } : {}),
  };
}

function nextNestName(project: Project): string {
  const names = new Set((project.sequences ?? []).map((sequence) => sequence.name));
  let n = 1;
  while (names.has(`Nested Sequence ${n}`)) n += 1;
  return `Nested Sequence ${n}`;
}

/** Drop a sequence onto the active timeline as a nest (project panel drag). Blocks cycles. */
export function insertSequenceAsNest(input: Project, sequenceId: string, request: { trackId?: string; startTime: number }): SequenceEditResult {
  const project = syncActiveSequence(ensureSequences(input));
  const active = project.activeSequenceId as string;
  const sequence = project.sequences?.find((item) => item.id === sequenceId);
  if (!sequence) return fail("That sequence no longer exists.");
  if (wouldCreateSequenceCycle(project, active, sequenceId)) return fail(cycleMessage(project, active, sequenceId));
  const duration = sequenceContentDuration(sequence.timeline);
  if (!(duration > 0)) return fail(`"${sequence.name}" is empty, so there is nothing to nest.`);
  const videoTracks = project.timeline.tracks.filter((track) => track.type === "video" && !track.locked);
  const targetTrackId = request.trackId ?? videoTracks.at(-1)?.id;
  const newTrackId = newId("track");
  let trackId: string;
  let startTime = Math.max(0, request.startTime);
  let tracks = project.timeline.tracks;
  if (!targetTrackId) {
    trackId = newTrackId;
    tracks = [...tracks, { id: newTrackId, type: "video", name: "Video 1", role: "general", mode: "standard", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false }];
  } else {
    const placement = resolveTimelinePlacement(project, { targetTrackId, startTime, duration, policy: "stack-above", newTrackId });
    if (!placement.ok) return fail(placement.reason === "track-locked" ? "The destination track is locked." : placement.reason === "overlap" ? "The destination interval is occupied." : "The destination track no longer exists.");
    trackId = placement.trackId;
    startTime = placement.startTime;
    if (placement.createdTrack) {
      const created: Track = { id: placement.createdTrack.id, type: "video", name: `Video ${tracks.filter((t) => t.type === "video").length + 1}`, role: "general", mode: "standard", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false };
      tracks = [...tracks.slice(0, placement.createdTrack.position), created, ...tracks.slice(placement.createdTrack.position)];
    }
  }
  const { clip, instance } = buildNestClip(sequence, trackId, startTime, duration);
  const timeline: Timeline = {
    ...project.timeline,
    tracks: tracks.map((track) => (track.id === trackId ? { ...track, clips: [...track.clips, clip] } : track)),
    duration: Math.max(project.timeline.duration, startTime + duration),
  };
  return {
    ok: true, sequenceId, clipId: clip.id,
    project: replaceSequences({ ...project, timeline }, project.sequences!, { nestedInstances: [...(project.nestedInstances ?? []), instance] }),
  };
}

/** The sequence a nest clip points at, when it exists. */
export function sequenceForNestClip(project: Project, clip: Pick<Clip, "mediaId" | "metadata">): Sequence | undefined {
  const id = getCompoundClipId(clip);
  return id ? getSequence(project, id) : undefined;
}

/** Project-panel filing: put sequences in a bin (null = root). Unknown bins are refused. */
export function moveSequencesToBin(input: Project, sequenceIds: readonly string[], binId: string | null): SequenceEditResult {
  const project = syncActiveSequence(ensureSequences(input));
  if (binId !== null && !(project.bins ?? []).some((bin) => bin.id === binId)) return fail("That bin no longer exists.");
  const ids = new Set(sequenceIds);
  const sequences = project.sequences!.map((sequence): Sequence => {
    if (!ids.has(sequence.id) || (sequence.binId ?? null) === binId) return sequence;
    const { binId: _old, ...rest } = sequence;
    void _old;
    return binId === null ? rest : { ...rest, binId };
  });
  return { ok: true, project: replaceSequences(project, sequences) };
}

/**
 * Make Subsequence: the span `range` (the In/Out marks, or the selection's extent) becomes a new nested sequence in
 * place. Clips crossing the span's edges are split there first, so exactly the marked picture is nested; the nest
 * takes the span's place on the timeline and opens as its own sequence. Built on `nestClips`: one project, one undo step.
 */
export function makeSubsequence(input: Project, range: { start: number; end: number }, name?: string): SequenceEditResult {
  if (!(range.end - range.start > RANGE_EPS)) return fail("Mark an In and Out range (or select clips) to make a subsequence.");
  const base = syncActiveSequence(ensureSequences(input));
  const tracks = base.timeline.tracks.filter((track) => !track.locked && track.type !== "text" && track.type !== "graphics");
  const ids = tracks.map((track) => track.id);
  const counter = { n: 0 };
  const operationId = newId("subseq");
  let work = splitAt(base, ids, range.start, operationId, counter);
  work = splitAt(work, ids, range.end, operationId, counter);
  const inside = new Set(ids);
  const picked = work.timeline.tracks
    .filter((track) => inside.has(track.id))
    .flatMap((track) => track.clips.filter((clip) => clip.startTime >= range.start - RANGE_EPS && clip.startTime + clip.duration <= range.end + RANGE_EPS))
    .map((clip) => clip.id);
  if (!picked.length) return fail("There are no clips inside that range.");
  return nestClips(work, picked, name ?? "Subsequence");
}
