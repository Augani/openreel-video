import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { setQuickAudioDucking } from "./quick-audio-ducking";

const mocks = vi.hoisted(() => ({ buffer: vi.fn() }));
vi.mock("./audio-ducking-buffer", () => ({
  buildTriggerTrackBuffer: mocks.buffer,
}));
const makeClip = (id: string, trackId: string): Clip => ({
  id,
  trackId,
  mediaId: id,
  startTime: 0,
  duration: 4,
  inPoint: 0,
  outPoint: 4,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    anchor: { x: 0.5, y: 0.5 },
    rotation: 0,
    opacity: 1,
  },
});
const current = () => useProjectStore.getState().getClip("music")!;
beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.getState().createNewProject("Quick ducking QA");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        duration: 4,
        tracks: [
          {
            id: "music-track",
            type: "audio",
            role: "music",
            name: "Music",
            clips: [
              {
                ...makeClip("music", "music-track"),
                automation: { volume: [{ time: 0, value: 0.8 }] },
              },
            ],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
          {
            id: "dialogue-track",
            type: "audio",
            role: "dialogue",
            name: "Dialogue",
            clips: [makeClip("voice", "dialogue-track")],
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
  const samples = new Float32Array(4000);
  samples.fill(0.5, 1000, 3000);
  mocks.buffer.mockResolvedValue({
    sampleRate: 1000,
    length: samples.length,
    duration: 4,
    numberOfChannels: 1,
    getChannelData: () => samples,
  });
});
describe("quick audio ducking", () => {
  it("uses real presence analysis, preserves previous automation and commits each switch change as one Undo step", async () => {
    await setQuickAudioDucking("music", true);
    expect(current().metadata?.audioDucking).toMatchObject({
      enabled: true,
      sourceTrackId: "dialogue-track",
    });
    expect(
      current().automation?.volume?.some((point) => point.value < 0.5),
    ).toBe(true);
    expect(useProjectStore.getState().actionHistory.getUndoStackSize()).toBe(1);
    await setQuickAudioDucking("music", false);
    expect(current().metadata?.audioDucking).toBeUndefined();
    expect(current().automation?.volume).toEqual([{ time: 0, value: 0.8 }]);
    await useProjectStore.getState().undo();
    expect(current().metadata?.audioDucking).toMatchObject({ enabled: true });
    await useProjectStore.getState().undo();
    expect(current().automation?.volume).toEqual([{ time: 0, value: 0.8 }]);
  });
  it("does not publish stale analysis over an intervening edit", async () => {
    let finish!: (buffer: unknown) => void;
    const buffer = await mocks.buffer();
    mocks.buffer.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = setQuickAudioDucking("music", true);
    await useProjectStore.getState().renameProject("User changed the project");
    finish(buffer);
    await expect(pending).rejects.toThrow(/project changed/i);
    expect(current().automation?.volume).toEqual([{ time: 0, value: 0.8 }]);
    expect(current().metadata?.audioDucking).toBeUndefined();
  });
  it("keeps the original automation when no overlapping dialogue is available", async () => {
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.filter(
            (track) => track.role !== "dialogue",
          ),
        },
      },
    });
    await expect(setQuickAudioDucking("music", true)).rejects.toThrow(
      /overlapping audio/,
    );
    expect(mocks.buffer).not.toHaveBeenCalled();
    expect(current().automation?.volume).toEqual([{ time: 0, value: 0.8 }]);
  });
});
