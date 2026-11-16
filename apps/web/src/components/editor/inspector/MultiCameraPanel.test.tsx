import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  analyzeSileroVad,
  ActionExecutor,
  multicamEngine,
  type Clip,
  createOrmaArtifact,
  extractMulticamSocialClips,
  DEFAULT_MULTICAM_MANIFEST_CONSTRAINTS,
  downloadBlob,
  serializeMulticamManifest,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { MultiCameraPanel } from "./MultiCameraPanel";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";

import { transcribeMulticamChannels } from "../../../services/multicam-transcription";
import { analyzeMulticamFaceReactions } from "../../../services/multicam-face-reactions";
import { loadAudioBuffer } from "../../../utils/load-audio-buffer";
import {
  loadMulticamArtifact,
  saveMulticamArtifact,
} from "../../../services/multicam-analysis-store";
import {
  buildMulticamManifest,
  resolveMulticamSources,
  analyzeMulticamSyncInWorker,
} from "./multicam-workflow";
vi.mock("../../../services/multicam-transcription", () => ({
  transcribeMulticamChannels: vi.fn(),
}));
vi.mock("../../../services/multicam-face-reactions", () => ({
  analyzeMulticamFaceReactions: vi.fn(),
}));
vi.mock("../../../utils/load-audio-buffer", () => ({
  loadAudioBuffer: vi.fn(),
}));
vi.mock("../../../services/multicam-analysis-store", () => ({
  saveMulticamArtifact: vi.fn().mockResolvedValue("artifact"),
  loadMulticamArtifact: vi.fn(),
}));
vi.mock("@openreel/core", async (original) => {
  const actual = await original<typeof import("@openreel/core")>();
  return {
    ...actual,
    analyzeSileroVad: vi.fn(),
    extractMulticamSocialClips: vi.fn(),
    planMulticamShots: vi.fn(actual.planMulticamShots),
    downloadBlob: vi.fn(),
  };
});
vi.mock("./multicam-workflow", async (original) => ({
  ...(await original<typeof import("./multicam-workflow")>()),
  analyzeMulticamSyncInWorker: vi.fn(),
}));

const clip = (id: string): Clip => ({
  id,
  mediaId: id,
  trackId: id,
  startTime: 2,
  duration: 8,
  inPoint: 1,
  outPoint: 9,
  effects: [],
  audioEffects: [],
  keyframes: [],
  volume: 1,
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
});
const store = () => useProjectStore.getState();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(transcribeMulticamChannels).mockResolvedValue({
    angle_1: [{ startMs: 0, endMs: 1000, text: "Hello" }],
  });
  vi.mocked(analyzeMulticamFaceReactions).mockResolvedValue([]);
  vi.mocked(loadAudioBuffer).mockReset();
  vi.mocked(analyzeMulticamSyncInWorker).mockReset();
  vi.mocked(loadMulticamArtifact).mockReset();
  vi.mocked(extractMulticamSocialClips).mockReturnValue([
    { startMs: 1000, endMs: 5000, score: 1, reason: "conversation" },
  ]);
  useEditorWorkspaceStore.setState({ multiCameraOpen: false });
  multicamEngine.loadGroups([]);
  const project = createEmptyProject("Multicam");
  const executor = new ActionExecutor();
  useProjectStore.setState({
    hasOpenProject: true,
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
    project: {
      ...project,
      mediaLibrary: {
        items: ["Camera A", "Camera B"].map((id) => ({
          id,
          name: `${id}.mp4`,
          type: "video" as const,
          blob: null,
          fileHandle: null,
          thumbnailUrl: null,
          waveformData: null,
          metadata: {
            duration: 12,
            width: 1920,
            height: 1080,
            frameRate: 30,
            codec: "h264",
            sampleRate: 48000,
            channels: 2,
            fileSize: 1,
          },
        })),
      },
      timeline: {
        ...project.timeline,
        duration: 10,
        tracks: ["Camera A", "Camera B"].map((id) => ({
          id,
          name: id,
          type: "audio" as const,
          clips: [clip(id)],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        })),
      },
    },
  });
  useUIStore.getState().clearSelection();
  useTimelineStore.setState({ playheadPosition: 5 });
});
afterEach(() => {
  cleanup();
  multicamEngine.loadGroups([]);
  useUIStore.getState().clearSelection();
});

async function createGroup() {
  render(<MultiCameraPanel />);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Camera A.mp4 Camera A" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Camera B.mp4 Camera B" }),
  );
  const button = screen.getByRole("button", {
    name: "Create Group (2 selected)",
  });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(store().project.multicamGroups).toHaveLength(1));
}

describe("multicam inspector workflow", () => {
  it("selects each source once and creates an undoable persisted group", async () => {
    await createGroup();
    expect(
      store().project.multicamGroups?.[0]?.angles.map((angle) => angle.clipId),
    ).toEqual(["Camera A", "Camera B"]);
    expect(await useEngineStore.getState().getMultiCamEngine()).toBe(
      multicamEngine,
    );
    await act(async () => {
      await store().undo();
    });
    expect(multicamEngine.getAllGroups()).toHaveLength(0);
    await act(async () => {
      await store().redo();
    });
    expect(multicamEngine.getAllGroups()).toHaveLength(1);
  });
  it("writes an actual camera cut at the playhead with trimmed source mapping and one-step undo", async () => {
    await createGroup();
    fireEvent.click(
      screen.getByRole("button", { name: "Cut to Angle 2 at playhead" }),
    );
    await waitFor(() =>
      expect(store().project.timeline.tracks).toHaveLength(3),
    );
    const output = store().project.timeline.tracks[0]!;
    expect(
      output.clips.map((entry) => [
        entry.mediaId,
        entry.startTime,
        entry.duration,
        entry.inPoint,
        entry.outPoint,
      ]),
    ).toEqual([
      ["Camera A", 2, 3, 1, 4],
      ["Camera B", 5, 5, 4, 9],
    ]);
    expect(
      store()
        .project.timeline.tracks.slice(1)
        .every((track) => track.hidden && track.muted),
    ).toBe(true);
    await act(async () => {
      await store().undo();
    });
    expect(store().project.timeline.tracks).toHaveLength(2);
    expect(
      store().project.timeline.tracks.every(
        (track) => !track.hidden && !track.muted,
      ),
    ).toBe(true);
    expect(multicamEngine.getAllGroups()[0]?.switches).toEqual([]);
  });
  it("creates a playable automatic edit through the decode, sync, analysis, and timeline workflow", async () => {
    const project = store().project;
    useProjectStore.setState({
      project: {
        ...project,
        mediaLibrary: {
          items: project.mediaLibrary.items.map((media) => ({
            ...media,
            blob: new Blob([media.id]),
          })),
        },
      },
    });
    let channel = 0;
    vi.mocked(loadAudioBuffer).mockImplementation(async () => {
      const index = channel++;
      const samples = Float32Array.from({ length: 24000 }, (_, sample) => {
        const speaking = index === 0 ? sample < 12000 : sample >= 12000;
        return Math.sin(sample * 0.2) * (speaking ? 0.5 : 0.001);
      });
      return {
        sampleRate: 2000,
        length: samples.length,
        duration: 12,
        numberOfChannels: 1,
        getChannelData: () => samples,
      } as unknown as AudioBuffer;
    });
    vi.mocked(analyzeMulticamSyncInWorker).mockImplementation(
      async (buffers) => ({
        results: new Map(
          [...buffers.keys()].map((id) => [
            id,
            { offset: 0, confidence: 1, method: "audio" as const },
          ]),
        ),
        drift: {},
      }),
    );
    vi.mocked(analyzeSileroVad).mockResolvedValue({
      windowMs: 50,
      probabilities: new Float32Array(240).fill(0.99),
    });
    await createGroup();
    fireEvent.click(screen.getByRole("button", { name: "Auto Edit" }));
    await waitFor(() =>
      expect(store().project.timeline.tracks.length).toBeGreaterThan(2),
    );
    const group = store().project.multicamGroups![0]!;
    expect(group.shotPlan?.shots.length).toBeGreaterThan(0);
    expect(group.outputTrackId).toBeTruthy();
    const output = store().project.timeline.tracks.find(
      (track) => track.id === group.outputTrackId,
    )!;
    expect(output.hidden).toBe(false);
    expect(output.muted).toBe(false);
    expect(
      output.clips.every(
        (entry) =>
          entry.inPoint >= 1 && entry.outPoint <= 9 && entry.duration > 0,
      ),
    ).toBe(true);
    await act(async () => {
      await store().undo();
    });
    expect(store().project.timeline.tracks).toHaveLength(2);
    expect(store().project.multicamGroups![0]!.outputTrackId).toBeUndefined();
  });

  it("restores saved groups when the panel opens and clears them for another project", async () => {
    await createGroup();
    const saved = structuredClone(store().project);
    cleanup();
    multicamEngine.loadGroups([]);
    store().loadProject(saved);
    render(<MultiCameraPanel />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Multi-Cam 1" }),
      ).toBeInTheDocument(),
    );
    await act(async () => {
      store().loadProject(createEmptyProject("Next project"));
    });
    expect(multicamEngine.getAllGroups()).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Multi-Cam 1" }),
    ).not.toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const audioBuffer = () =>
  ({
    sampleRate: 2000,
    length: 24000,
    duration: 12,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(24000),
  }) as unknown as AudioBuffer;
async function reviewableGroup() {
  await createGroup();
  const group = multicamEngine.getAllGroups()[0]!;
  group.manifest = buildMulticamManifest(
    store().project,
    group,
    resolveMulticamSources(store().project, group),
    DEFAULT_MULTICAM_MANIFEST_CONSTRAINTS,
  );
  group.shotPlan = {
    spec: "openreel-multicam-edit/v1",
    durationMs: 8000,
    shots: [],
  };
  await act(async () => {
    await store().executeAction({
      type: "multicam/setAll",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      params: { groups: [group] },
    });
  });
  return createOrmaArtifact({
    manifest: group.manifest,
    media: [],
    activity: { angleIds: [], duration: 8, windowMs: 50, points: [] },
  });
}
describe("multicam asynchronous ownership", () => {
  it("does not add delayed social markers to another project", async () => {
    const artifact = await reviewableGroup();
    const pending = deferred<typeof artifact>();
    vi.mocked(loadMulticamArtifact).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "Find clips" }));
    await waitFor(() => expect(loadMulticamArtifact).toHaveBeenCalledOnce());
    await act(async () =>
      store().loadProject(createEmptyProject("Next project")),
    );
    await act(async () => pending.resolve(artifact));
    expect(store().project.timeline.markers ?? []).toEqual([]);
  });
  it("stops decoding further cameras after its panel unmounts", async () => {
    const project = store().project;
    useProjectStore.setState({
      project: {
        ...project,
        mediaLibrary: {
          items: project.mediaLibrary.items.map((media) => ({
            ...media,
            blob: new Blob([media.id]),
          })),
        },
      },
    });
    const pending = deferred<AudioBuffer>();
    vi.mocked(loadAudioBuffer)
      .mockResolvedValue(audioBuffer())
      .mockReturnValueOnce(pending.promise);
    vi.mocked(analyzeMulticamSyncInWorker).mockResolvedValue({
      results: new Map(),
      drift: {},
    });
    await createGroup();
    fireEvent.click(screen.getByRole("button", { name: "Sync Audio" }));
    await waitFor(() => expect(loadAudioBuffer).toHaveBeenCalledOnce());
    cleanup();
    await act(async () => pending.resolve(audioBuffer()));
    expect(loadAudioBuffer).toHaveBeenCalledOnce();
    expect(analyzeMulticamSyncInWorker).not.toHaveBeenCalled();
  });
});

function attachAudio() {
  const project = store().project;
  useProjectStore.setState({
    project: {
      ...project,
      mediaLibrary: {
        items: project.mediaLibrary.items.map((media) => ({
          ...media,
          blob: new Blob([media.id]),
        })),
      },
    },
  });
  let channel = 0;
  vi.mocked(loadAudioBuffer).mockImplementation(async () => {
    const index = channel++;
    const samples = Float32Array.from(
      { length: 24000 },
      (_, sample) =>
        Math.sin(sample * 0.2) *
        ((index === 0 ? sample < 12000 : sample >= 12000) ? 0.5 : 0.001),
    );
    return { ...audioBuffer(), getChannelData: () => samples };
  });
  vi.mocked(analyzeMulticamSyncInWorker).mockImplementation(
    async (buffers) => ({
      results: new Map(
        [...buffers.keys()].map((id) => [
          id,
          { offset: 0, confidence: 1, method: "audio" as const },
        ]),
      ),
      drift: {},
    }),
  );
  vi.mocked(analyzeSileroVad).mockResolvedValue({
    windowMs: 50,
    probabilities: new Float32Array(240).fill(0.99),
  });
}
function settings() {
  fireEvent.click(
    screen.getByRole("button", { name: "Automatic edit settings" }),
  );
}
async function autoEdit() {
  fireEvent.click(screen.getByRole("button", { name: "Auto Edit" }));
  await waitFor(() =>
    expect(store().project.multicamGroups?.[0]?.outputTrackId).toBeTruthy(),
  );
}
describe("full multicamera controls", () => {
  it("commits exact offsets once and supports Undo, while invalid drafts stay local", async () => {
    await createGroup();
    const input = screen.getByRole("textbox", { name: "Offset for Angle 2" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "-0.123456789" } });
    expect(store().project.multicamGroups![0]!.angles[1]!.offset).toBe(0);
    fireEvent.blur(input);
    await waitFor(() =>
      expect(store().project.multicamGroups![0]!.angles[1]!.offset).toBe(
        -0.123456789,
      ),
    );
    await act(async () => {
      await store().undo();
    });
    expect(store().project.multicamGroups![0]!.angles[1]!.offset).toBe(0);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1junk" } });
    fireEvent.blur(input);
    expect(store().project.multicamGroups![0]!.angles[1]!.offset).toBe(0);
    expect(input).toHaveValue("0");
  });
  it("keeps social markers in one undo step and exports the retained manifest/artifact formats", async () => {
    const artifact = await reviewableGroup();
    vi.mocked(loadMulticamArtifact).mockResolvedValue(artifact);
    vi.mocked(extractMulticamSocialClips).mockReturnValue([
      { startMs: 1000, endMs: 4000, score: 1, reason: "a" },
      { startMs: 2000, endMs: 6000, score: 1, reason: "b" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Find clips" }));
    await waitFor(() =>
      expect(store().project.timeline.markers).toHaveLength(2),
    );
    await act(async () => {
      await store().undo();
    });
    expect(store().project.timeline.markers).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Export manifest" }));
    expect(downloadBlob).toHaveBeenLastCalledWith(
      expect.any(Blob),
      "Multi-Cam-1.multicam.json",
    );
    fireEvent.click(screen.getByRole("button", { name: "Export OTIO" }));
    expect(downloadBlob).toHaveBeenLastCalledWith(
      expect.any(Blob),
      "Multi-Cam-1.otio",
    );
    fireEvent.click(screen.getByRole("button", { name: "Export .orma" }));
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenLastCalledWith(
        expect.any(Blob),
        "Multi-Cam-1.orma",
      ),
    );
  });
  it("imports a manifest through the full file input and retains camera mapping", async () => {
    await reviewableGroup();
    const original = store().project.multicamGroups![0]!.manifest!;
    const file = new File(
      [serializeMulticamManifest(original)],
      "cameras.json",
      { type: "application/json" },
    );
    Object.defineProperty(file, "text", {
      value: async () => serializeMulticamManifest(original),
    });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Import manifest" }),
      ).toBeEnabled(),
    );
    expect(
      store().project.multicamGroups![0]!.manifest?.cameras.map(
        (camera) => camera.clipId,
      ),
    ).toEqual(["Camera A", "Camera B"]);
  });
  it("does not export a delayed artifact after the same project is reloaded", async () => {
    const artifact = await reviewableGroup();
    const pending = deferred<typeof artifact>();
    vi.mocked(loadMulticamArtifact).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "Export .orma" }));
    await waitFor(() => expect(loadMulticamArtifact).toHaveBeenCalledOnce());
    const saved = structuredClone(store().project);
    await act(async () => store().loadProject(saved));
    await act(async () => pending.resolve(artifact));
    expect(downloadBlob).not.toHaveBeenCalled();
  });
  it("never publishes an imported manifest after the panel closes", async () => {
    await reviewableGroup();
    const before = structuredClone(store().project.multicamGroups);
    const pending = deferred<string>();
    const file = new File(["pending"], "cameras.yaml");
    Object.defineProperty(file, "text", { value: () => pending.promise });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    cleanup();
    await act(async () =>
      pending.resolve(serializeMulticamManifest(before![0]!.manifest!)),
    );
    expect(store().project.multicamGroups).toEqual(before);
  });
  it("keeps intermediate synchronization changes out of the canonical engine and history", async () => {
    attachAudio();
    await createGroup();
    const before = structuredClone(store().project.multicamGroups);
    const pending =
      deferred<Awaited<ReturnType<typeof analyzeMulticamSyncInWorker>>>();
    vi.mocked(analyzeMulticamSyncInWorker).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "Sync Audio" }));
    await waitFor(() =>
      expect(analyzeMulticamSyncInWorker).toHaveBeenCalledOnce(),
    );
    cleanup();
    await act(async () =>
      pending.resolve({
        results: new Map([
          ["angle_2", { offset: 2, confidence: 1, method: "audio" }],
        ]),
        drift: {},
      }),
    );
    expect(store().project.multicamGroups).toEqual(before);
    expect(multicamEngine.getAllGroups()).toEqual(before);
    expect(saveMulticamArtifact).not.toHaveBeenCalled();
  });
});

describe("multicamera retained workflows", () => {
  it("retains manual offsets, shot bounds and optional local analysis inputs", async () => {
    attachAudio();
    await createGroup();
    settings();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sync cameras before Auto Edit" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Add per-channel local Whisper transcripts",
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Add local MediaPipe face/reaction cues",
      }),
    );
    for (const [name, value] of [
      ["Minimum shot", "2.75"],
      ["Maximum shot", "18.25"],
    ]) {
      const input = screen.getByRole("textbox", { name });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    }
    await autoEdit();
    expect(analyzeMulticamSyncInWorker).not.toHaveBeenCalled();
    expect(transcribeMulticamChannels).toHaveBeenCalledOnce();
    expect(analyzeMulticamFaceReactions).toHaveBeenCalledOnce();
    expect(
      store().project.multicamGroups![0]!.manifest!.constraints,
    ).toMatchObject({ min_shot_ms: 2750, max_shot_ms: 18250 });
    expect(
      vi.mocked(saveMulticamArtifact).mock.calls.at(-1)?.[2].transcripts,
    ).toEqual({ angle_1: [{ startMs: 0, endMs: 1000, text: "Hello" }] });
  });
  it("keeps cut accept, nudge and reject edits undoable", async () => {
    await createGroup();
    fireEvent.click(
      screen.getByRole("button", { name: "Cut to Angle 2 at playhead" }),
    );
    await waitFor(() =>
      expect(store().project.timeline.tracks).toHaveLength(3),
    );
    const review = () =>
      screen.getByRole("group", { name: "Cut at 3.00 seconds" });
    fireEvent.click(within(review()).getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(
        within(review()).getByRole("button", { name: "Accepted" }),
      ).toBeDisabled(),
    );
    fireEvent.click(within(review()).getByRole("button", { name: "+100 ms" }));
    await waitFor(() =>
      expect(
        store().project.multicamGroups![0]!.switches!.at(-1)!.time,
      ).toBeCloseTo(3.1),
    );
    await act(async () => {
      await store().undo();
    });
    expect(store().project.multicamGroups![0]!.switches!.at(-1)!.time).toBe(3);
    fireEvent.click(within(review()).getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(store().project.multicamGroups![0]!.switches).toHaveLength(1),
    );
    await act(async () => {
      await store().undo();
    });
    expect(store().project.multicamGroups![0]!.switches).toHaveLength(2);
  });
  it("keeps angle removal and group deletion undoable", async () => {
    await createGroup();
    fireEvent.click(screen.getByRole("button", { name: "Remove Angle 2" }));
    await waitFor(() =>
      expect(store().project.multicamGroups![0]!.angles).toHaveLength(1),
    );
    await act(async () => {
      await store().undo();
    });
    expect(store().project.multicamGroups![0]!.angles).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete camera group" }),
    );
    await waitFor(() => expect(store().project.multicamGroups).toHaveLength(0));
    await act(async () => {
      await store().undo();
    });
    expect(store().project.multicamGroups).toHaveLength(1);
  });
});

