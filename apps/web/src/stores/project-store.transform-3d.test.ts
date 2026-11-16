import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsEngine, TitleEngine } from "@openreel/core";
import type { Clip, Transform } from "@openreel/core";
import { useEngineStore } from "./engine-store";
import { useProjectStore } from "./project-store";

vi.mock("../bridges/effects-bridge", async importOriginal => ({
  ...(await importOriginal<typeof import("../bridges/effects-bridge")>()),
  getEffectsBridge: () => ({ isInitialized: () => false }),
}));

const state = () => useProjectStore.getState();
const base: Transform = {
  position: { x: 0.3, y: 0.4 }, scale: { x: 0.8, y: 0.9 },
  anchor: { x: 0.2, y: 0.6 }, rotation: 12, opacity: 0.7,
  crop: { x: 0.1, y: 0.15, width: 0.7, height: 0.8 },
  fitMode: "contain", borderRadius: 7,
};
const kinds = ["media", "text", "shape", "svg", "sticker"] as const;
type Kind = typeof kinds[number];
function createClip(kind: Kind) {
  const trackId = state().project.timeline.tracks[0].id;
  if (kind === "media") {
    const clip: Clip = {
      id: "media-clip", mediaId: "media", trackId, startTime: 0, duration: 5,
      inPoint: 0, outPoint: 5, volume: 1, effects: [], audioEffects: [], keyframes: [],
      transform: structuredClone(base),
    };
    const project = state().project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: project.timeline.tracks.map(t => t.id === trackId ? { ...t, clips: [clip] } : t),
    } } });
    return clip;
  }
  const clip = kind === "text" ? state().createTextClip(trackId, 0, "3D title", 5)!
    : kind === "shape" ? state().createShapeClip(trackId, 0, "mesh-cube", 5)!
    : kind === "svg" ? state().importSVG('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>', trackId, 0, 5)!
    : state().createStickerClip({ id: "sticker", trackId, startTime: 0, duration: 5,
      type: "emoji", imageUrl: "data:image/png;base64,AA==", transform: structuredClone(base), keyframes: [], effects: [] })!;
  if (kind === "text") state().updateTextTransform(clip.id, structuredClone(base));
  else state().updateShapeTransform(clip.id, structuredClone(base));
  return clip;
}
function current(id: string) {
  const store = state();
  return store.getClip(id) ?? store.getTextClip(id) ?? store.getShapeClip(id) ?? store.getSVGClip(id) ?? store.getStickerClip(id);
}
function saved(id: string) {
  const project = JSON.parse(JSON.stringify(state().project));
  return [...project.timeline.tracks.flatMap((t: { clips: Clip[] }) => t.clips),
    ...(project.textClips ?? []), ...(project.shapeClips ?? []), ...(project.svgClips ?? []), ...(project.stickerClips ?? [])]
    .find(clip => clip.id === id);
}
beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
  state().createNewProject("3D transform preservation");
  state().actionHistory.setAutoGroupWindow(0);
});

describe("3D authoring history", () => {
  it.each(kinds)("persists %s rotation, perspective and style with exact Undo/Redo and reload", async kind => {
    const clip = createClip(kind);
    state().actionHistory.clear();
    const before = structuredClone(current(clip.id)!);
    for (const [edit, expected] of [
      [() => state().updateClipRotate3D(clip.id, { x: -24, y: 38, z: 11 }), { rotate3d: { x: -24, y: 38, z: 11 } }],
      [() => state().updateClipPerspective(clip.id, 640), { perspective: 640 }],
      [() => state().updateClipTransformStyle(clip.id, "preserve-3d"), { transformStyle: "preserve-3d" }],
    ] as const) {
      const previous = structuredClone(current(clip.id)!);
      expect(await edit()).toBe(true);
      expect(saved(clip.id).transform).toEqual({ ...previous.transform, ...expected });
      const after = structuredClone(current(clip.id)!);
      expect((await state().undo()).success).toBe(true);
      expect(current(clip.id)).toEqual(previous);
      expect(saved(clip.id)).toEqual(previous);
      expect((await state().redo()).success).toBe(true);
      expect(current(clip.id)).toEqual(after);
    }
    expect(current(clip.id)?.transform.position).toEqual(before.transform.position);
    const projectCopy = JSON.parse(JSON.stringify(state().project));
    state().loadProject(projectCopy);
    expect(current(clip.id)).toEqual(saved(clip.id));
    expect(current(clip.id)?.transform).toMatchObject({ rotate3d: { x: -24, y: 38, z: 11 }, perspective: 640, transformStyle: "preserve-3d" });
  });

  it.each(kinds)("keeps a held %s rotation adjustment in one undo group", async kind => {
    const clip = createClip(kind);
    const before = structuredClone(current(clip.id)!);
    state().actionHistory.clear();
    state().beginHistoryGroup("Rotate layer");
    const first = state().updateClipRotate3D(clip.id, { x: 5, y: 0, z: 0 });
    const second = state().updateClipRotate3D(clip.id, { x: 10, y: 0, z: 0 });
    state().endHistoryGroup();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(saved(clip.id).transform.rotate3d).toEqual({ x: 10, y: 0, z: 0 });
    expect((await state().undo()).success).toBe(true);
    expect(current(clip.id)).toEqual(before);
    expect(state().canUndo()).toBe(false);
    expect((await state().redo()).success).toBe(true);
    expect(current(clip.id)?.transform.rotate3d).toEqual({ x: 10, y: 0, z: 0 });
  });

  it.each(kinds)("rejects all %s edits on a locked track", async kind => {
    const clip = createClip(kind);
    state().actionHistory.clear();
    const project = state().project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: project.timeline.tracks.map(t => t.id === clip.trackId ? { ...t, locked: true } : t),
    } } });
    const before = structuredClone(current(clip.id)!);
    expect(await state().updateClipRotate3D(clip.id, { x: 10, y: 20, z: 30 })).toBe(false);
    expect(await state().updateClipPerspective(clip.id, 640)).toBe(false);
    expect(await state().updateClipTransformStyle(clip.id, "preserve-3d")).toBe(false);
    expect(current(clip.id)).toEqual(before);
    expect(state().canUndo()).toBe(false);
  });

  it("rejects missing IDs and non-finite 3D values without history or changes", async () => {
    const clip = createClip("shape");
    state().actionHistory.clear();
    const before = structuredClone(current(clip.id)!);
    for (const id of [clip.id, "missing"]) {
      expect(await state().updateClipRotate3D(id, { x: NaN, y: 0, z: 0 })).toBe(false);
      expect(await state().updateClipRotate3D(id, { x: 0, y: Infinity, z: 0 })).toBe(false);
      for (const value of [-1, NaN, Infinity]) expect(await state().updateClipPerspective(id, value)).toBe(false);
    }
    expect(await state().updateClipRotate3D("missing", { x: 1, y: 2, z: 3 })).toBe(false);
    expect(await state().updateClipPerspective("missing", 640)).toBe(false);
    expect(await state().updateClipTransformStyle("missing", "preserve-3d")).toBe(false);
    expect(current(clip.id)).toEqual(before);
    expect(state().canUndo()).toBe(false);
  });
});
