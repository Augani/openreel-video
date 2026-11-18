import "../../../test/install-local-storage-mock";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { useAutoCaptions, removeCaptionFillers } from "./useAutoCaptions";
import { loadAudioBuffer } from "../../../utils/load-audio-buffer";
import { audioBufferToWhisperSamples } from "../../../utils/whisper-audio";

vi.mock("../../../utils/load-audio-buffer", () => ({ loadAudioBuffer: vi.fn(async () => ({ duration: 10 })) }));
vi.mock("../../../utils/whisper-audio", () => ({ audioBufferToWhisperSamples: vi.fn(() => new Float32Array(160)) }));
class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { super(); FakeWorker.instances.push(this); }
  respond(type: string, result = {}) {
    const requestId = this.postMessage.mock.calls.at(-1)![0].requestId;
    this.dispatchEvent(new MessageEvent("message", { data: { requestId, type, ...result } }));
  }
}
function seed() {
  const empty = createEmptyProject("Caption source");
  const project: Project = { ...empty, mediaLibrary: { items: [{ id: "media", name: "Interview.mp4", type: "video", fileHandle: null,
    blob: new Blob(["fixture"]), thumbnailUrl: null, waveformData: null,
    metadata: { duration: 10, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 7 } }] },
    timeline: { ...empty.timeline, duration: 15, tracks: [{ id: "main", name: "Main", type: "video", transitions: [], locked: false, hidden: false, muted: false, solo: false,
      clips: [{ id: "video", trackId: "main", mediaId: "media", startTime: 5, duration: 4, inPoint: 2, outPoint: 10, speed: 2,
        volume: 1, effects: [], audioEffects: [], keyframes: [], transform: { position: { x: .5, y: .5 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: .5, y: .5 }, opacity: 1 } }] }] } };
  useProjectStore.getState().loadProject(project);
  useProjectStore.getState().actionHistory.clear();
  useTimelineStore.setState({ playbackLockedReason: null, playheadPosition: 5, playbackState: "paused" });
  useUIStore.setState({ selectedItems: [], exportState: { isExporting: false, progress: 0, phase: "" } });
}
beforeEach(() => {
  FakeWorker.instances = []; vi.stubGlobal("Worker", FakeWorker);
  seed();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useProjectStore.getState().actionHistory.clear(); });
async function transcribe(result: ReturnType<typeof renderHook<ReturnType<typeof useAutoCaptions>, unknown>>["result"], text = "Um, hello there uh friend") {
  let pending: Promise<void>;
  act(() => { pending = result.current.handleTranscribe(); });
  await waitFor(() => expect(FakeWorker.instances.at(-1)?.postMessage).toHaveBeenCalled());
  await act(async () => { FakeWorker.instances.at(-1)!.respond("result", { chunks: [{ text, timestamp: [0, 8] }] }); await pending; });
}
function seedDialogue() {
  const project = useProjectStore.getState().project;
  const first = project.timeline.tracks[0].clips[0];
  const second = { ...first, id: "second", startTime: 12, duration: 4, inPoint: 0, outPoint: 2, speed: .5 };
  useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
    tracks: [{ ...project.timeline.tracks[0], role: "dialogue", name: "Dialogue", clips: [second, first] }],
  } } });
}
async function transcribeSources(result: ReturnType<typeof renderHook<ReturnType<typeof useAutoCaptions>, unknown>>["result"], replies: Record<string, unknown>[]) {
  let pending: Promise<void>;
  act(() => { pending = result.current.handleTranscribe(); });
  for (let index = 0; index < replies.length; index++) {
    await waitFor(() => expect(FakeWorker.instances[0]?.postMessage).toHaveBeenCalledTimes(index + 1));
    await act(async () => {
      FakeWorker.instances[0].respond("result", replies[index]);
      if (index === replies.length - 1) await pending;
    });
  }
}
describe("shared caption session", () => {
  it("transcribes a dialogue track with one worker, preserves gaps/trim/speed and each caption source, and undoes once", async () => {
    seedDialogue();
    vi.mocked(loadAudioBuffer).mockClear();
    vi.mocked(audioBufferToWhisperSamples).mockClear();
    const { result } = renderHook(() => useAutoCaptions({ clipIds: ["second", "video"], sourceTrackId: "main", sourceLabel: "Dialogue" }));
    expect(result.current.canTranscribe).toBe(true);
    expect(result.current.sourceCount).toBe(2);
    let pending: Promise<void>;
    act(() => { pending = result.current.handleTranscribe(); });
    await waitFor(() => expect(FakeWorker.instances[0]?.postMessage).toHaveBeenCalledTimes(1));
    await act(async () => { FakeWorker.instances[0].respond("result", { chunks: [{ text: "First speech", timestamp: [0, 8] }] }); });
    await waitFor(() => expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(2));
    await act(async () => { FakeWorker.instances[0].respond("result", { chunks: [{ text: "Second speech", timestamp: [0, 8] }] }); await pending; });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(loadAudioBuffer).toHaveBeenCalledOnce();
    expect(vi.mocked(audioBufferToWhisperSamples).mock.calls.map(([, start, end]) => [start, end])).toEqual([[2, 10], [0, 2]]);
    expect(result.current.segments).toMatchObject([
      { text: "First speech", startTime: 5, endTime: 9, sourceClipId: "video" },
      { text: "Second speech", startTime: 12, endTime: 16, sourceClipId: "second" },
    ]);
    expect(result.current.sourceName).toBe("Dialogue");
    await act(async () => { await result.current.handleAddToTimeline(); });
    const text = useProjectStore.getState().getAllTextClips().sort((a, b) => a.startTime - b.startTime);
    expect(text.map(clip => [clip.text, clip.startTime, clip.duration, clip.metadata?.captionSourceClipId]))
      .toEqual([["First speech", 5, 4, "video"], ["Second speech", 12, 4, "second"]]);
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(useProjectStore.getState().getAllTextClips()).toHaveLength(0);
  });
  it("keeps speech from later clips when an earlier source is silent", async () => {
    seedDialogue();
    const { result } = renderHook(() => useAutoCaptions({ clipIds: ["video", "second"], sourceTrackId: "main" }));
    await transcribeSources(result, [{ text: "", chunks: [] }, { chunks: [{ text: "Later speech", timestamp: [0, 2] }] }]);
    expect(result.current.error).toBeNull();
    expect(result.current.segments).toMatchObject([{ text: "Later speech", startTime: 12, endTime: 16, sourceClipId: "second" }]);
  });
  it("reuses a decoded source safely while real PCM samples are transferred for separate trims", async () => {
    seedDialogue();
    const pcm = new Float32Array(16000); pcm.fill(.25, 0, 8000); pcm.fill(.75, 8000);
    const decoded: AudioBuffer = { duration: 1, length: pcm.length, sampleRate: 16000, numberOfChannels: 1,
      getChannelData: () => pcm, copyFromChannel: vi.fn(), copyToChannel: vi.fn() };
    vi.mocked(loadAudioBuffer).mockClear();
    vi.mocked(loadAudioBuffer).mockResolvedValueOnce(decoded);
    const actual = await vi.importActual<typeof import("../../../utils/whisper-audio")>("../../../utils/whisper-audio");
    vi.mocked(audioBufferToWhisperSamples).mockImplementationOnce(actual.audioBufferToWhisperSamples)
      .mockImplementationOnce(actual.audioBufferToWhisperSamples);
    const received: Float32Array[] = [];
    class TransferWorker extends FakeWorker {
      constructor() {
        super();
        this.postMessage.mockImplementation((message: { audio: Float32Array }, transfer: ArrayBuffer[]) => {
          received.push(structuredClone(message, { transfer }).audio);
        });
      }
    }
    vi.stubGlobal("Worker", TransferWorker);
    useProjectStore.setState(state => ({ project: { ...state.project, timeline: { ...state.project.timeline,
      tracks: state.project.timeline.tracks.map(track => ({ ...track, clips: track.clips.map(clip => clip.id === "video"
        ? { ...clip, inPoint: 0, outPoint: .5, duration: .5, speed: 1 }
        : { ...clip, inPoint: .5, outPoint: 1, duration: .25, speed: 2 }) })),
    } } }));
    const { result } = renderHook(() => useAutoCaptions({ clipIds: ["video", "second"], sourceTrackId: "main" }));
    await transcribeSources(result, [{ chunks: [{ text: "First", timestamp: [0, .5] }] }, { chunks: [{ text: "Second", timestamp: [0, .5] }] }]);
    expect(result.current.error).toBeNull();
    expect(loadAudioBuffer).toHaveBeenCalledOnce();
    expect(received.map(samples => [samples.length, samples[0], samples.at(-1)])).toEqual([[8000, .25, .25], [8000, .75, .75]]);
    expect(pcm.byteLength).toBe(64000);
    expect(FakeWorker.instances[0].postMessage.mock.calls.every(([message]) => message.audio.byteLength === 0)).toBe(true);
    expect(result.current.segments).toMatchObject([{ startTime: 5, endTime: 5.5, sourceClipId: "video" }, { startTime: 12, endTime: 12.25, sourceClipId: "second" }]);
  });
  it("does not start a partial job when one requested source is missing", async () => {
    const { result } = renderHook(() => useAutoCaptions({ clipIds: ["video", "missing"] }));
    expect(result.current.canTranscribe).toBe(false);
    await act(async () => { await result.current.handleTranscribe(); });
    expect(FakeWorker.instances).toHaveLength(0);
  });
  it("cancels a later clip without retaining an earlier partial transcript", async () => {
    seedDialogue();
    const { result } = renderHook(() => useAutoCaptions({ clipIds: ["video", "second"] }));
    let pending: Promise<void>;
    act(() => { pending = result.current.handleTranscribe(); });
    await waitFor(() => expect(FakeWorker.instances[0]?.postMessage).toHaveBeenCalledOnce());
    await act(async () => { FakeWorker.instances[0].respond("result", { text: "First speech" }); });
    await waitFor(() => expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(2));
    await act(async () => { result.current.cancel(); await pending; });
    expect(result.current.segments).toHaveLength(0);
    expect(result.current.isTranscribing).toBe(false);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(result.current.workerState).toBe("idle");
  });
  it("publishes no partial transcript when the worker fails on a later clip", async () => {
    seedDialogue();
    const { result } = renderHook(() => useAutoCaptions({ clipIds: ["video", "second"] }));
    let pending: Promise<void>;
    act(() => { pending = result.current.handleTranscribe(); });
    await waitFor(() => expect(FakeWorker.instances[0]?.postMessage).toHaveBeenCalledOnce());
    await act(async () => { FakeWorker.instances[0].respond("result", { text: "First speech" }); });
    await waitFor(() => expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(2));
    await act(async () => { FakeWorker.instances[0].dispatchEvent(new Event("error")); await pending; });
    expect(result.current.error).toContain("worker stopped");
    expect(result.current.segments).toHaveLength(0);
    expect(result.current.isTranscribing).toBe(false);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().getAllTextClips()).toHaveLength(0);
  });
  it("retains the source identity of only the uncommitted cues when a batch add is retried", async () => {
    seedDialogue();
    const { result } = renderHook(() => useAutoCaptions({ clipIds: ["video", "second"], sourceTrackId: "main" }));
    await transcribeSources(result, [{ text: "First speech" }, { text: "Second speech" }]);
    const realAdd = useProjectStore.getState().addSubtitle;
    const add = vi.spyOn(useProjectStore.getState(), "addSubtitle").mockImplementationOnce(realAdd).mockResolvedValueOnce(undefined);
    await act(async () => { await result.current.handleAddToTimeline(); });
    expect(result.current.segments).toMatchObject([{ text: "Second speech", sourceClipId: "second" }]);
    add.mockRestore();
    await act(async () => { await result.current.handleAddToTimeline(); });
    expect(useProjectStore.getState().getAllTextClips().map(clip => [clip.text, clip.metadata?.captionSourceClipId]))
      .toEqual([["First speech", "video"], ["Second speech", "second"]]);
  });
  it.each(["timing", "membership"] as const)("rejects a changed dialogue %s before publishing a partial transcript", async change => {
    seedDialogue();
    const { result } = renderHook(() => useAutoCaptions({ clipIds: ["video", "second"], sourceTrackId: "main" }));
    expect(result.current.canTranscribe).toBe(true);
    let pending: Promise<void>;
    act(() => { pending = result.current.handleTranscribe(); });
    await waitFor(() => expect(FakeWorker.instances[0]?.postMessage).toHaveBeenCalledOnce());
    act(() => useProjectStore.setState(state => ({ project: { ...state.project, timeline: { ...state.project.timeline,
      tracks: state.project.timeline.tracks.map(track => ({ ...track, clips: change === "timing"
        ? track.clips.map(clip => clip.id === "second" ? { ...clip, startTime: 14 } : clip)
        : [...track.clips, { ...track.clips[0], id: "new-source", startTime: 18 }] })),
    } } })));
    await act(async () => { FakeWorker.instances[0].respond("result", { text: "First speech" }); await pending; });
    expect(result.current.error).toContain("source clip changed");
    expect(result.current.segments).toHaveLength(0);
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledOnce();
  });
  it("creates no worker until requested, cancels, and releases the previous resident model", async () => {
    const { result, unmount } = renderHook(() => useAutoCaptions({ clipId: "video" }));
    expect(FakeWorker.instances).toHaveLength(0);
    let pending: Promise<void>;
    act(() => { pending = result.current.handlePrepareModel(); });
    expect(FakeWorker.instances).toHaveLength(1);
    act(() => result.current.cancel()); await act(async () => { await pending; });
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce(); expect(result.current.workerState).toBe("idle");
    act(() => { pending = result.current.handlePrepareModel(); });
    await act(async () => { FakeWorker.instances[1].respond("ready", { backend: "webgpu" }); await pending; });
    expect(result.current.modelStatus).toContain("GPU");
    act(() => result.current.handleModelChange("fast"));
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalledOnce(); expect(result.current.workerState).toBe("idle");
    unmount();
  });
  it("maps source timestamps through trim and speed, adds real text and animation, then undoes the batch once", async () => {
    const { result } = renderHook(() => useAutoCaptions({ clipId: "video", maxWordsPerLine: 3, initialStyle: "pop-words", initialRemoveFillers: true }));
    await transcribe(result);
    expect(result.current.segments[0]).toMatchObject({ startTime: 5, endTime: 9 });
    await act(async () => { await result.current.handleAddToTimeline(); });
    const clips = useProjectStore.getState().getAllTextClips().sort((a,b) => a.startTime - b.startTime);
    expect(clips.map(clip => clip.text)).toEqual(["hello there", "friend"]);
    expect(clips.every(clip => clip.metadata?.captionSourceClipId === "video" && clip.animation?.unit === "word")).toBe(true);
    expect(useTimelineStore.getState().playbackLockedReason).toBeNull();
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(useProjectStore.getState().getAllTextClips()).toHaveLength(0);
  });
  it("preserves the original transcript by default and enables word animation when the legacy Pop style is selected", async () => {
    const { result } = renderHook(() => useAutoCaptions({ clipId: "video" }));
    expect(result.current.removeFillers).toBe(false);
    act(() => result.current.setSelectedStyle("pop-words"));
    expect(result.current.highlightWords).toBe(true);
    await transcribe(result, "um hello");
    await act(async () => { await result.current.handleAddToTimeline(); });
    expect(useProjectStore.getState().getAllTextClips()[0].text).toBe("um hello");
  });

  it("keeps the transcript across selection changes and rejects a changed source before applying", async () => {
    const { result, rerender } = renderHook(({ id }) => useAutoCaptions({ clipId: id }), { initialProps: { id: "video" } });
    await transcribe(result); rerender({ id: "elsewhere" });
    expect(result.current.sourceName).toBe("Interview.mp4"); expect(result.current.segments).toHaveLength(1);
    const project = useProjectStore.getState().project;
    act(() => useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => ({ ...track, clips: track.clips.map(clip => ({ ...clip, startTime: 7 })) })) } } }));
    await act(async () => { await result.current.handleAddToTimeline(); });
    expect(result.current.error).toContain("source clip changed"); expect(useProjectStore.getState().getAllTextClips()).toHaveLength(0);
  });
  it("prevents duplicate jobs, reports worker crashes, and ignores late results after a project switch", async () => {
    const { result } = renderHook(() => useAutoCaptions({ clipId: "video" }));
    let job: Promise<void>;
    act(() => { job = result.current.handleTranscribe(); void result.current.handleTranscribe(); });
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledOnce();
    await act(async () => { FakeWorker.instances[0].dispatchEvent(new Event("error")); await job; });
    expect(result.current.error).toContain("worker stopped"); expect(result.current.isTranscribing).toBe(false);
    act(() => { job = result.current.handleTranscribe(); });
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    await act(async () => { useProjectStore.getState().loadProject(createEmptyProject("Next")); await job; });
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalledOnce(); expect(result.current.segments).toHaveLength(0);
  });
  it("retains exactly uncommitted cues when adding fails and honors both switches", async () => {
    const { result } = renderHook(() => useAutoCaptions({ clipId: "video", maxWordsPerLine: 3, initialStyle: "pop-words", initialRemoveFillers: true }));
    await transcribe(result);
    act(() => { result.current.setRemoveFillers(false); result.current.setHighlightWords(false); });
    const realAdd = useProjectStore.getState().addSubtitle;
    const add = vi.spyOn(useProjectStore.getState(), "addSubtitle").mockImplementationOnce(realAdd).mockResolvedValueOnce(undefined);
    await act(async () => { await result.current.handleAddToTimeline(); });
    expect(result.current.segments.map(segment => segment.text)).toEqual(["uh friend"]);
    expect(useProjectStore.getState().getAllTextClips()[0]).toMatchObject({ text: "Um, hello there" });
    expect(useProjectStore.getState().getAllTextClips()[0].animation).toBeUndefined();
    add.mockRestore();
    await act(async () => { await result.current.handleAddToTimeline(); });
    expect(useProjectStore.getState().getAllTextClips().map(clip => clip.text)).toEqual(["Um, hello there", "uh friend"]);
  });
});
describe("caption-only filler cleanup", () => {
  it.each([["Um, uh, hello.", "hello."], ["hello, um, there", "hello, there"], ["umbrella thumb uh-huh", "umbrella thumb uh-huh"], ["um", ""], ["uh… hello", "uh… hello"]])("cleans %s without deleting parts of other words", (text, expected) => expect(removeCaptionFillers(text)).toBe(expected));
});
