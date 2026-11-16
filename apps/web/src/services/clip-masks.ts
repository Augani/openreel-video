import { createDefaultPath, shapeToPath, type ActionHistory, type Mask, type Project } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";

interface MaskEditScope { projectId: string; clipId: string; history: ActionHistory }
export type EditorMaskKind = "rectangle" | "ellipse" | "polygon" | "drawn" | "track-matte";
export function maskSources(project: Project, ownClipId: string): Array<{ id: string; label: string }> {
  const names = new Map(project.mediaLibrary.items.map(item => [item.id, item.name]));
  const sources = project.timeline.tracks.flatMap(track => track.clips.map(clip => ({ id: clip.id, label: `${track.name} • ${names.get(clip.mediaId) ?? clip.mediaId.slice(0, 8)}` })));
  sources.push(...(project.textClips ?? []).map(clip => ({ id: clip.id, label: `Text • "${clip.text.slice(0, 20)}${clip.text.length > 20 ? "…" : ""}"` })),
    ...(project.shapeClips ?? []).map(clip => ({ id: clip.id, label: `Shape • ${clip.shapeType}` })),
    ...(project.svgClips ?? []).map(clip => ({ id: clip.id, label: `SVG • ${clip.id.slice(0, 8)}` })),
    ...(project.stickerClips ?? []).map(clip => ({ id: clip.id, label: `Sticker • ${clip.name ?? clip.id.slice(0, 8)}` })));
  const seen = new Set([ownClipId]);
  return sources.filter(source => { if (seen.has(source.id)) return false; seen.add(source.id); return true; });
}
export function createEditorMask(clipId: string, kind: EditorMaskKind, sourceClipId = ""): Mask {
  const path = kind === "rectangle" ? shapeToPath({ type: "rectangle", x: .25, y: .25, width: .5, height: .5 })
    : kind === "ellipse" ? shapeToPath({ type: "ellipse", cx: .5, cy: .5, rx: .25, ry: .25 })
    : kind === "polygon" ? shapeToPath({ type: "polygon", points: [{ x: .5, y: .2 }, { x: .8, y: .5 }, { x: .5, y: .8 }, { x: .2, y: .5 }] })
    : kind === "drawn" ? { closed: true, points: [{ x: .5, y: .16 }, { x: .78, y: .28 }, { x: .84, y: .58 }, { x: .62, y: .82 }, { x: .28, y: .76 }, { x: .16, y: .42 }] }
    : createDefaultPath();
  return { id: crypto.randomUUID(), clipId, type: kind === "drawn" || kind === "track-matte" ? kind : "shape", path,
    feathering: 0, expansion: 0, opacity: 1, inverted: false, keyframes: [], ...(kind === "track-matte" ? { sourceClipId, matteSource: "bounds" as const } : {}) };
}
export function duplicateEditorMask(mask: Mask): Mask {
  const copy = structuredClone(mask);
  return { ...copy, id: crypto.randomUUID(), keyframes: copy.keyframes.map(key => ({ ...key, id: crypto.randomUUID() })) };
}

/** Edit the saved masks; the shared raster engine is a cache, never the form's owner. */
export async function editClipMasks(scope: MaskEditScope, update: (masks: readonly Mask[], project: Project) => readonly Mask[]): Promise<boolean> {
  const state = useProjectStore.getState(), project = state.project;
  const track = project.timeline.tracks.find(candidate => candidate.clips.some(clip => clip.id === scope.clipId));
  if (!state.hasOpenProject || project.id !== scope.projectId || state.actionHistory !== scope.history || !track || track.locked
    || useUIStore.getState().exportState.isExporting || useUIStore.getState().effectApplicationClipId !== null || useTimelineStore.getState().playbackLockedReason) return false;
  const current = (project.masks ?? []).filter(mask => mask.clipId === scope.clipId), next = update(current, project);
  if (next.length === current.length && next.every((mask, index) => mask === current[index])) return false;
  const ids = new Set<string>();
  for (const mask of next) {
    if (mask.clipId !== scope.clipId || ids.has(mask.id) || ![mask.feathering, mask.expansion, mask.opacity].every(Number.isFinite)
      || mask.feathering < 0 || mask.feathering > 100 || mask.expansion < -100 || mask.expansion > 100 || mask.opacity < 0 || mask.opacity > 1) return false;
    ids.add(mask.id);
  }
  const nextById = new Map(next.map(mask => [mask.id, mask]));
  const all = (project.masks ?? []).flatMap(mask => mask.clipId !== scope.clipId ? [mask] : nextById.has(mask.id) ? [nextById.get(mask.id)!] : []);
  const priorIds = new Set(current.map(mask => mask.id));
  all.push(...next.filter(mask => !priorIds.has(mask.id)));
  const discrete = scope.history.getCurrentGroupId() === null;
  if (discrete) scope.history.beginGroup("Edit mask");
  let result;
  try { result = state.actionExecutor.execute({ type: "mask/setAll", id: crypto.randomUUID(), timestamp: Date.now(), params: { masks: all } }, project); }
  finally { if (discrete) scope.history.endGroup(); }
  if (!(await result).success) throw new Error("The mask change could not be saved");
  const fresh = useProjectStore.getState();
  if (fresh.project.id !== scope.projectId || fresh.actionHistory !== scope.history) return false;
  useProjectStore.setState({ project: { ...fresh.project, masks: project.masks, modifiedAt: Date.now() } });
  try {
    const engine = await useEngineStore.getState().getMaskEngine(), latest = useProjectStore.getState();
    if (latest.project.id === scope.projectId && latest.actionHistory === scope.history) engine.loadMasks(latest.project.masks ?? []);
  } catch (error) { console.warn("[Masks] Could not refresh the raster cache", error); }
  return useProjectStore.getState().actionHistory === scope.history;
}
