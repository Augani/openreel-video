import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ColorGradingEngine,
  type Clip,
  type LUTData,
  type MediaItem,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useInspectorNavigationStore } from "../stores/inspector-navigation-store";
import {
  applyEditorEffectToClip,
  createWarmLut,
  removeClipLut,
  setClipLutEnabled,
} from "./editor-effect-application";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
  rotation: 0,
};
const clip: Clip = {
  id: "target",
  trackId: "main",
  mediaId: "source",
  startTime: 0,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
  transform,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  colorGrading: { temperature: -5, tint: 3 },
};
const media: MediaItem = {
  id: "source",
  name: "Source.mp4",
  type: "video",
  fileHandle: null,
  blob: null,
  thumbnailUrl: null,
  waveformData: null,
  metadata: {
    width: 1920,
    height: 1080,
    duration: 5,
    frameRate: 30,
    sampleRate: 48000,
    channels: 2,
    codec: "h264",
    fileSize: 0,
  },
};
const current = () => useProjectStore.getState().getClip(clip.id)!;
beforeEach(() => {
  useUIStore.getState().clearSelection();
  useInspectorNavigationStore.getState().clearRequest();
  useProjectStore.getState().createNewProject("LUT QA");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      mediaLibrary: { items: [media] },
      timeline: {
        ...project.timeline,
        duration: 5,
        tracks: [
          {
            id: "main",
            type: "video",
            name: "Main",
            clips: [clip],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
        ],
      },
    },
  });
});

describe("Warm LUT application", () => {
  it("opens actual stabilization controls for the drop target without changing project data or history", async () => {
    const before = useProjectStore.getState().project;
    expect(await applyEditorEffectToClip(clip.id, { effectType: "stabilize" })).toBe(true);
    expect(useUIStore.getState().getSelectedClipIds()).toEqual([clip.id]);
    expect(useInspectorNavigationStore.getState().request).toMatchObject({ clipId: clip.id, sectionId: "stabilization" });
    expect(useProjectStore.getState().project).toBe(before);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
  it("rejects stabilization navigation for locked and non-video targets", async () => {
    const project = useProjectStore.getState().project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: project.timeline.tracks.map(track => ({ ...track, locked: true })),
    } } });
    expect(await applyEditorEffectToClip(clip.id, { effectType: "stabilize" })).toBe(false);
    useProjectStore.setState({ project: { ...project, mediaLibrary: { items: [{ ...media, type: "image" }] } } });
    expect(await applyEditorEffectToClip(clip.id, { effectType: "stabilize" })).toBe(false);
    expect(useInspectorNavigationStore.getState().request).toBeNull();
    expect(useUIStore.getState().getSelectedClipIds()).toEqual([]);
  });
  it("removes only the LUT and restores it with one Undo", async () => {
    await applyEditorEffectToClip(clip.id, { effectType: "lut" });
    expect(await removeClipLut(clip.id)).toBe(true);
    expect(current().colorGrading).toEqual(clip.colorGrading);
    expect(current().metadata?.workspaceLutIntensity).toBeUndefined();
    await useProjectStore.getState().undo();
    expect(current().colorGrading?.lut).toEqual(createWarmLut());
  });
  it("warms neutral pixels through the actual 3D LUT sampler and preserves alpha and black", () => {
    const lut = createWarmLut();
    const engine = new ColorGradingEngine(2, 1) as unknown as {
      applyLutToData(data: Uint8ClampedArray, lut: LUTData): void;
    };
    const pixels = new Uint8ClampedArray([128, 128, 128, 137, 0, 0, 0, 255]);
    engine.applyLutToData(pixels, { ...lut, data: new Uint8Array(lut.data), floatData: undefined, curve1d: undefined });
    expect(pixels[0]).toBeGreaterThan(pixels[1]);
    expect(pixels[1]).toBeGreaterThan(pixels[2]);
    expect(pixels[3]).toBe(137);
    expect(Array.from(pixels.slice(4))).toEqual([0, 0, 0, 255]);
    const original = new Uint8ClampedArray([128, 128, 128, 137]);
    engine.applyLutToData(original, {
      ...lut,
      intensity: 0,
      data: new Uint8Array(lut.data), floatData: undefined, curve1d: undefined,
    });
    expect(Array.from(original)).toEqual([128, 128, 128, 137]);
  });
  it("persists the table without replacing other grades, restores it after JSON reload and undoes as one edit", async () => {
    expect(
      await applyEditorEffectToClip(clip.id, {
        effectType: "lut",
        effectParams: { preset: "warm" },
      }),
    ).toBe(true);
    expect(current().colorGrading).toMatchObject({
      temperature: -5,
      tint: 3,
      lut: { size: 17, intensity: 1 },
    });
    expect(current().colorGrading?.lut?.data).toHaveLength(17 ** 3 * 3);
    expect(current().effects).toEqual([]);
    const saved = JSON.parse(
      JSON.stringify(useProjectStore.getState().project),
    );
    await useProjectStore.getState().undo();
    expect(current().colorGrading).toEqual(clip.colorGrading);
    expect(useProjectStore.getState().canUndo()).toBe(false);
    await useProjectStore.getState().redo();
    expect(current().colorGrading?.lut?.size).toBe(17);
    useProjectStore.getState().loadProject(saved);
    expect(Array.isArray(current().colorGrading?.lut?.data)).toBe(true);
    expect(current().colorGrading?.lut).toEqual(createWarmLut());
  });
  it("toggles a LUT without losing its chosen intensity and retains ordinary Undo", async () => {
    await applyEditorEffectToClip(clip.id, { effectType: "lut" });
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((item) => ({
              ...item,
              colorGrading: {
                ...item.colorGrading,
                lut: { ...item.colorGrading!.lut!, intensity: 0.45 },
              },
            })),
          })),
        },
      },
    });
    expect(await setClipLutEnabled(clip.id, false)).toBe(true);
    expect(current().colorGrading?.lut?.intensity).toBe(0);
    expect(await setClipLutEnabled(clip.id, true)).toBe(true);
    expect(current().colorGrading?.lut?.intensity).toBe(0.45);
    await useProjectStore.getState().undo();
    expect(current().colorGrading?.lut?.intensity).toBe(0);
  });
  it("rejects locked tracks and incompatible layers without publishing an edit", async () => {
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((track) => ({
            ...track,
            locked: true,
          })),
        },
      },
    });
    expect(await applyEditorEffectToClip(clip.id, { effectType: "lut" })).toBe(
      false,
    );
    expect(current().colorGrading).toEqual(clip.colorGrading);
    expect(useProjectStore.getState().canUndo()).toBe(false);
    useProjectStore.setState({
      project: {
        ...project,
        mediaLibrary: { items: [{ ...media, type: "audio" }] },
      },
    });
    expect(await applyEditorEffectToClip(clip.id, { effectType: "lut" })).toBe(
      false,
    );
    expect(current().colorGrading).toEqual(clip.colorGrading);
  });
});
