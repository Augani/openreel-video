import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { createMotionTrackingSource, createTrackingTimeMapper } from "./motion-tracking-source";
const mocks = vi.hoisted(() => ({ initialize: vi.fn(), create: vi.fn(), dispose: vi.fn(), frame: vi.fn() }));
vi.mock("@openreel/core", async importOriginal => ({ ...await importOriginal<typeof import("@openreel/core")>(), initializeMediaEngine: mocks.initialize }));
const state = () => useProjectStore.getState();
let sourceClip: Clip;
beforeEach(() => {
  vi.clearAllMocks(); state().createNewProject("Tracking decoder"); const project = state().project, trackId = project.timeline.tracks.find(track => track.type === "video")!.id;
  sourceClip = { id: "source", mediaId: "video", trackId, startTime: 5, duration: 1.5, inPoint: 2, outPoint: 8, speed: 2, volume: 1, effects: [], audioEffects: [], keyframes: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } } };
  const blob = { arrayBuffer: async () => new ArrayBuffer(4) } as Blob;
  useProjectStore.setState({ project: { ...project, settings: { ...project.settings, frameRate: 24 }, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => track.id === trackId ? { ...track, clips: [sourceClip] } : track) }, mediaLibrary: { items: [{ id: "video", name: "real.mp4", type: "video", blob, fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { duration: 10, width: 1920, height: 1080, frameRate: 60, codec: "h264", sampleRate: 0, channels: 0, fileSize: 4 } }] } } });
  useTimelineStore.setState({ playbackLockedReason: null });
  useUIStore.setState({ effectApplicationClipId: null, exportState: { isExporting: false, progress: 0, phase: "" } });
  mocks.initialize.mockResolvedValue({ createExportDecoder: mocks.create, disposeExportDecoder: mocks.dispose });
  mocks.create.mockResolvedValue({ getFrame: mocks.frame });
  const pixels = { width: 480, height: 270, data: new Uint8ClampedArray(480 * 270 * 4) };
  mocks.frame.mockResolvedValue({ width: 480, height: 270, getContext: () => ({ getImageData: () => pixels }) });
});

describe("tracking source ownership and timeline mapping", () => {
  it("uses the complete clip range at project fps and an isolated bounded decoder", async () => {
    const source = createMotionTrackingSource("source", { x: 100, y: 100, width: 400, height: 300 }, new AbortController().signal);
    expect(source.frameRate).toBe(24); expect(source.startFrame).toBe(0); expect(source.endFrame).toBe(35);
    const pixels = await source.readFrame(24); expect(pixels).toMatchObject({ width: 480, height: 270, sourceWidth: 1920, sourceHeight: 1080 });
    expect(mocks.frame).toHaveBeenCalledWith(4); expect(mocks.create).toHaveBeenCalledWith(expect.stringMatching(/^tracking-/), state().project.mediaLibrary.items[0].blob, 480);
    source.dispose(); expect(mocks.dispose).toHaveBeenCalledWith(mocks.create.mock.calls[0][0]);
    await expect(source.readFrame(25)).rejects.toThrow("cancelled");
  });
  it("maps trim, reverse, freeze and speed ramps using the renderer's speed engine", () => {
    expect(createTrackingTimeMapper(sourceClip)(1)).toBe(4);
    expect(createTrackingTimeMapper({ ...sourceClip, reversed: true })(1)).toBe(6);
    expect(createTrackingTimeMapper({ ...sourceClip, freezeFrames: [{ id: "freeze", clipId: "source", sourceTime: 1, startTime: .5, duration: .5 }] })(.75)).toBe(3);
    const ramped = createTrackingTimeMapper({ ...sourceClip, speedKeyframes: [{ id: "speed", time: 0, speed: 2, easing: "linear" }] });
    expect(ramped(1)).toBeCloseTo(4, 3); expect(createTrackingTimeMapper(sourceClip)(100)).toBeLessThan(8);
  });
  it("bounds portrait analysis by its longest edge", async () => {
    const project = state().project; useProjectStore.setState({ project: { ...project, mediaLibrary: { items: project.mediaLibrary.items.map(media => ({ ...media, metadata: { ...media.metadata, width: 1080, height: 1920 } })) } } });
    const source = createMotionTrackingSource("source", { x: 0, y: 0, width: 400, height: 400 }, new AbortController().signal);
    await source.readFrame(0); expect(mocks.create.mock.calls[0][2]).toBe(270); source.dispose();
  });
  it("disposes a decoder that finishes initializing after cancellation", async () => {
    let finish!: (decoder: unknown) => void; mocks.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController(), source = createMotionTrackingSource("source", { x: 0, y: 0, width: 400, height: 400 }, controller.signal);
    const pending = source.readFrame(0); await vi.waitFor(() => expect(mocks.create).toHaveBeenCalled()); controller.abort(); source.dispose(); finish({ getFrame: mocks.frame });
    await expect(pending).rejects.toThrow("cancelled"); expect(mocks.dispose).toHaveBeenLastCalledWith(mocks.create.mock.calls[0][0]); expect(mocks.frame).not.toHaveBeenCalled();
  });
  it("rejects changed media, source range and project ownership before another frame is read", async () => {
    const source = createMotionTrackingSource("source", { x: 0, y: 0, width: 100, height: 100 }, new AbortController().signal);
    await source.readFrame(0); const project = state().project;
    useProjectStore.setState({ project: { ...project, settings: { ...project.settings, frameRate: 30 } } });
    await expect(source.readFrame(1)).rejects.toThrow("source changed"); expect(mocks.frame).toHaveBeenCalledTimes(1); source.dispose();
  });
  it("rejects a separated audio stream even when its asset also contains video", () => {
    const project = state().project; useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => ({ ...track, type: "audio" as const })) } } });
    expect(() => createMotionTrackingSource("source", { x: 0, y: 0, width: 100, height: 100 }, new AbortController().signal)).toThrow("video or image");
  });
  it("rejects missing media and locked tracks without constructing a decoder", () => {
    const project = state().project; useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => ({ ...track, locked: true })) } } });
    expect(() => createMotionTrackingSource("source", { x: 0, y: 0, width: 100, height: 100 }, new AbortController().signal)).toThrow("Unlock");
    useProjectStore.setState({ project: { ...project, mediaLibrary: { items: project.mediaLibrary.items.map(item => ({ ...item, blob: null })) } } });
    expect(() => createMotionTrackingSource("source", { x: 0, y: 0, width: 100, height: 100 }, new AbortController().signal)).toThrow("Relink"); expect(mocks.create).not.toHaveBeenCalled();
  });
});
