import type { Action, ValidationResult } from "../../types/actions";
import type { DesktopIngestConfig, IngestPreset, MediaBin, MediaItem, MediaLabelId, MediaProxyRef, Project, SmartBin } from "../../types/project";
import type { Clip } from "../../types/timeline";
import { isDesktopIngestConfig as isValidDesktopIngest } from "../../media/desktop-ingest";
import { isFootageColorPreset, type FootageColorPreset } from "../../color/source-color";
import { normalizeRawSettings, type RawSourceSettings } from "../../raw/settings";
import { interpretationSpeed, normalizeInterpretation, validateInterpretation, type FootageInterpretation } from "../../media/interpretation";
import { isMediaColumnId, isMediaLabelId } from "../../media/bins";
import { registerActionHandler, createInverseAction } from "../registry";

/**
 * `media/organize`: every project-panel change (bins, label colours, comments,
 * subclips, bin deletion) as ONE undoable action. The inverse is computed from
 * the pre-state, so a single undo restores bins, item fields, clip labels,
 * removed items and the clips that used them together.
 */

/** Per-item field changes. `null` clears binId / label; "" clears text. */
export interface MediaItemPatch {
  binId?: string | null;
  label?: MediaLabelId | null;
  comment?: string;
  description?: string;
  /** Logging metadata; "" clears. */
  scene?: string;
  shot?: string;
  take?: string;
  /** false clears the flag. */
  goodTake?: boolean;
  name?: string;
  /** "Interpret footage": a preset id, or null for "as tagged". */
  colorInterpretation?: FootageColorPreset | null;
  /** "Interpret footage": frame rate / pixel aspect ratio / field order override; null clears it. */
  interpretation?: FootageInterpretation | null;
  /** RAW Source Settings of a camera RAW still (a full or partial settings object; clamped). */
  rawSettings?: Partial<RawSourceSettings>;
  subclipRestrictTrims?: boolean;
  /** Attach / replace a proxy reference; null detaches it. */
  proxy?: MediaProxyRef | null;
  /** Desktop copy-to-project: point the item at the copy. */
  sourceFile?: MediaItem["sourceFile"];
  /** Desktop copy-to-project provenance; null clears it. */
  copiedFrom?: MediaItem["copiedFrom"] | null;
}

export interface ClipTiming {
  startTime: number;
  duration: number;
  /** null removes the clip's speed. */
  speed: number | null;
}

/** Items (by id) that placed clips read through: the item itself, and subclips of an item share its footage. */
function interpretedSpeedAfter(item: MediaItem, patch: MediaItemPatch): number {
  if (patch.interpretation === undefined) return interpretationSpeed(item);
  const normalized = patch.interpretation === null ? undefined : normalizeInterpretation(patch.interpretation, item.metadata);
  return interpretationSpeed({ metadata: item.metadata, interpretation: normalized });
}

/** Retimed clip timings for a frame-rate interpretation change, keyed by clip id; empty when nothing changes. */
export function computeRetimeTimings(project: Project, patches: Record<string, MediaItemPatch>): Record<string, ClipTiming> {
  const ratios = new Map<string, number>();
  for (const item of project.mediaLibrary.items) {
    const patch = patches[item.id];
    if (!patch || patch.interpretation === undefined) continue;
    const ratio = interpretedSpeedAfter(item, patch) / interpretationSpeed(item);
    if (Math.abs(ratio - 1) > 1e-9) ratios.set(item.id, ratio);
  }
  const out: Record<string, ClipTiming> = {};
  if (!ratios.size) return out;
  for (const track of project.timeline.tracks) {
    // Ripple: later clips on the track move by however much the retimed clips before them grew or shrank.
    const ordered = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    let shift = 0;
    for (const clip of ordered) {
      const ratio = ratios.get(clip.mediaId) ?? 1;
      const duration = ratio === 1 ? clip.duration : clip.duration / ratio;
      const startTime = Math.max(0, clip.startTime + shift);
      shift += duration - clip.duration;
      if (ratio === 1 && startTime === clip.startTime) continue;
      const speed = ratio === 1 ? (clip.speed ?? null) : (clip.speed ?? 1) * ratio;
      out[clip.id] = { startTime, duration, speed: speed === 1 ? null : speed };
    }
  }
  return out;
}

/** Clip label change: a label id, null (explicitly none) or "inherit". */
export type ClipLabelPatch = MediaLabelId | null | "inherit";

export interface MediaOrganizeParams {
  /** Undo-history label. */
  label?: string;
  /** Replace the whole bin tree. */
  bins?: MediaBin[];
  /** Replace the whole smart-bin list. */
  smartBins?: SmartBin[];
  /** Project default ingest preset; null clears it. */
  ingestPreset?: IngestPreset | null;
  /** Desktop ingest settings (replaces the current ones; send the full object); null clears them. */
  desktopIngest?: DesktopIngestConfig | null;
  itemPatches?: Record<string, MediaItemPatch>;
  /**
   * "Interpret footage": retime the clips already on the timeline that use an item whose frame-rate
   * interpretation changes (speed and duration follow the conform; later clips on the track are pushed
   * right only as far as needed to avoid an overlap). Undone together with the patch.
   */
  retimeClips?: boolean;
  /** Inverse-only: put clips back to these timings. */
  clipTimings?: Record<string, ClipTiming>;
  clipLabels?: Record<string, ClipLabelPatch>;
  /** Items to append (subclips). */
  addItems?: MediaItem[];
  /** Items to remove; with removeClips, clips that use them go too. */
  removeItemIds?: string[];
  removeClips?: boolean;
  /** Inverse-only: put removed items / clips back where they were. */
  restoreItems?: Array<{ index: number; item: MediaItem }>;
  restoreClips?: Array<{ trackId: string; index: number; clip: Clip }>;
  /** Inverse-only: whether `bins` was originally absent. */
  clearBins?: boolean;
  /** Inverse-only: whether `smartBins` was originally absent. */
  clearSmartBins?: boolean;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const fail = (message: string, code = "INVALID_PARAMS"): ValidationResult => ({
  valid: false,
  errors: [{ code, message }],
});

function validate(action: Action, project: Project): ValidationResult {
  const p = action.params as MediaOrganizeParams;
  const itemIds = new Set(project.mediaLibrary.items.map((i) => i.id));
  const finalBins = p.bins ?? project.bins ?? [];
  if (p.bins) {
    const ids = new Set<string>();
    for (const bin of p.bins) {
      if (!bin || typeof bin.id !== "string" || !bin.id) return fail("Every bin needs an id.");
      if (ids.has(bin.id)) return fail(`Duplicate bin id: ${bin.id}`);
      ids.add(bin.id);
      if (typeof bin.name !== "string" || !bin.name.trim()) return fail("A bin needs a name.");
      if (bin.label !== undefined && !isMediaLabelId(bin.label)) return fail("Unknown bin label.");
    }
    for (const bin of p.bins) {
      if (bin.parentId && !ids.has(bin.parentId)) return fail("A bin's parent does not exist.");
      const chain = new Set<string>([bin.id]);
      let cursor: MediaBin | undefined = bin;
      while (cursor?.parentId) {
        if (chain.has(cursor.parentId)) return fail("A bin cannot be moved into itself.");
        chain.add(cursor.parentId);
        const parentId: string = cursor.parentId;
        cursor = p.bins.find((b) => b.id === parentId);
      }
    }
  }
  if (p.ingestPreset !== undefined && p.ingestPreset !== null && !["none", "proxies", "copy"].includes(p.ingestPreset))
    return fail("Unknown ingest preset.");
  if (p.desktopIngest && !isValidDesktopIngest(p.desktopIngest)) return fail("Invalid desktop ingest settings.");
  for (const [id, patch] of Object.entries(p.itemPatches ?? {})) {
    const proxy = patch.proxy;
    if (!proxy) continue;
    if (!itemIds.has(id)) return fail(`Media not found: ${id}`);
    if (!proxy.path || !(proxy.width > 0) || !(proxy.height > 0)) return fail("A proxy needs a path and positive dimensions.");
  }
  if (p.smartBins) {
    const ids = new Set<string>();
    for (const bin of p.smartBins) {
      if (!bin || typeof bin.id !== "string" || !bin.id) return fail("Every smart bin needs an id.");
      if (ids.has(bin.id)) return fail(`Duplicate smart bin id: ${bin.id}`);
      ids.add(bin.id);
      if (typeof bin.name !== "string" || !bin.name.trim()) return fail("A smart bin needs a name.");
      if (typeof bin.query !== "string" || !bin.query.trim()) return fail("A smart bin needs a search query.");
      if (bin.column !== "all" && !isMediaColumnId(bin.column)) return fail("Unknown smart bin column.");
    }
  }
  const binIds = new Set(finalBins.map((b) => b.id));
  for (const [id, patch] of Object.entries(p.itemPatches ?? {})) {
    if (!itemIds.has(id) && !(p.addItems ?? []).some((i) => i.id === id))
      return fail(`Media not found: ${id}`, "MEDIA_NOT_FOUND");
    if (typeof patch.binId === "string" && !binIds.has(patch.binId))
      return fail(`Bin not found: ${patch.binId}`, "BIN_NOT_FOUND");
    if (patch.label != null && !isMediaLabelId(patch.label)) return fail("Unknown label colour.");
    if (patch.name !== undefined && !patch.name.trim()) return fail("A media name cannot be empty.");
    if (patch.colorInterpretation != null && !isFootageColorPreset(patch.colorInterpretation))
      return fail("Unknown footage colour interpretation.");
    if (patch.interpretation) {
      const target = project.mediaLibrary.items.find((i) => i.id === id);
      if (target && target.type !== "video") return fail("Frame rate, pixel aspect ratio and field order apply to video footage only.", "INVALID_PARAMS");
      const bad = validateInterpretation(patch.interpretation);
      if (bad) return fail(bad, "INVALID_PARAMS");
    }
    if (patch.rawSettings !== undefined) {
      const target = project.mediaLibrary.items.find((i) => i.id === id);
      if (!target?.raw?.settings) return fail("RAW Source Settings apply only to camera RAW stills developed by OpenReel.", "INVALID_PARAMS");
    }
  }
  if (p.retimeClips && p.itemPatches) {
    const timings = computeRetimeTimings(project, p.itemPatches);
    for (const track of project.timeline.tracks)
      if (track.locked && track.clips.some((c) => timings[c.id]))
        return fail(`Unlock track "${track.name}" first: it has clips that use this media.`, "TRACK_LOCKED");
  }
  const clipIds = new Set(project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  for (const [id, label] of Object.entries(p.clipLabels ?? {})) {
    if (!clipIds.has(id)) return fail(`Clip not found: ${id}`, "CLIP_NOT_FOUND");
    if (label !== null && label !== "inherit" && !isMediaLabelId(label))
      return fail("Unknown label colour.");
  }
  for (const item of p.addItems ?? []) {
    if (!item?.id || itemIds.has(item.id)) return fail("Added media needs a new unique id.");
    if (typeof item.binId === "string" && !binIds.has(item.binId))
      return fail(`Bin not found: ${item.binId}`, "BIN_NOT_FOUND");
  }
  for (const id of p.removeItemIds ?? [])
    if (!itemIds.has(id)) return fail(`Media not found: ${id}`, "MEDIA_NOT_FOUND");
  if (p.removeClips && p.removeItemIds?.length) {
    // Removing clips is an edit: it must not reach into a locked track.
    const doomed = new Set(p.removeItemIds);
    for (const track of project.timeline.tracks)
      if (track.locked && track.clips.some((c) => doomed.has(c.mediaId)))
        return fail(`Unlock track "${track.name}" first: it has clips that use this media.`, "TRACK_LOCKED");
  }
  return { valid: true, errors: [] };
}

function patchItem(item: MediaItem, patch: MediaItemPatch): MediaItem {
  const next: Mutable<MediaItem> = { ...item };
  if (patch.binId !== undefined) {
    if (patch.binId === null) delete next.binId;
    else next.binId = patch.binId;
  }
  if (patch.label !== undefined) {
    if (patch.label === null) delete next.label;
    else next.label = patch.label;
  }
  if (patch.comment !== undefined) {
    if (patch.comment === "") delete next.comment;
    else next.comment = patch.comment;
  }
  if (patch.description !== undefined) {
    if (patch.description === "") delete next.description;
    else next.description = patch.description;
  }
  for (const field of ["scene", "shot", "take"] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === "") delete next[field];
    else next[field] = value;
  }
  if (patch.goodTake !== undefined) {
    if (patch.goodTake) next.goodTake = true;
    else delete next.goodTake;
  }
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.colorInterpretation !== undefined) {
    if (patch.colorInterpretation === null) delete next.colorInterpretation;
    else next.colorInterpretation = patch.colorInterpretation;
  }
  if (patch.interpretation !== undefined) {
    const normalized = patch.interpretation === null ? undefined : normalizeInterpretation(patch.interpretation, next.metadata);
    if (normalized) next.interpretation = normalized;
    else delete next.interpretation;
  }
  if (patch.rawSettings !== undefined && next.raw?.settings) {
    next.raw = { ...next.raw, settings: normalizeRawSettings(patch.rawSettings, next.raw.settings) };
  }
  if (patch.proxy !== undefined) {
    if (patch.proxy === null) delete next.proxy;
    else next.proxy = patch.proxy;
  }
  if ("sourceFile" in patch) {
    if (patch.sourceFile === undefined) delete next.sourceFile;
    else next.sourceFile = patch.sourceFile;
  }
  if (patch.copiedFrom !== undefined) {
    if (patch.copiedFrom === null) delete next.copiedFrom;
    else next.copiedFrom = patch.copiedFrom;
  }
  if (patch.subclipRestrictTrims !== undefined && next.subclip)
    next.subclip = { ...next.subclip, restrictTrims: patch.subclipRestrictTrims };
  return next;
}

function withClipLabel(clip: Clip, patch: ClipLabelPatch): Clip {
  const next: Mutable<Clip> = { ...clip };
  if (patch === "inherit") delete next.label;
  else next.label = patch;
  return next;
}

function withClipTiming(clip: Clip, timing: ClipTiming): Clip {
  const next: Mutable<Clip> = { ...clip, startTime: timing.startTime, duration: timing.duration };
  if (timing.speed === null) delete next.speed;
  else next.speed = timing.speed;
  return next;
}

function apply(action: Action, project: Project): void {
  const p = action.params as MediaOrganizeParams;
  const target = project as Mutable<Project>;

  if (p.bins) target.bins = structuredClone(p.bins);
  else if (p.clearBins) delete target.bins;
  if (p.smartBins) target.smartBins = structuredClone(p.smartBins);
  else if (p.clearSmartBins) delete target.smartBins;
  if (p.ingestPreset !== undefined) {
    const library = project.mediaLibrary as Mutable<Project["mediaLibrary"]>;
    if (p.ingestPreset === null) delete library.ingestPreset;
    else library.ingestPreset = p.ingestPreset;
  }
  if (p.desktopIngest !== undefined) {
    const library = project.mediaLibrary as Mutable<Project["mediaLibrary"]>;
    if (p.desktopIngest === null) delete library.desktopIngest;
    else library.desktopIngest = structuredClone(p.desktopIngest);
  }

  const timings = p.clipTimings ?? (p.retimeClips && p.itemPatches ? computeRetimeTimings(project, p.itemPatches) : undefined);
  let items = project.mediaLibrary.items;
  const removed = new Set(p.removeItemIds ?? []);
  if (removed.size) items = items.filter((i) => !removed.has(i.id));
  const patches = p.itemPatches;
  if (patches) items = items.map((i) => (patches[i.id] ? patchItem(i, patches[i.id]) : i));
  if (p.addItems?.length) {
    items = [...items, ...p.addItems.map((i) => (patches?.[i.id] ? patchItem(i, patches[i.id]) : i))];
  }
  if (p.restoreItems?.length) {
    const next = [...items];
    for (const { index, item } of [...p.restoreItems].sort((a, b) => a.index - b.index))
      next.splice(Math.min(index, next.length), 0, item);
    items = next;
  }
  if (items !== project.mediaLibrary.items)
    (project.mediaLibrary as Mutable<Project["mediaLibrary"]>).items = items;

  const labels = p.clipLabels;
  const retime = timings && Object.keys(timings).length ? timings : undefined;
  if (retime || labels || (p.removeClips && removed.size) || p.restoreClips?.length) {
    const timeline = project.timeline as Mutable<Project["timeline"]>;
    timeline.tracks = timeline.tracks.map((track) => {
      let clips = track.clips;
      if (p.removeClips && removed.size) clips = clips.filter((c) => !removed.has(c.mediaId));
      if (retime) clips = clips.map((c) => (retime[c.id] ? withClipTiming(c, retime[c.id]) : c));
      if (labels) clips = clips.map((c) => (labels[c.id] !== undefined ? withClipLabel(c, labels[c.id]) : c));
      const restores = (p.restoreClips ?? [])
        .filter((r) => r.trackId === track.id)
        .sort((a, b) => a.index - b.index);
      if (restores.length) {
        const next = [...clips];
        for (const r of restores) next.splice(Math.min(r.index, next.length), 0, r.clip);
        clips = next;
      }
      return clips === track.clips ? track : { ...track, clips };
    });
  }
  target.modifiedAt = Date.now();
}

function invert(action: Action, before: Project): Action {
  const p = action.params as MediaOrganizeParams;
  const inverse: MediaOrganizeParams = { label: `Undo ${p.label ?? "project panel change"}` };

  if (p.bins) {
    if (before.bins) inverse.bins = structuredClone([...before.bins]);
    else inverse.clearBins = true;
  }

  if (p.smartBins) {
    if (before.smartBins) inverse.smartBins = structuredClone([...before.smartBins]);
    else inverse.clearSmartBins = true;
  }

  if (p.ingestPreset !== undefined) inverse.ingestPreset = before.mediaLibrary.ingestPreset ?? null;
  if (p.desktopIngest !== undefined) inverse.desktopIngest = before.mediaLibrary.desktopIngest ? structuredClone(before.mediaLibrary.desktopIngest) : null;

  const beforeItems = new Map(before.mediaLibrary.items.map((i) => [i.id, i]));
  if (p.itemPatches) {
    const prior: Record<string, MediaItemPatch> = {};
    for (const [id, patch] of Object.entries(p.itemPatches)) {
      const item = beforeItems.get(id);
      if (!item) continue; // an added item: it is removed wholesale below
      const undo: MediaItemPatch = {};
      if ("binId" in patch) undo.binId = item.binId ?? null;
      if ("label" in patch) undo.label = item.label ?? null;
      if ("comment" in patch) undo.comment = item.comment ?? "";
      if ("description" in patch) undo.description = item.description ?? "";
      if ("scene" in patch) undo.scene = item.scene ?? "";
      if ("shot" in patch) undo.shot = item.shot ?? "";
      if ("take" in patch) undo.take = item.take ?? "";
      if ("goodTake" in patch) undo.goodTake = !!item.goodTake;
      if ("name" in patch) undo.name = item.name;
      if ("colorInterpretation" in patch) undo.colorInterpretation = item.colorInterpretation ?? null;
      if ("interpretation" in patch) undo.interpretation = item.interpretation ?? null;
      if ("rawSettings" in patch && item.raw?.settings) undo.rawSettings = item.raw.settings;
      if ("proxy" in patch) undo.proxy = item.proxy ?? null;
      if ("sourceFile" in patch) undo.sourceFile = item.sourceFile;
      if ("copiedFrom" in patch) undo.copiedFrom = item.copiedFrom ?? null;
      if ("subclipRestrictTrims" in patch && item.subclip)
        undo.subclipRestrictTrims = item.subclip.restrictTrims;
      prior[id] = undo;
    }
    if (Object.keys(prior).length) inverse.itemPatches = prior;
  }
  if (p.retimeClips && p.itemPatches) {
    const prior: Record<string, ClipTiming> = {};
    for (const id of Object.keys(computeRetimeTimings(before, p.itemPatches))) {
      for (const track of before.timeline.tracks) {
        const clip = track.clips.find((c) => c.id === id);
        if (clip) prior[id] = { startTime: clip.startTime, duration: clip.duration, speed: clip.speed ?? null };
      }
    }
    if (Object.keys(prior).length) inverse.clipTimings = prior;
  }
  if (p.clipLabels) {
    const priorLabels: Record<string, ClipLabelPatch> = {};
    for (const track of before.timeline.tracks)
      for (const clip of track.clips)
        if (p.clipLabels[clip.id] !== undefined)
          priorLabels[clip.id] = clip.label === undefined ? "inherit" : clip.label;
    inverse.clipLabels = priorLabels;
  }
  if (p.addItems?.length) inverse.removeItemIds = p.addItems.map((i) => i.id);
  if (p.removeItemIds?.length) {
    const doomed = new Set(p.removeItemIds);
    inverse.restoreItems = before.mediaLibrary.items
      .map((item, index) => ({ item, index }))
      .filter((entry) => doomed.has(entry.item.id))
      .map((entry) => ({ index: entry.index, item: entry.item }));
    if (p.removeClips) {
      const restoreClips: NonNullable<MediaOrganizeParams["restoreClips"]> = [];
      for (const track of before.timeline.tracks)
        track.clips.forEach((clip, index) => {
          if (doomed.has(clip.mediaId)) restoreClips.push({ trackId: track.id, index, clip });
        });
      inverse.restoreClips = restoreClips;
    }
  }
  return createInverseAction(action, "media/organize", inverse as Record<string, unknown>);
}

registerActionHandler({
  type: "media/organize",
  validate,
  apply(action, project) {
    apply(action, project);
  },
  invert,
});
