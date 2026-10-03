import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ActionExecutor, getBeatSyncEngine, type Clip, type BeatAnalysisResult } from "@openreel/core";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as bridgeModule from "./audio-text-sync-bridge";
import { AudioTextSyncPanel } from "../components/editor/inspector/AudioTextSyncPanel";
import { loadAudioBuffer } from "../utils/load-audio-buffer";
import { BeatSyncBridge } from "./audio-text-sync-bridge";
import { useProjectStore } from "../stores/project-store";
import { createEmptyProject } from "../stores/project/project-helpers";

vi.mock("../utils/load-audio-buffer", () => ({ loadAudioBuffer: vi.fn() }));

const analysis: BeatAnalysisResult = {
  bpm: 120, confidence: 0.9, duration: 10, downbeats: [],
  beats: Array.from({ length: 20 }, (_, index) => ({ time: index * 0.5, index, strength: 1 })),
};
const makeClip = (id: string, mediaId: string, trackId: string, startTime: number): Clip => ({
  id, mediaId, trackId, startTime, inPoint: 2, outPoint: 6, duration: 4,
  effects: [], audioEffects: [], volume: 1, keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
    anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
});
let bridge: BeatSyncBridge;
const store = () => useProjectStore.getState();
const prepare = async () => {
  bridge.setSelectedAudioClip("music");
  await bridge.analyzeBeats();
  bridge.setSelectedTracks(["visuals"]);
};

beforeEach(() => {
  const project = createEmptyProject("Beat cuts");
  const tracks = [
    { id: "visuals", name: "Video", type: "audio" as const, locked: false, hidden: false,
      muted: false, solo: false, transitions: [], clips: [makeClip("one", "video", "visuals", 0), makeClip("two", "video", "visuals", 8)] },
    { id: "music-track", name: "Music", type: "audio" as const, locked: false, hidden: false,
      muted: false, solo: false, transitions: [], clips: [{ ...makeClip("music", "song", "music-track", 5), duration: 10, outPoint: 12 }] },
  ];
  const mediaLibrary = { items: (["video", "audio"] as const).map((type) => ({
    id: type === "video" ? "video" : "song", name: type, type, blob: new Blob(), fileHandle: null,
    thumbnailUrl: null, waveformData: null,
    metadata: { duration: 30, width: 1920, height: 1080, frameRate: 30, codec: "", sampleRate: 48000, channels: 2, fileSize: 1 },
  })) };
  useProjectStore.setState({ project: { ...project, mediaLibrary, timeline: { ...project.timeline, tracks, duration: 15 } }, actionExecutor: new ActionExecutor() });
  bridge = new BeatSyncBridge();
  vi.spyOn(bridge as unknown as { extractAudioFromBlob: () => Promise<Blob> }, "extractAudioFromBlob").mockResolvedValue(new Blob());
  vi.spyOn(getBeatSyncEngine(), "analyzeBeats").mockResolvedValue(analysis);
});
afterEach(() => { cleanup(); bridge.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("beat cut timeline workflow", () => {
  it("lets the user detect music, select video tracks, choose pacing, preview, and apply", async () => {
    vi.spyOn(bridgeModule, "getBeatSyncBridge").mockReturnValue(bridge);
    render(createElement(AudioTextSyncPanel, { clipId: "music" }));
    fireEvent.click(screen.getByRole("button", { name: "Detect Beats" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Select Video" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Select Video" }));
    fireEvent.click(screen.getByRole("button", { name: "2 beats" }));
    expect(screen.getByText("5.00s – 6.00s")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply Beat Cuts to 2 Clips" }));
    await waitFor(() => expect(store().getClip("two")?.startTime).toBe(6));
    expect(store().getClip("two")?.duration).toBe(1);
  });
  it("analyzes the trimmed source range and rejects silence, including silent trims of audible files", async () => {
    const extract = vi.mocked((bridge as unknown as { extractAudioFromBlob: () => Promise<Blob> }).extractAudioFromBlob);
    extract.mockRestore();
    const samples = new Float32Array(14000);
    samples.fill(0.5, 0, 2000); // Music exists only outside the selected trim.
    vi.mocked(loadAudioBuffer).mockResolvedValue({
      sampleRate: 1000, duration: 14, numberOfChannels: 1,
      getChannelData: () => samples,
    } as unknown as AudioBuffer);
    bridge.setSelectedAudioClip("music");
    await bridge.analyzeBeats();
    expect(bridge.getState().error).toContain("silent");
    expect(getBeatSyncEngine().analyzeBeats).not.toHaveBeenCalled();
    expect(loadAudioBuffer).toHaveBeenCalledWith(expect.anything(), expect.any(Blob), { audioTrackIndex: 0 });
  });
  it("detects music in the right channel when the left channel is silent", async () => {
    vi.mocked((bridge as unknown as { extractAudioFromBlob: () => Promise<Blob> }).extractAudioFromBlob).mockRestore();
    vi.mocked(loadAudioBuffer).mockResolvedValue({
      sampleRate: 1000, duration: 14, numberOfChannels: 2,
      getChannelData: (channel: number) => new Float32Array(14000).fill(channel === 1 ? 0.5 : 0),
    } as unknown as AudioBuffer);
    bridge.setSelectedAudioClip("music");
    await bridge.analyzeBeats();
    expect(bridge.getState().error).toBeNull();
    expect(getBeatSyncEngine().analyzeBeats).toHaveBeenCalledOnce();
    expect(bridge.getState().beatAnalysis).toEqual(analysis);
  });
  it("uses media type on universal tracks, preserves source in points and music, and supports one-step undo/redo", async () => {
    await prepare();
    expect(bridge.getAvailableTracks().map((track) => track.id)).toEqual(["visuals"]);
    const original = JSON.stringify(store().project.timeline.tracks);
    expect(bridge.getState().previewTimings).toHaveLength(2);
    expect(await bridge.applySync()).toBe(true);
    expect(store().getClip("one")).toMatchObject({ startTime: 5, inPoint: 2, outPoint: 4, duration: 2 });
    expect(store().getClip("two")).toMatchObject({ startTime: 7, inPoint: 2, outPoint: 4, duration: 2 });
    expect(store().getClip("music")).toMatchObject({ startTime: 5, inPoint: 2, outPoint: 12, duration: 10 });
    await store().undo();
    // Actions may reorder clip arrays; compare the restored clip values.
    const restored = JSON.parse(original).flatMap((track: { clips: Clip[] }) => track.clips);
    for (const clip of restored) expect(store().getClip(clip.id)).toEqual(clip);
    await store().redo();
    expect(store().getClip("two")).toMatchObject({ startTime: 7, duration: 2 });
  });
  it("refuses a stale preview and invalidates beats after the music trim changes", async () => {
    await prepare();
    await store().moveClip("one", 1);
    expect(await bridge.applySync()).toBe(false);
    expect(store().getClip("one")?.duration).toBe(4);
    await store().trimClip("music", 3, 12);
    bridge.refreshProject();
    expect(bridge.getState().beatAnalysis).toBeNull();
  });
  it("rolls back earlier edits when an action fails", async () => {
    await prepare();
    vi.spyOn(store(), "trimClip").mockResolvedValueOnce({ success: false, error: { code: "INVALID_PARAMS", message: "Cannot trim" } });
    expect(await bridge.applySync()).toBe(false);
    expect(store().getClip("one")).toMatchObject({ startTime: 0, duration: 4 });
    expect(bridge.getState().error).toBe("Cannot trim");
  });
  it("does not expose locked tracks", async () => {
    const project = store().project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({ ...track, locked: true })) } } });
    await prepare();
    expect(bridge.getAvailableTracks()).toEqual([]);
    expect(bridge.getState().previewTimings).toEqual([]);
  });
  it("rejects speed changes rather than using source seconds as timeline seconds", async () => {
    const project = store().project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.id === "one" ? { ...clip, speed: 2 } : clip) })) } } });
    await prepare();
    expect(bridge.getState().previewTimings).toEqual([]);
    expect(bridge.getState().error).toContain("Reset video speed");
  });
  it("discards beat analysis when the user selects different music during detection", async () => {
    let finish!: (result: BeatAnalysisResult) => void;
    vi.mocked(getBeatSyncEngine().analyzeBeats).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    bridge.setSelectedAudioClip("music");
    const pending = bridge.analyzeBeats();
    await Promise.resolve();
    bridge.setSelectedAudioClip(null);
    finish(analysis);
    await pending;
    expect(bridge.getState().beatAnalysis).toBeNull();
    expect(bridge.getState().isProcessing).toBe(false);
  });
});
