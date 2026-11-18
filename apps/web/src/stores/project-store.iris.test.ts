import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { TitleEngine, GraphicsEngine, getAnimatedVideoEffects, type Clip, type Keyframe } from "@openreel/core";
import { useProjectStore } from "./project-store";
import { useEngineStore } from "./engine-store";

const state = () => useProjectStore.getState();
const transform = { position: { x: 0.5, y: 0.5 }, scale: { x: -2, y: 0.5 }, rotation: 17, opacity: 0.7,
  anchor: { x: 0.5, y: 0.5 }, rotate3d: { x: 12, y: 25, z: 3 }, perspective: 640, transformStyle: "preserve-3d" as const };
const keys: Keyframe[] = [
  { id: "kf-entry-iris-star-scale-0", time: 0, property: "scale.x", value: 0, easing: "linear" },
  { id: "kf-entry-iris-star-scale-1", time: 0, property: "scale.y", value: 0, easing: "linear" },
  { id: "kf-entry-iris-star-scale-2", time: 0.5, property: "scale.x", value: -2, easing: "linear" },
  { id: "kf-entry-iris-star-scale-3", time: 0.5, property: "scale.y", value: 0.5, easing: "linear" },
  { id: "kf-entry-iris-star-opacity-0", time: 0, property: "opacity", value: 0.5, easing: "linear" },
  { id: "kf-entry-iris-star-opacity-1", time: 0.5, property: "opacity", value: 0.7, easing: "linear" },
];
beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
  state().createNewProject("Saved iris migration");
});

it.each(["media", "text", "shape", "svg", "sticker"] as const)("loads a saved %s iris as a mask without changing transform or other data", kind => {
  const trackId = state().project.timeline.tracks[0].id;
  let id: string;
  if (kind === "media") {
    id = "media-iris";
    const clip: Clip = { id, trackId, mediaId: "media", startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
      effects: [], audioEffects: [], volume: 1, keyframes: [], transform };
    const project = state().project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: project.timeline.tracks.map(track => track.id === trackId ? { ...track, clips: [clip] } : track),
    } } });
  } else if (kind === "text") id = state().createTextClip(trackId, 0, "Keep the material", 5, {
    shader: { shaderId: "paper-mesh-gradient", params: { color1: "#ee44aa" } }, color: "rgba(100, 140, 200, 0.4)",
  })!.id;
  else if (kind === "shape") id = state().createShapeClip(trackId, 0, "rectangle", 5)!.id;
  else if (kind === "svg") id = state().importSVG('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>', trackId, 0, 5)!.id;
  else id = state().createStickerClip({ id: "sticker-iris", trackId, startTime: 0, duration: 5, type: "emoji", imageUrl: "data:image/png;base64,AA==", transform, keyframes: [], effects: [] })!.id;
  const incoming = structuredClone(state().project);
  const all = [...incoming.timeline.tracks.flatMap(track => track.clips), ...(incoming.textClips ?? []),
    ...(incoming.shapeClips ?? []), ...(incoming.svgClips ?? []), ...(incoming.stickerClips ?? [])];
  const original = all.find(clip => clip.id === id)!;
  Object.assign(original, { transform: structuredClone(transform), keyframes: structuredClone(keys) });
  const snapshot = structuredClone(original);
  state().loadProject(incoming);
  const loaded = [...state().project.timeline.tracks.flatMap(track => track.clips), ...(state().project.textClips ?? []),
    ...(state().project.shapeClips ?? []), ...(state().project.svgClips ?? []), ...(state().project.stickerClips ?? [])].find(clip => clip.id === id)!;
  expect(loaded.keyframes.map(key => [key.property, key.value])).toEqual([["effect.iris-star", 0], ["effect.iris-star", 1]]);
  expect({ ...loaded, keyframes: snapshot.keyframes }).toEqual(snapshot);
  expect(original).toEqual(snapshot);
  expect(getAnimatedVideoEffects(loaded, 0.25).at(-1)).toMatchObject({ type: "mask", params: { irisShape: "star", progress: 0.5 } });
  expect(state().canUndo()).toBe(false);
});

describe("ordinary project loading", () => {
  it("does not invent iris keys for unrelated animation", () => {
    const incoming = structuredClone(state().project);
    state().loadProject(incoming);
    expect(state().project.timeline.tracks.every(track => track.clips.every(clip => clip.keyframes.length === 0))).toBe(true);
  });
});
