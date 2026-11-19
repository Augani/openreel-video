import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionExecutor,
  getRealtimeAudioGraph,
  type Project,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import {
  createMixerSignalMeter,
  SILENT_SIGNAL_LEVELS,
} from "../../services/audio-mixer-meter";
import { AudioMixer } from "./AudioMixer";

vi.mock("@openreel/core", async (original) => ({
  ...(await original<typeof import("@openreel/core")>()),
  getRealtimeAudioGraph: vi.fn(),
}));
vi.mock("../../services/audio-mixer-meter", async (original) => ({
  ...(await original<typeof import("../../services/audio-mixer-meter")>()),
  createMixerSignalMeter: vi.fn(),
}));

const graph = {
  getMasterVolume: vi.fn(() => 1),
  getTrackVolume: vi.fn(() => 1),
  getTrackPan: vi.fn(() => 0),
  updateTrackVolume: vi.fn(),
  updateTrackPan: vi.fn(),
  setMasterVolume: vi.fn(),
};
const makeMeter = () => ({
  read: vi.fn(() => SILENT_SIGNAL_LEVELS),
  dispose: vi.fn(),
});
const meters: Array<ReturnType<typeof makeMeter>> = [];
const state = () => useProjectStore.getState();
function fixture() {
  const project = createEmptyProject("Mixer", {
    sampleRate: 44100,
    channels: 2,
  });
  const items: Project["mediaLibrary"]["items"] = [
    {
      id: "audio",
      name: "Voice.wav",
      type: "audio",
      blob: null,
      fileHandle: null,
      thumbnailUrl: null,
      waveformData: null,
      metadata: {
        duration: 10,
        width: 0,
        height: 0,
        frameRate: 0,
        codec: "pcm",
        fileSize: 100,
        sampleRate: 44100,
        channels: 2,
      },
    },
    {
      id: "video",
      name: "Camera.mp4",
      type: "video",
      blob: null,
      fileHandle: null,
      thumbnailUrl: null,
      waveformData: null,
      metadata: {
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        codec: "avc",
        fileSize: 100,
        sampleRate: 48000,
        channels: 2,
      },
    },
    {
      id: "silent",
      name: "Silent.mp4",
      type: "video",
      blob: null,
      fileHandle: null,
      thumbnailUrl: null,
      waveformData: null,
      metadata: {
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        codec: "avc",
        fileSize: 100,
        sampleRate: 0,
        channels: 0,
        hasAudio: false,
      },
    },
  ];
  const tracks: Project["timeline"]["tracks"] = [
    "Voice",
    "Camera",
    "Silent",
    "Empty",
  ].map((name, i) => ({
    id: name,
    name,
    type: i === 0 ? ("audio" as const) : ("video" as const),
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    transitions: [],
    clips:
      i > 2
        ? []
        : [
            {
              id: `clip-${i}`,
              mediaId: ["audio", "video", "silent"][i],
              trackId: name,
              startTime: 0,
              duration: 10,
              inPoint: 0,
              outPoint: 10,
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
            },
          ],
  }));
  const executor = new ActionExecutor();
  const next = {
    ...project,
    mediaLibrary: { items },
    timeline: { ...project.timeline, tracks },
  };
  useProjectStore.setState({
    project: next,
    hasOpenProject: true,
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
  });
  return next;
}
function replaceProject(update: (project: Project) => Project) {
  act(() => useProjectStore.setState({ project: update(state().project) }));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  meters.length = 0;
  graph.getMasterVolume.mockReturnValue(1);
  graph.getTrackVolume.mockReturnValue(1);
  graph.getTrackPan.mockReturnValue(0);
  vi.mocked(getRealtimeAudioGraph).mockReturnValue(
    graph as unknown as ReturnType<typeof getRealtimeAudioGraph>,
  );
  vi.mocked(createMixerSignalMeter).mockImplementation(() => {
    const meter = makeMeter();
    meters.push(meter);
    return meter;
  });
  useTimelineStore.setState({ playbackState: "paused" });
  fixture();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("direct shadcn mixer controls", () => {
  it("keeps embedded audio channels and the real project audio settings", () => {
    render(<AudioMixer />);
    expect(
      screen.getByRole("slider", { name: "Voice volume fader" }),
    ).toHaveAttribute("aria-valuemax", "4");
    expect(
      screen.getByRole("slider", { name: "Camera pan control" }),
    ).toHaveAttribute("aria-valuemin", "-1");
    expect(
      screen.queryByRole("slider", { name: "Silent volume fader" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("slider", { name: "Empty volume fader" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Sample Rate:/)).toHaveTextContent(
      "44100Hz | Channels: 2",
    );
    expect(screen.getByText("2 channels")).toBeInTheDocument();
  });
  it("sends exact fader, pan and master keyboard values to the live playback graph", () => {
    render(<AudioMixer />);
    const volume = screen.getByRole("slider", { name: "Voice volume fader" });
    fireEvent.keyDown(volume, { key: "Home" });
    expect(graph.updateTrackVolume).toHaveBeenLastCalledWith("Voice", 0);
    expect(volume).toHaveAttribute("aria-valuetext", "-∞ dB");
    fireEvent.keyDown(volume, { key: "End" });
    expect(graph.updateTrackVolume).toHaveBeenLastCalledWith("Voice", 4);
    expect(volume).toHaveAttribute("aria-valuetext", "+12.0 dB");
    const pan = screen.getByRole("slider", { name: "Voice pan control" });
    fireEvent.keyDown(pan, { key: "Home" });
    expect(graph.updateTrackPan).toHaveBeenLastCalledWith("Voice", -1);
    fireEvent.keyDown(pan, { key: "ArrowRight" });
    expect(graph.updateTrackPan).toHaveBeenLastCalledWith("Voice", -0.99);
    expect(pan).toHaveAttribute("aria-valuetext", "L99");
    const master = screen.getByRole("slider", { name: "Master volume fader" });
    fireEvent.keyDown(master, { key: "Home" });
    expect(graph.setMasterVolume).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(master, { key: "ArrowUp" });
    expect(graph.setMasterVolume).toHaveBeenLastCalledWith(0.01);
  });
  it("reopens with current graph volume and pan, including zero", () => {
    const view = render(<AudioMixer />);
    graph.getTrackVolume.mockReturnValue(0);
    graph.getTrackPan.mockReturnValue(-0.25);
    graph.getMasterVolume.mockReturnValue(0);
    view.rerender(<AudioMixer visible={false} />);
    expect(
      screen.queryByRole("region", { name: "Audio Mixing Console" }),
    ).not.toBeInTheDocument();
    view.rerender(<AudioMixer />);
    expect(
      screen.getByRole("slider", { name: "Voice volume fader" }),
    ).toHaveAttribute("aria-valuenow", "0");
    expect(
      screen.getByRole("slider", { name: "Voice pan control" }),
    ).toHaveAttribute("aria-valuenow", "-0.25");
    expect(
      screen.getByRole("slider", { name: "Master volume fader" }),
    ).toHaveAttribute("aria-valuenow", "0");
  });
  it("retains canonical mute/solo changes and one-step Undo", async () => {
    render(<AudioMixer />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mute Voice" }));
    });
    expect(state().project.timeline.tracks[0].muted).toBe(true);
    expect(screen.getByRole("button", { name: "Mute Voice" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("slider", { name: "Voice volume fader" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("slider", { name: "Voice pan control" }),
    ).toHaveAttribute("aria-disabled", "true");
    await act(async () => {
      await state().undo();
    });
    expect(screen.getByRole("button", { name: "Mute Voice" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Solo Voice" }));
    });
    expect(state().project.timeline.tracks[0].solo).toBe(true);
    expect(screen.getByText("• Solo active")).toBeInTheDocument();
    expect(
      screen.getByRole("slider", { name: "Camera pan control" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("slider", { name: "Camera volume fader" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    await act(async () => {
      await state().undo();
    });
    expect(screen.queryByText("• Solo active")).not.toBeInTheDocument();
  });
});

describe("solo safe", () => {
  it("keeps a solo-safe strip live while another track is soloed, as one undo step", async () => {
    render(<AudioMixer />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Solo Safe Camera" }));
    });
    expect(state().project.timeline.tracks[1].soloSafe).toBe(true);
    expect(screen.getByRole("button", { name: "Solo Safe Camera" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Solo Voice" }));
    });
    // The silent third track is silenced by the solo; the solo-safe Camera keeps playing.
    expect(screen.getByRole("slider", { name: "Camera pan control" })).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Solo Safe Camera" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      await state().undo();
    });
    await act(async () => {
      await state().undo();
    });
    expect(state().project.timeline.tracks[1].soloSafe).toBeUndefined();
    expect(screen.getByRole("button", { name: "Solo Safe Camera" })).toHaveAttribute("aria-pressed", "false");
  });

  it("offers the output device picker in the mixer header", () => {
    render(<AudioMixer />);
    expect(screen.getByTestId("mixer-audio-output-trigger")).toBeInTheDocument();
  });
});

describe("meter lifecycle", () => {
  it("updates actual sample values and stops every tap and interval on pause", () => {
    useTimelineStore.setState({ playbackState: "playing" });
    render(<AudioMixer />);
    expect(createMixerSignalMeter).toHaveBeenCalledTimes(3);
    meters[0].read.mockReturnValue([
      { peak: 0.5, rms: 0.25 },
      { peak: 1, rms: 0.5 },
    ]);
    act(() => vi.advanceTimersByTime(50));
    expect(
      screen.getByRole("meter", { name: "Voice left level" }),
    ).toHaveAttribute("aria-valuetext", "-6.0 dBFS");
    expect(
      screen.getByRole("meter", { name: "Voice right level" }),
    ).toHaveAttribute("aria-valuetext", "0.0 dBFS");
    act(() => useTimelineStore.setState({ playbackState: "paused" }));
    expect(
      screen.getByRole("meter", { name: "Voice left level" }),
    ).toHaveAttribute("aria-valuetext", "−∞ dBFS");
    expect(meters.every((meter) => meter.dispose.mock.calls.length === 1)).toBe(
      true,
    );
    const reads = meters.map((meter) => meter.read.mock.calls.length);
    act(() => vi.advanceTimersByTime(1000));
    expect(meters.map((meter) => meter.read.mock.calls.length)).toEqual(reads);
  });
  it("rebuilds taps only for changed channel membership and disposes them on hiding", () => {
    useTimelineStore.setState({ playbackState: "playing" });
    const view = render(<AudioMixer />);
    const previous = [...meters];
    replaceProject((project) => ({
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.filter((track) => track.id !== "Voice"),
      },
    }));
    expect(
      previous.every((meter) => meter.dispose.mock.calls.length === 1),
    ).toBe(true);
    expect(createMixerSignalMeter).toHaveBeenCalledTimes(5);
    expect(
      screen.queryByRole("slider", { name: "Voice volume fader" }),
    ).not.toBeInTheDocument();
    view.rerender(<AudioMixer visible={false} />);
    expect(meters.every((meter) => meter.dispose.mock.calls.length === 1)).toBe(
      true,
    );
  });
  it("rebinds on same-ID project reload and unmount without overlapping owned taps", () => {
    useTimelineStore.setState({ playbackState: "playing" });
    const view = render(<AudioMixer />);
    const previous = [...meters];
    const executor = new ActionExecutor();
    act(() =>
      useProjectStore.setState({
        actionExecutor: executor,
        actionHistory: executor.getHistory(),
      }),
    );
    expect(
      previous.every((meter) => meter.dispose.mock.calls.length === 1),
    ).toBe(true);
    expect(createMixerSignalMeter).toHaveBeenCalledTimes(6);
    view.unmount();
    expect(meters.every((meter) => meter.dispose.mock.calls.length === 1)).toBe(
      true,
    );
  });
});

describe("buses, outputs and sends", () => {
  const flush = () =>
    act(async () => {
      await Promise.resolve();
    });

  it("adds a bus strip in one undo step, adds a send, mutes the bus, undoes each, and offers the Dialogue/Music/FX preset", async () => {
    render(<AudioMixer />);
    const depth = () => state().actionHistory.getUndoStackSize();
    const start = depth();
    expect(screen.getByTestId("export-stems")).toBeDisabled();
    fireEvent.click(screen.getByTestId("add-bus"));
    await flush();
    expect(depth()).toBe(start + 1);
    const bus = state().project.timeline.audioBuses?.[0];
    expect(bus?.name).toBe("Bus");
    expect(screen.getByTestId(`bus-strip-${bus!.id}`)).toBeInTheDocument();
    expect(screen.getByTestId("export-stems")).toBeEnabled();

    // The "Add send" menu is covered by the e2e spec (Radix menus need a real pointer).
    expect(screen.getByTestId("add-send-Voice")).toBeEnabled();
    const { planAddSend } = await import("@openreel/core");
    await act(async () => {
      await state().applyAudioRouting(planAddSend(state().project.timeline, "Voice", bus!.id));
    });
    expect(screen.getByTestId("sends-Voice")).toHaveTextContent("Sends 1");
    expect(
      state().project.timeline.tracks.find((t) => t.id === "Voice")?.sends,
    ).toMatchObject([{ busId: bus!.id, preFader: false }]);
    expect(depth()).toBe(start + 2);

    fireEvent.click(screen.getByTestId(`bus-mute-${bus!.id}`));
    await flush();
    expect(state().project.timeline.audioBuses?.[0].muted).toBe(true);
    await act(async () => {
      await state().undo();
    });
    expect(state().project.timeline.audioBuses?.[0].muted).toBe(false);
    await act(async () => {
      await state().undo();
    });
    expect(
      state().project.timeline.tracks.find((t) => t.id === "Voice")?.sends,
    ).toBeUndefined();
    await act(async () => {
      await state().undo();
    });
    expect(state().project.timeline.audioBuses).toBeUndefined();
    expect(screen.queryByTestId(`bus-strip-${bus!.id}`)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("add-stem-buses"));
    await flush();
    expect(state().project.timeline.audioBuses?.map((b) => b.name)).toEqual([
      "Dialogue",
      "Music",
      "FX",
    ]);
  });

  it("refuses a routing loop with a message and leaves history alone", async () => {
    render(<AudioMixer />);
    fireEvent.click(screen.getByTestId("add-bus"));
    await flush();
    fireEvent.click(screen.getByTestId("add-bus"));
    await flush();
    const [a, b] = state().project.timeline.audioBuses!;
    const { planSetBusOutput } = await import("@openreel/core");
    const first = await state().applyAudioRouting(
      planSetBusOutput(state().project.timeline, a.id, b.id),
    );
    expect(first.success).toBe(true);
    const before = state().actionHistory.getUndoStackSize();
    const second = await state().applyAudioRouting(
      planSetBusOutput(state().project.timeline, b.id, a.id),
    );
    expect(second.success).toBe(false);
    expect(second.error?.message).toMatch(/routing loop/);
    expect(state().actionHistory.getUndoStackSize()).toBe(before);
  });
});
