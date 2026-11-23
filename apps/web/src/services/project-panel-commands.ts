import { v4 as uuidv4 } from "uuid";
import {
  binDeletionImpact,
  binSubtreeIds,
  binsOf,
  parseKeywordText,
  createSubclipItem,
  resolveSubclipParent,
  smartBinsOf,
  uniqueBinName,
  uniqueSmartBinName,
  type ClipLabelPatch,
  type EditableTextColumn,
  type FieldOrder,
  type DeinterlaceMode,
  type FootageColorPreset,
  type SmartBin,
  type MediaBin,
  type MediaItem,
  type MediaItemPatch,
  type MediaLabelId,
  type MediaOrganizeParams,
  type RawSourceSettings,
  type VrProperties,
  normalizeInterpretation,
  normalizeRawSettings,
  rawSettingsEqual,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { useProjectPanelStore } from "../stores/project-panel-store";
import { useSourceMonitorStore } from "../stores/source-monitor-store";
import { toast } from "../stores/notification-store";
import type { CommandOutcome } from "./premiere-edit-commands";

/**
 * Project-panel commands. Every project change is exactly one `media/organize`
 * action (one undo step), the same action the agent tools dispatch.
 */

const fail = (message: string): CommandOutcome => ({ success: false, message });

export async function organize(params: MediaOrganizeParams): Promise<CommandOutcome> {
  const result = await useProjectStore.getState().executeAction({
    type: "media/organize",
    id: uuidv4(),
    timestamp: Date.now(),
    params: params as unknown as Record<string, unknown>,
  });
  return result.success ? { success: true } : fail(result.error?.message ?? "The change failed.");
}

/** Surface a failed command as a toast; returns whether it succeeded. */
export async function runOrganize(title: string, command: Promise<CommandOutcome>): Promise<boolean> {
  const outcome = await command;
  if (!outcome.success) toast.warning(title, outcome.message);
  return outcome.success;
}

const project = () => useProjectStore.getState().project;

/** Selected media ids, in library order. */
export function selectedMediaIds(): string[] {
  const library = new Set(project().mediaLibrary.items.map((i) => i.id));
  const picked = new Set(useUIStore.getState().selectedItems.map((s) => s.id).filter((id) => library.has(id)));
  return project().mediaLibrary.items.filter((i) => picked.has(i.id)).map((i) => i.id);
}

export async function createBin(
  options: { name?: string; parentId?: string | null; mediaIds?: string[]; label?: MediaLabelId } = {},
): Promise<{ outcome: CommandOutcome; binId?: string }> {
  const bins = binsOf(project());
  const parentId = options.parentId ?? undefined;
  const mediaIds = options.mediaIds ?? [];
  const bin: MediaBin = {
    id: uuidv4(),
    name: uniqueBinName(bins, parentId, options.name?.trim() || "Bin"),
    ...(parentId ? { parentId } : {}),
    ...(options.label ? { label: options.label } : {}),
  };
  const itemPatches: Record<string, MediaItemPatch> = {};
  for (const id of mediaIds) itemPatches[id] = { binId: bin.id };
  const outcome = await organize({
    label: mediaIds.length ? "New bin from selection" : "New bin",
    bins: [...bins, bin],
    ...(mediaIds.length ? { itemPatches } : {}),
  });
  return { outcome, binId: outcome.success ? bin.id : undefined };
}

export async function newBinFromSelection(): Promise<void> {
  const ids = selectedMediaIds();
  if (!ids.length) {
    toast.info("New bin from selection", "Select media first.");
    return;
  }
  useProjectPanelStore.getState().setPendingBin({ parentId: useProjectPanelStore.getState().currentBinId, mediaIds: ids });
}

/** Create the bin being named in the pending row (one undo step, name included). */
export async function commitPendingBin(name: string): Promise<void> {
  const pending = useProjectPanelStore.getState().pendingBin;
  useProjectPanelStore.getState().setPendingBin(null);
  if (!pending) return;
  const { outcome } = await createBin({ name, parentId: pending.parentId, mediaIds: pending.mediaIds });
  if (!outcome.success) toast.warning(pending.mediaIds.length ? "New bin from selection" : "New bin", outcome.message);
}

export function createBinHere(): void {
  useProjectPanelStore.getState().setPendingBin({ parentId: useProjectPanelStore.getState().currentBinId, mediaIds: [] });
}

export function renameBin(binId: string, name: string): Promise<CommandOutcome> {
  const trimmed = name.trim();
  const bins = binsOf(project());
  const bin = bins.find((b) => b.id === binId);
  if (!bin || !trimmed || trimmed === bin.name) return Promise.resolve({ success: true });
  return organize({
    label: "Rename bin",
    bins: bins.map((b) => (b.id === binId ? { ...b, name: trimmed } : b)),
  });
}

/** Move media and/or bins into a bin (null = project root). */
export function moveToBin(
  mediaIds: readonly string[],
  binIds: readonly string[],
  destination: string | null,
): Promise<CommandOutcome> {
  const state = project();
  const bins = binsOf(state);
  const dest = destination ?? undefined;
  if (dest && !bins.some((b) => b.id === dest)) return Promise.resolve(fail("That bin no longer exists."));
  const movableBins = binIds.filter((id) => !dest || !binSubtreeIds(bins, id).has(dest));
  if (binIds.length && !movableBins.length && !mediaIds.length)
    return Promise.resolve(fail("A bin cannot be moved into itself."));
  const itemPatches: Record<string, MediaItemPatch> = {};
  for (const id of mediaIds) {
    const item = state.mediaLibrary.items.find((i) => i.id === id);
    if (item && (item.binId ?? undefined) !== dest) itemPatches[id] = { binId: dest ?? null };
  }
  const moving = new Set(movableBins);
  const nextBins = bins.map((b) => {
    if (!moving.has(b.id) || (b.parentId ?? undefined) === dest) return b;
    const { parentId: _parent, ...rest } = b;
    void _parent;
    return dest ? { ...rest, parentId: dest } : rest;
  });
  const binsChanged = nextBins.some((b, i) => b !== bins[i]);
  if (!Object.keys(itemPatches).length && !binsChanged) return Promise.resolve({ success: true });
  return organize({
    label: "Move to bin",
    ...(binsChanged ? { bins: nextBins } : {}),
    ...(Object.keys(itemPatches).length ? { itemPatches } : {}),
  });
}

export function deleteBinWithContents(binId: string): Promise<CommandOutcome> {
  const state = project();
  const impact = binDeletionImpact(state, binId);
  const doomed = new Set(impact.binIds);
  return organize({
    label: "Delete bin",
    bins: binsOf(state).filter((b) => !doomed.has(b.id)),
    removeItemIds: impact.mediaIds,
    removeClips: true,
  });
}

export function setMediaLabel(mediaIds: readonly string[], label: MediaLabelId | null): Promise<CommandOutcome> {
  const itemPatches: Record<string, MediaItemPatch> = {};
  for (const id of mediaIds) itemPatches[id] = { label };
  return organize({ label: "Set label", itemPatches });
}

export function setBinLabel(binId: string, label: MediaLabelId | null): Promise<CommandOutcome> {
  return organize({
    label: "Set label",
    bins: binsOf(project()).map((b) => {
      if (b.id !== binId) return b;
      const { label: _old, ...rest } = b;
      void _old;
      return label ? { ...rest, label } : rest;
    }),
  });
}

/** Label timeline clips; "inherit" goes back to following the media label. */
export function setClipLabel(clipIds: readonly string[], label: MediaLabelId | null | "inherit"): Promise<CommandOutcome> {
  const clipLabels: Record<string, ClipLabelPatch> = {};
  for (const id of clipIds) clipLabels[id] = label;
  return organize({ label: "Set clip label", clipLabels });
}

const TEXT_UNDO_LABELS: Record<EditableTextColumn, string> = {
  comment: "Edit comment",
  description: "Edit description",
  scene: "Edit scene",
  shot: "Edit shot",
  take: "Edit take",
  keywords: "Edit keywords",
  logComment: "Edit log comment",
  reel: "Edit reel",
};

export function setMediaText(mediaId: string, field: EditableTextColumn, value: string): Promise<CommandOutcome> {
  const item = project().mediaLibrary.items.find((i) => i.id === mediaId);
  if (field === "keywords") {
    const words = parseKeywordText(value);
    if (!item || (item.keywords ?? []).join("\u0000") === words.join("\u0000")) return Promise.resolve({ success: true });
    return organize({ label: TEXT_UNDO_LABELS.keywords, itemPatches: { [mediaId]: { keywords: words } } });
  }
  const next = field === "comment" || field === "description" || field === "logComment" ? value : value.trim();
  if (!item || (item[field] ?? "") === next) return Promise.resolve({ success: true });
  return organize({ label: TEXT_UNDO_LABELS[field], itemPatches: { [mediaId]: { [field]: next } } });
}

/** What the Interpret Footage dialog edited; a missing key is left alone, null clears (frame rate: back to the file's own). */
export interface FootageInterpretEdit {
  frameRate?: number | null;
  pixelAspectRatio?: number | null;
  fieldOrder?: FieldOrder | null;
  deinterlace?: DeinterlaceMode | null;
  color?: FootageColorPreset | null;
  /** Also retime clips already on the timeline when the frame rate changes. Default true. */
  retimeClips?: boolean;
}

/**
 * "Interpret footage": frame rate / pixel aspect / field order for video items and the colour
 * interpretation, as ONE `media/organize` action (one undo step). Only the edited fields are sent, merged
 * into each item's own existing interpretation and normalised against that item's own metadata, and items
 * the edit would not change are skipped, so no no-op undo entries and no clobbered overrides.
 */
export function applyFootageInterpretation(mediaIds: readonly string[], edit: FootageInterpretEdit): Promise<CommandOutcome> {
  const items = project().mediaLibrary.items;
  const itemPatches: Record<string, MediaItemPatch> = {};
  const touchesTiming = edit.frameRate !== undefined || edit.pixelAspectRatio !== undefined || edit.fieldOrder !== undefined || edit.deinterlace !== undefined;
  for (const id of mediaIds) {
    const item = items.find((i) => i.id === id);
    if (!item) continue;
    const patch: MediaItemPatch = {};
    if (touchesTiming && item.type === "video") {
      const merged: { frameRate?: number; pixelAspectRatio?: number; fieldOrder?: FieldOrder; deinterlace?: DeinterlaceMode } = { ...(item.interpretation ?? {}) };
      for (const key of ["frameRate", "pixelAspectRatio", "fieldOrder", "deinterlace"] as const) {
        const value = edit[key];
        if (value === undefined) continue;
        if (value === null) delete merged[key];
        else (merged as Record<string, unknown>)[key] = value;
      }
      const next = normalizeInterpretation(merged, item.metadata);
      if (JSON.stringify(next ?? null) !== JSON.stringify(item.interpretation ?? null)) patch.interpretation = next ?? null;
    }
    if (edit.color !== undefined && item.type !== "audio" && (item.colorInterpretation ?? null) !== edit.color) patch.colorInterpretation = edit.color;
    if (Object.keys(patch).length) itemPatches[id] = patch;
  }
  if (!Object.keys(itemPatches).length) return Promise.resolve({ success: true });
  return organize({
    label: "Interpret footage",
    itemPatches,
    ...(edit.retimeClips !== false && Object.values(itemPatches).some((p) => p.interpretation !== undefined) ? { retimeClips: true } : {}),
  });
}

/**
 * Immersive video: the VR properties a clip's source is read with (projection, frame layout, captured view). One
 * `media/organize` action, so one undo step; null clears the override and goes back to what the file says.
 */
export function setMediaVrProperties(mediaIds: readonly string[], vr: VrProperties | null): Promise<CommandOutcome> {
  const items = project().mediaLibrary.items;
  const itemPatches: Record<string, MediaItemPatch> = {};
  for (const id of mediaIds) {
    const item = items.find((i) => i.id === id);
    if (!item || (item.type !== "video" && item.type !== "image")) continue;
    if (JSON.stringify(item.vrProperties ?? null) === JSON.stringify(vr)) continue;
    itemPatches[id] = { vrProperties: vr };
  }
  if (!Object.keys(itemPatches).length) return Promise.resolve({ success: true });
  return organize({ label: "VR properties", itemPatches });
}

/**
 * RAW Source Settings of a camera RAW still: white balance, exposure, highlight recovery, demosaic quality
 * and output colour space. One `media/organize` action, so one undo step however many fields changed.
 */
export function setRawSourceSettings(mediaId: string, settings: Partial<RawSourceSettings>): Promise<CommandOutcome> {
  const item = project().mediaLibrary.items.find((i) => i.id === mediaId);
  if (!item?.raw?.settings) return Promise.resolve(fail("RAW Source Settings apply only to camera RAW stills that OpenReel develops (DNG)."));
  if (rawSettingsEqual(normalizeRawSettings(settings, item.raw.settings), item.raw.settings)) return Promise.resolve({ success: true });
  return organize({ label: "RAW Source Settings", itemPatches: { [mediaId]: { rawSettings: settings } } });
}

/** Mark media as good takes (or clear the flag). One undo step for the whole selection. */
export function setGoodTake(mediaIds: readonly string[], good: boolean): Promise<CommandOutcome> {
  const items = project().mediaLibrary.items;
  const itemPatches: Record<string, MediaItemPatch> = {};
  for (const id of mediaIds) {
    const item = items.find((i) => i.id === id);
    if (item && !!item.goodTake !== good) itemPatches[id] = { goodTake: good };
  }
  if (!Object.keys(itemPatches).length) return Promise.resolve({ success: true });
  return organize({ label: good ? "Mark good take" : "Clear good take", itemPatches });
}

/** Save a search as a smart bin (one undo step). */
export async function createSmartBin(options: {
  name?: string;
  query: string;
  column: SmartBin["column"];
}): Promise<{ outcome: CommandOutcome; smartBinId?: string }> {
  const existing = smartBinsOf(project());
  const query = options.query.trim();
  if (!query) return { outcome: fail("Type a search first.") };
  const bin: SmartBin = {
    id: uuidv4(),
    name: uniqueSmartBinName(existing, options.name?.trim() || "Smart bin"),
    query,
    column: options.column,
  };
  const outcome = await organize({ label: "New smart bin", smartBins: [...existing, bin] });
  return { outcome, smartBinId: outcome.success ? bin.id : undefined };
}

export function renameSmartBin(id: string, name: string): Promise<CommandOutcome> {
  const trimmed = name.trim();
  const existing = smartBinsOf(project());
  const bin = existing.find((b) => b.id === id);
  if (!bin || !trimmed || trimmed === bin.name) return Promise.resolve({ success: true });
  return organize({ label: "Rename smart bin", smartBins: existing.map((b) => (b.id === id ? { ...b, name: trimmed } : b)) });
}

export function deleteSmartBin(id: string): Promise<CommandOutcome> {
  const existing = smartBinsOf(project());
  if (!existing.some((b) => b.id === id)) return Promise.resolve({ success: true });
  return organize({ label: "Delete smart bin", smartBins: existing.filter((b) => b.id !== id) });
}

export function renameMediaItem(mediaId: string, name: string): Promise<CommandOutcome> {
  const item = project().mediaLibrary.items.find((i) => i.id === mediaId);
  const trimmed = name.trim();
  if (!item || !trimmed || trimmed === item.name) return Promise.resolve({ success: true });
  return organize({ label: "Rename media", itemPatches: { [mediaId]: { name: trimmed } } });
}

export function setSubclipRestrictTrims(mediaId: string, restrict: boolean): Promise<CommandOutcome> {
  return organize({ label: "Restrict trims", itemPatches: { [mediaId]: { subclipRestrictTrims: restrict } } });
}

export async function makeSubclip(
  mediaId: string,
  range: { inPoint: number; outPoint: number },
  options: { name?: string; restrictTrims?: boolean } = {},
): Promise<CommandOutcome & { subclip?: MediaItem }> {
  const items = project().mediaLibrary.items;
  const parent = items.find((i) => i.id === mediaId);
  if (!parent) return fail("Media not found.");
  let subclip: MediaItem;
  try {
    subclip = createSubclipItem(items, parent, { id: uuidv4(), ...range, ...options });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not make the subclip.");
  }
  const outcome = await organize({ label: "Make subclip", addItems: [subclip] });
  return outcome.success ? { success: true, message: `Subclip "${subclip.name}" created`, subclip } : outcome;
}

/** Make Subclip from the Source monitor's In/Out marks (whole clip when unmarked). */
export async function makeSubclipFromSource(
  options: { restrictTrims?: boolean } = {},
  mediaId?: string,
): Promise<CommandOutcome & { subclip?: MediaItem }> {
  const source = useSourceMonitorStore.getState();
  const id = mediaId ?? source.mediaId;
  if (!id) return fail("Open a clip in the Source monitor first.");
  const media = project().mediaLibrary.items.find((i) => i.id === id);
  if (!media) return fail("Media not found.");
  const marks = source.getMarks(media.id);
  const full = media.metadata.duration;
  const inPoint = marks.in ?? media.subclip?.inPoint ?? 0;
  const outPoint = marks.out ?? media.subclip?.outPoint ?? full;
  if (!(outPoint > inPoint)) return fail("Mark an In and an Out point first.");
  return makeSubclip(media.id, { inPoint, outPoint }, options);
}

/** Make Subclip from a timeline clip's current source window. */
export async function makeSubclipFromClip(clipId: string): Promise<CommandOutcome & { subclip?: MediaItem }> {
  const state = project();
  const clip = state.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!clip) return fail("Clip not found.");
  const media = state.mediaLibrary.items.find((i) => i.id === clip.mediaId);
  if (!media) return fail("The clip's media is missing.");
  if (media.type === "image") return fail("Still images cannot be subclipped.");
  const root = resolveSubclipParent(state.mediaLibrary.items, media);
  return makeSubclip(root.id, { inPoint: clip.inPoint, outPoint: clip.outPoint });
}

/** Show a media item in the Project panel (switches to it, opens its bin, selects it). */
export function revealMediaInProject(mediaId: string): CommandOutcome {
  const item = project().mediaLibrary.items.find((i) => i.id === mediaId);
  if (!item) return fail("The clip's media is not in the project.");
  useEditorWorkspaceStore.getState().setSection("media");
  useProjectPanelStore.getState().requestReveal(mediaId, item.binId ?? null);
  useUIStore.getState().select({ type: "clip", id: mediaId });
  return { success: true };
}

export function revealClipInProject(clipId: string): CommandOutcome {
  const clip = project().timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!clip) return fail("Clip not found.");
  return revealMediaInProject(clip.mediaId);
}
