import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { analyzeSileroVad, ActionExecutor, multicamEngine, type Clip } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { MultiCameraPanel } from "./MultiCameraPanel";
import { InspectorPanel } from "../InspectorPanel";

import { loadAudioBuffer } from "../../../utils/load-audio-buffer";
import { analyzeMulticamSyncInWorker } from "./multicam-workflow";
vi.mock("../../../utils/load-audio-buffer", () => ({ loadAudioBuffer: vi.fn() }));
vi.mock("../../../services/multicam-analysis-store", () => ({ saveMulticamArtifact: vi.fn().mockResolvedValue("artifact"), loadMulticamArtifact: vi.fn() }));
vi.mock("@openreel/core", async (original) => ({ ...await original<typeof import("@openreel/core")>(), analyzeSileroVad: vi.fn() }));
vi.mock("./multicam-workflow", async (original) => ({ ...await original<typeof import("./multicam-workflow")>(), analyzeMulticamSyncInWorker: vi.fn() }));

const clip = (id: string): Clip => ({
  id, mediaId: id, trackId: id, startTime: 2, duration: 8, inPoint: 1, outPoint: 9,
  effects: [], audioEffects: [], keyframes: [], volume: 1,
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
});
const store = () => useProjectStore.getState();
beforeEach(() => {
  vi.clearAllMocks();
  multicamEngine.loadGroups([]);
  const project = createEmptyProject("Multicam");
  useProjectStore.setState({ hasOpenProject: true, actionExecutor: new ActionExecutor(), project: {
    ...project,
    mediaLibrary: { items: ["Camera A", "Camera B"].map((id) => ({
      id, name: `${id}.mp4`, type: "video" as const, blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null,
      metadata: { duration: 12, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
    })) },
    timeline: { ...project.timeline, duration: 10, tracks: ["Camera A", "Camera B"].map((id) => ({
      id, name: id, type: "audio" as const, clips: [clip(id)], transitions: [], locked: false, hidden: false, muted: false, solo: false,
    })) },
  } });
  useUIStore.getState().clearSelection();
  useTimelineStore.setState({ playheadPosition: 5 });
});
afterEach(() => { cleanup(); multicamEngine.loadGroups([]); useUIStore.getState().clearSelection(); });

async function createGroup() {
  render(<MultiCameraPanel />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Camera A.mp4 Camera A" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Camera B.mp4 Camera B" }));
  const button = screen.getByRole("button", { name: "Create Group (2 selected)" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(store().project.multicamGroups).toHaveLength(1));
}

describe("multicam inspector workflow", () => {
  it("selects each source once and creates an undoable persisted group", async () => {
    await createGroup();
    expect(store().project.multicamGroups?.[0]?.angles.map((angle) => angle.clipId)).toEqual(["Camera A", "Camera B"]);
    expect(await useEngineStore.getState().getMultiCamEngine()).toBe(multicamEngine);
    await act(async () => { await store().undo(); });
    expect(multicamEngine.getAllGroups()).toHaveLength(0);
    await act(async () => { await store().redo(); });
    expect(multicamEngine.getAllGroups()).toHaveLength(1);
  });
  it("writes an actual camera cut at the playhead with trimmed source mapping and one-step undo", async () => {
    await createGroup();
    fireEvent.click(screen.getByRole("button", { name: "Cut to Angle 2 at playhead" }));
    await waitFor(() => expect(store().project.timeline.tracks).toHaveLength(3));
    const output = store().project.timeline.tracks[0]!;
    expect(output.clips.map((entry) => [entry.mediaId, entry.startTime, entry.duration, entry.inPoint, entry.outPoint])).toEqual([
      ["Camera A", 2, 3, 1, 4], ["Camera B", 5, 5, 4, 9],
    ]);
    expect(store().project.timeline.tracks.slice(1).every((track) => track.hidden && track.muted)).toBe(true);
    await act(async () => { await store().undo(); });
    expect(store().project.timeline.tracks).toHaveLength(2);
    expect(store().project.timeline.tracks.every((track) => !track.hidden && !track.muted)).toBe(true);
    expect(multicamEngine.getAllGroups()[0]?.switches).toEqual([]);
  });
  it("creates a playable automatic edit through the decode, sync, analysis, and timeline workflow", async () => {
    const project = store().project;
    useProjectStore.setState({ project: { ...project, mediaLibrary: { items: project.mediaLibrary.items.map((media) => ({ ...media, blob: new Blob([media.id]) })) } } });
    let channel = 0;
    vi.mocked(loadAudioBuffer).mockImplementation(async () => {
      const index = channel++;
      const samples = Float32Array.from({ length: 24000 }, (_, sample) => {
        const speaking = index === 0 ? sample < 12000 : sample >= 12000;
        return Math.sin(sample * 0.2) * (speaking ? 0.5 : 0.001);
      });
      return { sampleRate: 2000, length: samples.length, duration: 12, numberOfChannels: 1, getChannelData: () => samples } as unknown as AudioBuffer;
    });
    vi.mocked(analyzeMulticamSyncInWorker).mockImplementation(async (buffers) => ({
      results: new Map([...buffers.keys()].map((id) => [id, { offset: 0, confidence: 1, method: "audio" as const }])), drift: {},
    }));
    vi.mocked(analyzeSileroVad).mockResolvedValue({ windowMs: 50, probabilities: new Float32Array(240).fill(0.99) });
    await createGroup();
    fireEvent.click(screen.getByRole("button", { name: "Auto Edit" }));
    await waitFor(() => expect(store().project.timeline.tracks.length).toBeGreaterThan(2));
    const group = store().project.multicamGroups![0]!;
    expect(group.shotPlan?.shots.length).toBeGreaterThan(0);
    expect(group.outputTrackId).toBeTruthy();
    const output = store().project.timeline.tracks.find((track) => track.id === group.outputTrackId)!;
    expect(output.hidden).toBe(false);
    expect(output.muted).toBe(false);
    expect(output.clips.every((entry) => entry.inPoint >= 1 && entry.outPoint <= 9 && entry.duration > 0)).toBe(true);
    await act(async () => { await store().undo(); });
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Multi-Cam 1" })).toBeInTheDocument());
    await act(async () => { store().loadProject(createEmptyProject("Next project")); });
    expect(multicamEngine.getAllGroups()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Multi-Cam 1" })).not.toBeInTheDocument();
  });
  it("is discoverable in the inspector with no selection and preselects timeline cameras when opened", async () => {
    useUIStore.getState().selectMultiple(["Camera A", "Camera B"].map((id) => ({ type: "clip", id, trackId: id })));
    render(<InspectorPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Expand Multi-Camera Editing section" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create Group (2 selected)" })).toBeEnabled());
    await act(async () => { useUIStore.getState().clearSelection(); });
    expect(screen.getByRole("button", { name: "Collapse Multi-Camera Editing section" })).toBeInTheDocument();
  });
});
