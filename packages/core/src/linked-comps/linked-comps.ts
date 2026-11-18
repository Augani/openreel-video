/**
 * Pure project edits for live linked compositions (see types.ts).
 *
 * Every function returns a new Project (never mutates) and never touches the
 * history: the caller commits the result as ONE undo step through
 * `project/applyEditSnapshot`, the same path sequences, graphics and the agent
 * use. That is what makes each user operation (Replace with Linked Composition,
 * an edit in the composition window, Render and Replace, Restore Unrendered, a
 * parameter keyframe) exactly one undoable step.
 *
 * Invariants
 * - `Project.linkedCompositions` holds the masters. A linked `GraphicInstance`
 *   carries `linkedCompositionId` and an equal copy of the master template, so the
 *   existing expansion, preview, export, render cache and interchange code sees an
 *   ordinary graphic.
 * - `editLinkedComposition` is the only writer of a master template and re-syncs
 *   every linked instance in the same edit.
 */
import type { Project } from "../types/project";
import type { Clip, Track, Transform } from "../types/timeline";
import { EASING_TYPES, type EasingType } from "../types/timeline";
import {
  clampGraphicDuration,
  isKeyframableParameter,
  resolveParamValues,
} from "../graphic-templates/expand";
import {
  commitGraphicInstance,
  getGraphicInstance,
  graphicInstanceOfClip,
  insertGraphicTemplate,
} from "../graphic-templates/instances";
import { groupClipsIntoGraphic, groupableClipIds } from "../graphic-templates/group";
import type {
  GraphicInstance,
  GraphicParamKeyframe,
  GraphicTemplate,
} from "../graphic-templates/types";
import { validateGraphicTemplate } from "../graphic-templates/validate";
import { getTrackItems } from "../timeline/timeline-items";
import { AnimationEngine } from "../video/animation-engine";
import { LINKED_BAKE_CLIP_KEY, type LinkedComposition } from "./types";

export type LinkedEditResult =
  | { readonly ok: true; readonly project: Project; readonly instanceId?: string; readonly compositionId?: string; readonly warnings?: readonly string[] }
  | { readonly ok: false; readonly message: string };

const fail = (message: string): LinkedEditResult => ({ ok: false, message });
const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;
const EPS = 1e-3;

const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function listLinkedCompositions(project: Project): readonly LinkedComposition[] {
  return project.linkedCompositions ?? [];
}

export function getLinkedComposition(project: Project, compositionId: string): LinkedComposition | undefined {
  return project.linkedCompositions?.find((composition) => composition.id === compositionId);
}

/** Instances on the timeline that mirror `compositionId`. */
export function linkedInstancesOf(project: Project, compositionId: string): readonly GraphicInstance[] {
  return (project.graphicInstances ?? []).filter((instance) => instance.linkedCompositionId === compositionId);
}

/** The linked composition an instance mirrors, if any. */
export function compositionOfInstance(project: Project, instance: GraphicInstance): LinkedComposition | undefined {
  return instance.linkedCompositionId ? getLinkedComposition(project, instance.linkedCompositionId) : undefined;
}

/** Instance whose rendered media clip is `clipId` (Render and Replace). */
export function linkedInstanceOfBakedClip(project: Project, clipId: string): GraphicInstance | undefined {
  return (project.graphicInstances ?? []).find((instance) => instance.bake?.clipId === clipId);
}

/** A baked instance whose composition was edited after the render. */
export function isBakeStale(project: Project, instance: GraphicInstance): boolean {
  if (!instance.bake) return false;
  const composition = compositionOfInstance(project, instance);
  return composition !== undefined && composition.revision !== instance.bake.revision;
}

function withComposition(project: Project, composition: LinkedComposition): Project {
  const exists = project.linkedCompositions?.some((item) => item.id === composition.id) ?? false;
  const list = exists
    ? (project.linkedCompositions ?? []).map((item) => (item.id === composition.id ? composition : item))
    : [...(project.linkedCompositions ?? []), composition];
  return { ...project, linkedCompositions: list };
}

function makeComposition(template: GraphicTemplate, name: string): LinkedComposition {
  const now = Date.now();
  return {
    id: newId("lcomp"),
    name,
    template,
    createdAt: now,
    modifiedAt: now,
    revision: 1,
  };
}

// ---------------------------------------------------------------------------
// Creating and placing
// ---------------------------------------------------------------------------

export interface InsertLinkedOptions {
  readonly startTime: number;
  readonly duration?: number;
  readonly trackId?: string;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly name?: string;
}

/** Place another live instance of an existing composition. */
export function insertLinkedComposition(
  project: Project,
  compositionId: string,
  options: InsertLinkedOptions,
): LinkedEditResult {
  const composition = getLinkedComposition(project, compositionId);
  if (!composition) return fail("That composition no longer exists.");
  const placed = insertGraphicTemplate(project, composition.template, {
    startTime: options.startTime,
    duration: options.duration,
    trackId: options.trackId,
    values: options.values,
    name: options.name ?? composition.name,
  });
  if (!placed.ok || !placed.instanceId) return fail(placed.ok ? "The composition could not be placed." : placed.message);
  const instance = getGraphicInstance(placed.project, placed.instanceId);
  if (!instance) return fail("The composition could not be placed.");
  const linked = commitGraphicInstance(placed.project, { ...instance, linkedCompositionId: composition.id });
  return { ok: true, project: linked, instanceId: instance.id, compositionId: composition.id };
}

/**
 * Duplicate a linked instance right after the original (Ctrl+D). The copy stays linked to the
 * same composition and keeps the original's control values and keyframes.
 */
export function duplicateLinkedInstance(project: Project, instanceId: string): LinkedEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance?.linkedCompositionId) return fail("That graphic is not a linked composition.");
  if (instance.bake) return fail("Restore the unrendered graphic first.");
  const placed = insertLinkedComposition(project, instance.linkedCompositionId, {
    startTime: instance.startTime + instance.duration,
    duration: instance.duration,
    values: instance.values,
    name: instance.name,
  });
  if (!placed.ok || !placed.instanceId || !instance.paramKeyframes) return placed;
  const copy = getGraphicInstance(placed.project, placed.instanceId);
  if (!copy) return placed;
  return { ...placed, project: commitGraphicInstance(placed.project, { ...copy, paramKeyframes: instance.paramKeyframes }) };
}

/** Create a new composition from a template and place its first live instance. */
export function createLinkedComposition(
  project: Project,
  template: GraphicTemplate,
  options: InsertLinkedOptions,
): LinkedEditResult {
  const checked = validateGraphicTemplate(template);
  if (!checked.ok) return fail(`Invalid composition: ${checked.errors[0]}`);
  const name = options.name?.trim() || checked.template.name;
  const composition = makeComposition({ ...checked.template, id: newId("linked-template"), name }, name);
  const result = insertLinkedComposition(withComposition(project, composition), composition.id, { ...options, name });
  return result;
}

/**
 * "Replace with Linked Composition": the selected clips move into a NEW composition
 * and are replaced by one live instance spanning them. Text, shape and SVG clips
 * (and one existing, still unlinked graphic) can become composition layers; other
 * clips (video, image, audio) cannot, because a composition is a graphics document.
 */
export function replaceWithLinkedComposition(
  project: Project,
  clipIds: readonly string[],
  options: { readonly name?: string } = {},
): LinkedEditResult {
  const wanted = new Set(clipIds);
  const mediaOnly = project.timeline.tracks.flatMap((track) => track.clips).filter((clip) => wanted.has(clip.id));
  const owners = new Map<string, GraphicInstance>();
  for (const id of clipIds) {
    const owner = graphicInstanceOfClip(project, id);
    if (owner) owners.set(owner.id, owner);
  }

  // One existing unlinked graphic selected on its own: link it in place.
  const groupable = groupableClipIds(project, clipIds);
  if (owners.size === 1 && groupable.length === 0) {
    const [instance] = [...owners.values()];
    if (instance.linkedCompositionId) return fail("That graphic is already a linked composition.");
    if (instance.bake) return fail("Restore the unrendered graphic first.");
    const name = options.name?.trim() || instance.name;
    const composition = makeComposition({ ...instance.template, id: newId("linked-template"), name }, name);
    const next = commitGraphicInstance(withComposition(project, composition), { ...instance, linkedCompositionId: composition.id });
    return { ok: true, project: next, instanceId: instance.id, compositionId: composition.id };
  }
  if (owners.size > 0) return fail("Select ordinary text, shape or SVG clips, or one graphic on its own.");

  if (groupable.length === 0) {
    return fail(
      mediaOnly.length > 0
        ? "A linked composition holds text, shape and SVG layers. Select those clips, or use Nest to group video and audio."
        : "Select text, shape or SVG clips to replace with a linked composition.",
    );
  }
  const skipped = clipIds.length - groupable.length;
  const grouped = groupClipsIntoGraphic(project, groupable, { name: options.name?.trim() || "Linked composition" });
  if (!grouped.ok || !grouped.instanceId) return fail(grouped.ok ? "The clips could not be grouped." : grouped.message);
  const instance = getGraphicInstance(grouped.project, grouped.instanceId);
  if (!instance) return fail("The clips could not be grouped.");
  const name = options.name?.trim() || instance.name;
  const composition = makeComposition({ ...instance.template, id: newId("linked-template"), name }, name);
  const next = commitGraphicInstance(withComposition(grouped.project, composition), { ...instance, name, linkedCompositionId: composition.id });
  return {
    ok: true,
    project: next,
    instanceId: instance.id,
    compositionId: composition.id,
    ...(skipped > 0 ? { warnings: [`${skipped} selected clip${skipped === 1 ? " is" : "s are"} not a graphic and ${skipped === 1 ? "was" : "were"} left on the timeline.`] } : {}),
  };
}

/** Break the link: the instance becomes an ordinary Essential Graphics graphic keeping its current look. */
export function detachLinkedComposition(project: Project, instanceId: string): LinkedEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance?.linkedCompositionId) return fail("That graphic is not a linked composition.");
  if (instance.bake) return fail("Restore the unrendered graphic first.");
  const { linkedCompositionId: _link, ...rest } = instance;
  void _link;
  return { ok: true, project: commitGraphicInstance(project, rest), instanceId };
}

// ---------------------------------------------------------------------------
// Editing the master
// ---------------------------------------------------------------------------

/** Keep only keyframes of parameters that still exist and can still be keyframed. */
function pruneParamKeyframes(
  template: GraphicTemplate,
  keyframes: GraphicInstance["paramKeyframes"],
): GraphicInstance["paramKeyframes"] {
  if (!keyframes) return undefined;
  const kept: Record<string, readonly GraphicParamKeyframe[]> = {};
  for (const parameter of template.parameters) {
    const list = keyframes[parameter.id];
    if (list?.length && isKeyframableParameter(parameter)) kept[parameter.id] = list;
  }
  return Object.keys(kept).length ? kept : undefined;
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Mirror the master template onto an instance. A control the user never changed on
 * this instance (its value still equals the OLD default) follows the master's new
 * default, so retitling in the composition window retitles the timeline; a control
 * the user customised keeps its value.
 */
function syncInstance(instance: GraphicInstance, template: GraphicTemplate): GraphicInstance {
  const previous = new Map(instance.template.parameters.map((parameter) => [parameter.id, parameter.defaultValue]));
  const carried: Record<string, unknown> = { ...instance.values };
  for (const parameter of template.parameters) {
    const old = previous.get(parameter.id);
    if (old !== undefined && sameValue(carried[parameter.id], old)) carried[parameter.id] = parameter.defaultValue;
  }
  const values = resolveParamValues(template, carried);
  return {
    ...instance,
    template,
    values,
    duration: clampGraphicDuration(template, instance.duration),
    paramKeyframes: pruneParamKeyframes(template, instance.paramKeyframes),
  };
}

/**
 * Edit the master template (the composition window, or Essential Graphics > Edit on a
 * linked instance) and update every linked instance in the same step.
 */
export function editLinkedComposition(
  project: Project,
  compositionId: string,
  edit: (template: GraphicTemplate) => GraphicTemplate,
  options: { readonly expectedRevision?: number } = {},
): LinkedEditResult {
  const composition = getLinkedComposition(project, compositionId);
  if (!composition) return fail("That composition no longer exists.");
  // The caller built its edit on this revision (a composition window): refuse it when the project moved on.
  if (options.expectedRevision !== undefined && options.expectedRevision !== composition.revision) {
    return fail("The composition changed in the editor while you were editing it, so your last change was not applied.");
  }
  const proposed = edit(composition.template);
  if (proposed === composition.template) return { ok: true, project, compositionId };
  const edited = validateGraphicTemplate(proposed);
  if (!edited.ok) return fail(`That change is not valid: ${edited.errors[0]}`);
  const template = edited.template;
  let next = withComposition(project, {
    ...composition,
    template,
    modifiedAt: Date.now(),
    revision: composition.revision + 1,
  });
  for (const instance of linkedInstancesOf(project, compositionId)) {
    next = commitGraphicInstance(next, syncInstance(instance, template));
  }
  return { ok: true, project: next, compositionId };
}

export function renameLinkedComposition(project: Project, compositionId: string, name: string): LinkedEditResult {
  const composition = getLinkedComposition(project, compositionId);
  const trimmed = name.trim();
  if (!composition) return fail("That composition no longer exists.");
  if (!trimmed) return fail("Give the composition a name.");
  return { ok: true, project: withComposition(project, { ...composition, name: trimmed, modifiedAt: Date.now() }), compositionId };
}

/** Delete a composition nothing uses any more. */
export function deleteLinkedComposition(project: Project, compositionId: string): LinkedEditResult {
  if (!getLinkedComposition(project, compositionId)) return fail("That composition no longer exists.");
  if (linkedInstancesOf(project, compositionId).length > 0) return fail("That composition is still used on the timeline.");
  const rest = (project.linkedCompositions ?? []).filter((item) => item.id !== compositionId);
  return { ok: true, project: { ...project, linkedCompositions: rest.length ? rest : undefined }, compositionId };
}

// ---------------------------------------------------------------------------
// Keyframable master properties
// ---------------------------------------------------------------------------

const goodEasing = (easing: unknown): EasingType =>
  typeof easing === "string" && (EASING_TYPES as readonly string[]).includes(easing) ? (easing as EasingType) : "linear";

const sampler = new AnimationEngine();

/**
 * The value of a keyframed parameter at `time` seconds after the instance start, with the
 * same interpolation the clips use. `fallback` (the static value) when it has no keyframes.
 */
export function sampleParamKeyframes(
  keyframes: readonly GraphicParamKeyframe[] | undefined,
  time: number,
  fallback: number,
): number {
  if (!keyframes?.length) return fallback;
  const keys = keyframes.map((key) => ({ id: key.id, time: key.time, property: "param", value: key.value, easing: key.easing }));
  const value = sampler.getValueAtTime(keys, Math.max(0, time)).value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Set (or replace) a keyframe of an exposed parameter at `time` seconds after the
 * instance start. The value is clamped to the parameter's range.
 */
export function setParamKeyframe(
  project: Project,
  instanceId: string,
  parameterId: string,
  key: { readonly time: number; readonly value: number; readonly easing?: EasingType },
): LinkedEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return fail("That graphic no longer exists.");
  if (instance.bake) return fail("Restore the unrendered composition to animate its controls.");
  const parameter = instance.template.parameters.find((item) => item.id === parameterId);
  if (!parameter) return fail(`This composition has no control "${parameterId}".`);
  if (!isKeyframableParameter(parameter)) {
    return fail(`"${parameter.label}" cannot be keyframed. Number controls for opacity, rotation and position can.`);
  }
  if (!Number.isFinite(key.time) || !Number.isFinite(key.value)) return fail("The keyframe needs a finite time and value.");
  const time = Math.min(instance.duration, Math.max(0, key.time));
  const value = Math.min(parameter.max ?? 100000, Math.max(parameter.min ?? -100000, key.value));
  const existing = instance.paramKeyframes?.[parameterId] ?? [];
  const same = existing.find((item) => Math.abs(item.time - time) < EPS);
  const keyframe: GraphicParamKeyframe = {
    id: same?.id ?? newId("pkf"),
    time: same ? same.time : Math.round(time * 1e6) / 1e6,
    value,
    easing: goodEasing(key.easing ?? same?.easing),
  };
  const list = [...existing.filter((item) => item !== same), keyframe].sort((a, b) => a.time - b.time);
  return {
    ok: true,
    project: commitGraphicInstance(project, { ...instance, paramKeyframes: { ...(instance.paramKeyframes ?? {}), [parameterId]: list } }),
    instanceId,
  };
}

export function removeParamKeyframe(project: Project, instanceId: string, parameterId: string, keyframeId: string): LinkedEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return fail("That graphic no longer exists.");
  const existing = instance.paramKeyframes?.[parameterId] ?? [];
  if (!existing.some((item) => item.id === keyframeId)) return fail("That keyframe no longer exists.");
  const list = existing.filter((item) => item.id !== keyframeId);
  const next: Record<string, readonly GraphicParamKeyframe[]> = { ...(instance.paramKeyframes ?? {}) };
  if (list.length) next[parameterId] = list;
  else delete next[parameterId];
  return {
    ok: true,
    project: commitGraphicInstance(project, { ...instance, paramKeyframes: Object.keys(next).length ? next : undefined }),
    instanceId,
  };
}

/** Stop animating a parameter (all its keyframes), keeping its static value. */
export function clearParamKeyframes(project: Project, instanceId: string, parameterId: string): LinkedEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return fail("That graphic no longer exists.");
  if (!instance.paramKeyframes?.[parameterId]) return { ok: true, project, instanceId };
  const next: Record<string, readonly GraphicParamKeyframe[]> = { ...instance.paramKeyframes };
  delete next[parameterId];
  return {
    ok: true,
    project: commitGraphicInstance(project, { ...instance, paramKeyframes: Object.keys(next).length ? next : undefined }),
    instanceId,
  };
}

// ---------------------------------------------------------------------------
// Render and Replace / Restore Unrendered
// ---------------------------------------------------------------------------

/**
 * A copy of the project holding only this instance's layers, for rendering it to a
 * file with the ordinary exporter (export range = `{ startTime, endTime }`). Nothing
 * else on the timeline can leak into the render.
 */
export function bakeSourceProject(
  project: Project,
  instanceId: string,
): { readonly ok: true; readonly project: Project; readonly range: { readonly startTime: number; readonly endTime: number } } | { readonly ok: false; readonly message: string } {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return { ok: false, message: "That graphic no longer exists." };
  if (instance.bake) return { ok: false, message: "That composition is already rendered." };
  const isMember = (clip: { readonly id: string; readonly metadata?: { readonly [key: string]: unknown } }): boolean =>
    clip.metadata?.graphicInstanceId === instanceId && clip.id.startsWith(`${instanceId}__`);
  const track = project.timeline.tracks.find((item) => item.id === instance.trackId);
  const bakeTrack: Track = {
    id: instance.trackId,
    type: "graphics",
    name: "Linked composition",
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    mode: "standard",
    role: track?.role ?? "general",
  };
  const source: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: [bakeTrack],
      subtitles: [],
      markers: [],
      duration: instance.startTime + instance.duration,
    },
    textClips: project.textClips?.filter(isMember),
    shapeClips: project.shapeClips?.filter(isMember),
    svgClips: project.svgClips?.filter(isMember),
    stickerClips: undefined,
    adjustmentLayers: undefined,
    masks: undefined,
    particleEffects: undefined,
    compoundClips: undefined,
    nestedInstances: undefined,
    motionInstances: undefined,
    sequences: undefined,
    activeSequenceId: undefined,
    openSequenceIds: undefined,
  };
  return { ok: true, project: source, range: { startTime: instance.startTime, endTime: instance.startTime + instance.duration } };
}

function findFreeVideoTrack(project: Project, start: number, duration: number): Track | undefined {
  return project.timeline.tracks.find(
    (track) =>
      track.type === "video" &&
      !track.locked &&
      getTrackItems(project, track.id).every(
        (item) => item.startTime >= start + duration - 1e-4 || item.startTime + item.duration <= start + 1e-4,
      ),
  );
}

/**
 * "Render and Replace": swap the live layers for one ordinary media clip holding the
 * render (`mediaId` is already in the media library). The instance record is kept so
 * "Restore Unrendered" can bring the live layers back.
 */
export function renderAndReplace(
  project: Project,
  instanceId: string,
  mediaId: string,
  /** What was rendered. When given, the swap is refused if the composition or its span changed since. */
  rendered?: { readonly revision: number; readonly startTime: number; readonly duration: number },
): LinkedEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return fail("That graphic no longer exists.");
  if (!instance.linkedCompositionId) return fail("Only a linked composition can be rendered and replaced.");
  if (instance.bake) return fail("That composition is already rendered.");
  const composition = compositionOfInstance(project, instance);
  if (!composition) return fail("That composition no longer exists.");
  if (!project.mediaLibrary.items.some((item) => item.id === mediaId)) return fail("The rendered file is not in the media library.");
  if (
    rendered &&
    (rendered.revision !== composition.revision ||
      Math.abs(rendered.startTime - instance.startTime) > EPS ||
      Math.abs(rendered.duration - instance.duration) > EPS)
  ) {
    return fail("The composition was edited or moved while it was rendering. Render it again.");
  }
  const original = project.timeline.tracks.find((track) => track.id === instance.trackId);
  if (!original) return fail("The track of that composition no longer exists.");

  let working: Project = { ...project };
  let target = findFreeVideoTrack(working, instance.startTime, instance.duration);
  let createdTrack = false;
  if (!target) {
    const count = working.timeline.tracks.filter((track) => track.name.startsWith("Rendered")).length;
    target = {
      id: newId("track"),
      type: "video",
      name: `Rendered ${count + 1}`,
      role: "general",
      mode: "standard",
      clips: [],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    };
    createdTrack = true;
    working = { ...working, timeline: { ...working.timeline, tracks: [target, ...working.timeline.tracks] } };
  }
  const clip: Clip = {
    id: newId("clip"),
    mediaId,
    trackId: target.id,
    startTime: instance.startTime,
    duration: instance.duration,
    inPoint: 0,
    outPoint: instance.duration,
    effects: [],
    audioEffects: [],
    transform: IDENTITY_TRANSFORM,
    volume: 1,
    keyframes: [],
    metadata: { [LINKED_BAKE_CLIP_KEY]: instance.id },
  };
  const targetId = target.id;
  const tracks = working.timeline.tracks.map((track) => (track.id === targetId ? { ...track, clips: [...track.clips, clip] } : track));
  working = { ...working, timeline: { ...working.timeline, tracks } };
  const baked: GraphicInstance = {
    ...instance,
    bake: { mediaId, clipId: clip.id, originalTrackId: instance.trackId, createdTrack, revision: composition.revision },
  };
  return { ok: true, project: commitGraphicInstance(working, baked), instanceId };
}

/** "Restore Unrendered": drop the rendered clip and bring the live layers back where the clip now is. */
export function restoreUnrendered(project: Project, instanceId: string): LinkedEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return fail("That graphic no longer exists.");
  const bake = instance.bake;
  if (!bake) return fail("That composition is not rendered.");
  let clip: Clip | undefined;
  for (const track of project.timeline.tracks) {
    clip = track.clips.find((item) => item.id === bake.clipId);
    if (clip) break;
  }
  const renderedTrackId = clip?.trackId;
  let tracks = project.timeline.tracks.map((track) =>
    track.id === renderedTrackId ? { ...track, clips: track.clips.filter((item) => item.id !== bake.clipId) } : track,
  );
  // The render may have been moved or trimmed: the live layers take its place.
  const startTime = clip ? clip.startTime : instance.startTime;
  const duration = clip ? clip.duration : instance.duration;
  if (bake.createdTrack && renderedTrackId) {
    tracks = tracks.filter((track) => track.id !== renderedTrackId || track.clips.length > 0);
  }
  let working: Project = { ...project, timeline: { ...project.timeline, tracks } };
  const wanted = working.timeline.tracks.find((track) => track.id === bake.originalTrackId && !track.locked);
  let trackId = wanted?.id;
  if (!trackId) {
    const free = working.timeline.tracks.find((track) => track.type !== "audio" && !track.locked);
    if (free) trackId = free.id;
    else {
      const created: Track = {
        id: newId("track"), type: "graphics", name: "Graphics 1", role: "general", mode: "standard",
        clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false,
      };
      working = { ...working, timeline: { ...working.timeline, tracks: [created, ...working.timeline.tracks] } };
      trackId = created.id;
    }
  }
  const { bake: _bake, ...rest } = instance;
  void _bake;
  const composition = compositionOfInstance(working, instance);
  const template = composition?.template ?? instance.template;
  const live = syncInstance({ ...rest, trackId, startTime, duration }, template);
  return { ok: true, project: commitGraphicInstance(working, live), instanceId };
}

// ---------------------------------------------------------------------------
// Interchange
// ---------------------------------------------------------------------------

export interface LinkedInterchangeNote {
  readonly instanceId: string;
  readonly name: string;
  readonly trackId: string;
  /** "rendered": exported as its rendered media clip. "live": no picture can be written. */
  readonly state: "rendered" | "live";
  readonly stale: boolean;
}

/**
 * How each linked composition reaches an XML / AAF export. XML and AAF carry no
 * graphics, so a rendered composition is exported as the ordinary media clip it was
 * flattened into, and a live one cannot be flattened without rendering it first.
 */
export function linkedInterchangeNotes(project: Project): LinkedInterchangeNote[] {
  return (project.graphicInstances ?? [])
    .filter((instance) => instance.linkedCompositionId)
    .map((instance) => ({
      instanceId: instance.id,
      name: instance.name,
      trackId: instance.bake ? (instance.bake.originalTrackId) : instance.trackId,
      state: instance.bake ? "rendered" : "live",
      stale: isBakeStale(project, instance),
    }));
}
