/**
 * Pure project edits for graphic instances (Essential Graphics).
 *
 * Every function returns a new Project (never mutates) and never touches the
 * history: the caller commits the result as ONE undo step through
 * `project/applyEditSnapshot`, the same path sequences and the agent use.
 *
 * Invariant: `Project.graphicInstances` is the source of truth. Each visible
 * layer of an instance exists as an ordinary text / shape / svg clip with the
 * deterministic id `<instance>__<layer>` and `metadata.graphicInstanceId`. Edits
 * regenerate those clips, so they can never drift from the template.
 */
import type { Project } from "../types/project";
import type { Track } from "../types/timeline";
import type { TextClip } from "../text/types";
import type { ShapeClip, SVGClip } from "../graphics/types";
import { getTrackItems } from "../timeline/timeline-items";
import {
  clampGraphicDuration,
  coerceParamValue,
  expandGraphicInstance,
  graphicMemberId,
  protectedDurations,
  resolveParamValues,
  type ExpandedGraphic,
} from "./expand";
import {
  GRAPHIC_LAYER_MEMBER_KEY,
  type GraphicInstance,
  type GraphicParamValue,
  type GraphicTemplate,
} from "./types";
import { validateGraphicTemplate } from "./validate";

export type GraphicEditResult =
  | { readonly ok: true; readonly project: Project; readonly instanceId?: string }
  | { readonly ok: false; readonly message: string };

const fail = (message: string): GraphicEditResult => ({ ok: false, message });
const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;

type Overlay = { readonly id: string; readonly metadata?: { readonly [key: string]: unknown } };
const memberOf = (clip: Overlay): string | undefined => {
  const value = clip.metadata?.[GRAPHIC_LAYER_MEMBER_KEY];
  return typeof value === "string" ? value : undefined;
};

export function listGraphicInstances(project: Project): readonly GraphicInstance[] {
  return project.graphicInstances ?? [];
}

export function getGraphicInstance(project: Project, instanceId: string): GraphicInstance | undefined {
  return project.graphicInstances?.find((instance) => instance.id === instanceId);
}

const memberIdCache = new WeakMap<GraphicInstance, { w: number; h: number; ids: ReadonlySet<string> }>();

/** The deterministic clip ids an instance's visible layers expand to. */
export function expectedMemberIds(instance: GraphicInstance, frame: { readonly width: number; readonly height: number }): ReadonlySet<string> {
  const cached = memberIdCache.get(instance);
  if (cached && cached.w === frame.width && cached.h === frame.height) return cached.ids;
  const expanded = expandGraphicInstance(instance, frame);
  const ids = new Set([...expanded.textClips, ...expanded.shapeClips, ...expanded.svgClips].map((clip) => clip.id));
  memberIdCache.set(instance, { w: frame.width, h: frame.height, ids });
  return ids;
}

/** Ids of every member clip of every instance (the timeline hides them behind the graphic bar). */
export function graphicMemberClipIds(project: Project): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const instance of project.graphicInstances ?? []) {
    for (const id of expectedMemberIds(instance, project.settings)) ids.add(id);
  }
  return ids;
}

/** Instance owning a member clip id, if any (from the instance records, not the clip arrays). */
export function graphicInstanceOfClip(project: Project, clipId: string): GraphicInstance | undefined {
  for (const instance of project.graphicInstances ?? []) {
    if (clipId.startsWith(`${instance.id}__`) && expectedMemberIds(instance, project.settings).has(clipId)) return instance;
  }
  return undefined;
}

function stripMembers(project: Project, instanceIds: ReadonlySet<string>): Project {
  if (instanceIds.size === 0) return project;
  const keep = <T extends Overlay>(list: T[] | undefined): T[] | undefined =>
    list?.filter((clip) => {
      const owner = memberOf(clip);
      // Member ids are `<instance>__<layer>`. A copy made elsewhere (duplicated sequence, pasted
      // overlay) can carry the owner's metadata under a different id: it is not a member.
      return !owner || !instanceIds.has(owner) || !clip.id.startsWith(`${owner}__`);
    });
  return {
    ...project,
    textClips: keep(project.textClips),
    shapeClips: keep(project.shapeClips),
    svgClips: keep(project.svgClips),
  };
}

function appendExpanded(project: Project, expanded: ExpandedGraphic): Project {
  return {
    ...project,
    textClips: [...(project.textClips ?? []), ...expanded.textClips],
    shapeClips: [...(project.shapeClips ?? []), ...expanded.shapeClips],
    svgClips: [...(project.svgClips ?? []), ...expanded.svgClips],
  };
}

/** Replace an instance record and regenerate its member clips. */
export function commitGraphicInstance(project: Project, instance: GraphicInstance): Project {
  const exists = project.graphicInstances?.some((item) => item.id === instance.id) ?? false;
  const list = exists
    ? (project.graphicInstances ?? []).map((item) => (item.id === instance.id ? instance : item))
    : [...(project.graphicInstances ?? []), instance];
  const stripped = stripMembers({ ...project, graphicInstances: list }, new Set([instance.id]));
  const withMembers = appendExpanded(stripped, expandGraphicInstance(instance, project.settings));
  return { ...withMembers, modifiedAt: Date.now() };
}

/**
 * Keep instances in step with generic timeline edits (sync lock, ripple, track
 * moves) that shift member clips without knowing about instances. Conservative by
 * design: it never deletes an instance or a clip (undo of a track delete restores
 * the clips and must find the instance still there). When the instance's members
 * moved/trimmed together the instance adopts their span; when they disagree the
 * instance wins and its members are regenerated. Cheap no-op without graphics.
 */
export function reconcileGraphicInstances(project: Project): Project {
  const instances = project.graphicInstances;
  if (!instances?.length) return project;
  const byId = new Map<string, TextClip | ShapeClip | SVGClip>();
  for (const list of [project.textClips, project.shapeClips, project.svgClips] as const) {
    for (const clip of list ?? []) if (memberOf(clip)) byId.set(clip.id, clip);
  }
  let next = project;
  let changed = false;
  const kept = instances.map((instance) => {
    const expected = expectedMemberIds(instance, project.settings);
    const own = [...expected].map((id) => byId.get(id)).filter((clip): clip is TextClip | ShapeClip | SVGClip => !!clip);
    if (own.length === 0) return instance;
    const first = own[0];
    const together = own.every((clip) => clip.startTime === first.startTime && clip.duration === first.duration && clip.trackId === first.trackId);
    const inSync = together && first.startTime === instance.startTime && first.duration === instance.duration && first.trackId === instance.trackId;
    if (inSync && own.length === expected.size) return instance;
    const adopted: GraphicInstance = together
      ? {
        ...instance,
        startTime: Math.max(0, first.startTime),
        trackId: first.trackId,
        duration: clampGraphicDuration(instance.template, first.duration),
      }
      : instance;
    next = stripMembers(next, new Set([instance.id]));
    next = appendExpanded(next, expandGraphicInstance(adopted, project.settings));
    changed = true;
    return adopted;
  });
  return changed ? { ...next, graphicInstances: kept } : project;
}

// ---------------------------------------------------------------------------
// Authoring entry points
// ---------------------------------------------------------------------------

function makeTrack(project: Project): Track {
  const count = project.timeline.tracks.filter((track) => track.name.startsWith("Graphics")).length;
  return {
    id: newId("track"),
    type: "graphics",
    mode: "standard",
    role: "general",
    name: `Graphics ${count + 1}`,
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
}

/** A track that can host the span: unlocked, graphics-only, and free. */
function findFreeGraphicsTrack(project: Project, start: number, duration: number, excludeIds: readonly string[] = []): Track | undefined {
  const excluded = new Set(excludeIds);
  return project.timeline.tracks.find((track) => {
    if (track.locked || track.type === "audio" || track.clips.length > 0) return false;
    return getTrackItems(project, track.id).every(
      (item) =>
        excluded.has(item.id) ||
        item.startTime >= start + duration - 1e-4 ||
        item.startTime + item.duration <= start + 1e-4,
    );
  });
}

export interface InsertGraphicOptions {
  readonly startTime: number;
  readonly duration?: number;
  readonly trackId?: string;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly name?: string;
}

export function insertGraphicTemplate(
  project: Project,
  template: GraphicTemplate,
  options: InsertGraphicOptions,
): GraphicEditResult {
  const checked = validateGraphicTemplate(template);
  if (!checked.ok) return fail(`Invalid graphic template: ${checked.errors[0]}`);
  const valid = checked.template;
  const startTime = Math.max(0, Number.isFinite(options.startTime) ? options.startTime : 0);
  const duration = clampGraphicDuration(valid, options.duration ?? valid.duration);
  let working = project;
  let trackId = options.trackId;
  if (trackId) {
    const track = project.timeline.tracks.find((item) => item.id === trackId);
    if (!track) return fail("That track does not exist.");
    if (track.locked) return fail("That track is locked.");
  } else {
    const free = findFreeGraphicsTrack(project, startTime, duration);
    if (free) trackId = free.id;
    else {
      const created = makeTrack(project);
      working = { ...project, timeline: { ...project.timeline, tracks: [created, ...project.timeline.tracks] } };
      trackId = created.id;
    }
  }
  const instance: GraphicInstance = {
    id: newId("graphic"),
    name: options.name?.trim() || valid.name,
    trackId,
    startTime,
    duration,
    template: valid,
    values: resolveParamValues(valid, options.values),
  };
  return { ok: true, project: commitGraphicInstance(working, instance), instanceId: instance.id };
}

export function setGraphicParameter(
  project: Project,
  instanceId: string,
  parameterId: string,
  value: unknown,
): GraphicEditResult {
  return setGraphicParameters(project, instanceId, { [parameterId]: value });
}

export function setGraphicParameters(
  project: Project,
  instanceId: string,
  updates: Readonly<Record<string, unknown>>,
): GraphicEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return fail("That graphic no longer exists.");
  const values: Record<string, GraphicParamValue> = { ...instance.values };
  for (const [id, raw] of Object.entries(updates)) {
    const parameter = instance.template.parameters.find((item) => item.id === id);
    if (!parameter) return fail(`This graphic has no control "${id}".`);
    const coerced = coerceParamValue(parameter, raw);
    if (coerced === undefined) return fail(`"${parameter.label}" does not accept that value.`);
    values[id] = coerced;
  }
  return { ok: true, project: commitGraphicInstance(project, { ...instance, values }), instanceId };
}

export function moveGraphic(
  project: Project,
  instanceId: string,
  target: { readonly startTime?: number; readonly trackId?: string },
): GraphicEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return fail("That graphic no longer exists.");
  const startTime = Math.max(0, target.startTime ?? instance.startTime);
  let trackId = target.trackId ?? instance.trackId;
  const track = project.timeline.tracks.find((item) => item.id === trackId);
  if (!track) return fail("That track does not exist.");
  if (track.locked) return fail("That track is locked.");
  const clash = getTrackItems(project, trackId).some((item) => {
    const owner = graphicInstanceOfClip(project, item.id);
    // Plain overlays may stack on one track; only another graphic's span collides.
    return owner !== undefined && owner.id !== instance.id &&
      item.startTime < startTime + instance.duration - 1e-4 &&
      item.startTime + item.duration > startTime + 1e-4;
  });
  if (clash) {
    const free = findFreeGraphicsTrack(project, startTime, instance.duration, [instance.id]);
    if (!free) return fail("There is no room for the graphic there.");
    trackId = free.id;
  }
  return { ok: true, project: commitGraphicInstance(project, { ...instance, startTime, trackId }), instanceId };
}

/**
 * Stretch or trim. The layers' in/out motion is anchored to the clip ends, so the
 * intro and outro keep their exact timing; only the hold between them changes.
 */
export function resizeGraphic(
  project: Project,
  instanceId: string,
  target: { readonly startTime?: number; readonly duration: number },
): GraphicEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return fail("That graphic no longer exists.");
  const minimum = protectedDurations(instance.template).minDuration;
  const end = instance.startTime + instance.duration;
  let startTime = target.startTime ?? instance.startTime;
  let duration = Math.max(minimum, target.duration);
  // Trimming the left edge keeps the right edge fixed unless the minimum bites.
  if (target.startTime !== undefined && target.startTime !== instance.startTime) {
    startTime = Math.max(0, Math.min(target.startTime, end - minimum));
    duration = Math.max(minimum, end - startTime);
  }
  return { ok: true, project: commitGraphicInstance(project, { ...instance, startTime, duration }), instanceId };
}

export function removeGraphic(project: Project, instanceId: string): GraphicEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return fail("That graphic no longer exists.");
  const stripped = stripMembers(project, new Set([instanceId]));
  const rest = (project.graphicInstances ?? []).filter((item) => item.id !== instanceId);
  return {
    ok: true,
    project: { ...stripped, graphicInstances: rest.length ? rest : undefined, modifiedAt: Date.now() },
  };
}

/** Replace the instance's embedded template (Essential Graphics > Edit). */
export function editGraphicTemplate(
  project: Project,
  instanceId: string,
  edit: (template: GraphicTemplate) => GraphicTemplate,
): GraphicEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return fail("That graphic no longer exists.");
  const edited = validateGraphicTemplate(edit(instance.template));
  if (!edited.ok) return fail(`That change is not valid: ${edited.errors[0]}`);
  const template = edited.template;
  const values = resolveParamValues(template, instance.values);
  const duration = clampGraphicDuration(template, instance.duration);
  return {
    ok: true,
    project: commitGraphicInstance(project, { ...instance, template, values, duration }),
    instanceId,
  };
}

/** Break a graphic into plain, independently editable clips. */
export function ungroupGraphic(project: Project, instanceId: string): GraphicEditResult {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return fail("That graphic no longer exists.");
  const release = <T extends Overlay>(list: T[] | undefined): T[] | undefined =>
    list?.map((clip) => {
      if (memberOf(clip) !== instanceId) return clip;
      const { [GRAPHIC_LAYER_MEMBER_KEY]: _owner, graphicLayerId: _layer, ...metadata } = clip.metadata ?? {};
      void _owner;
      void _layer;
      return { ...clip, metadata: Object.keys(metadata).length ? metadata : undefined };
    });
  const rest = (project.graphicInstances ?? []).filter((item) => item.id !== instanceId);
  return {
    ok: true,
    project: {
      ...project,
      textClips: release(project.textClips),
      shapeClips: release(project.shapeClips),
      svgClips: release(project.svgClips),
      graphicInstances: rest.length ? rest : undefined,
      modifiedAt: Date.now(),
    },
  };
}

/**
 * Snapshot an instance as a reusable template: its current parameter values and
 * (edited) layer stack become the new defaults.
 */
export function graphicInstanceToTemplate(
  instance: GraphicInstance,
  meta: { readonly name: string; readonly id?: string; readonly category?: GraphicTemplate["category"]; readonly description?: string; readonly tags?: readonly string[] },
): GraphicTemplate {
  const values = resolveParamValues(instance.template, instance.values);
  return {
    ...instance.template,
    id: meta.id ?? `custom-${crypto.randomUUID()}`,
    name: meta.name.trim() || instance.template.name,
    category: meta.category ?? "custom",
    description: meta.description ?? instance.template.description,
    tags: meta.tags ?? instance.template.tags,
    duration: instance.duration,
    parameters: instance.template.parameters.map((parameter) => ({
      ...parameter,
      defaultValue: values[parameter.id] ?? parameter.defaultValue,
    })),
  };
}

/** Member clip ids for an instance, in layer order (used by tests and the agent). */
export function graphicMemberIds(instance: GraphicInstance): string[] {
  return instance.template.layers.map((layer) => graphicMemberId(instance.id, layer.id));
}
