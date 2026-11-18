import { loadAudioBuffer } from "../../../utils/load-audio-buffer";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionExecutor,
  ActionHistory,
  SpectralNoiseReducer,
  autoLearnNoiseProfile,
  type Project,
} from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { createNoiseReductionEffect } from "../../../bridges/audio-bridge-effects";
import * as bridge from "../../../bridges/audio-bridge-effects";
import { NoiseReductionSection } from "./NoiseReductionSection";
vi.mock("../../../utils/load-audio-buffer", () => ({
  loadAudioBuffer: vi.fn(),
}));
vi.mock("@openreel/core", async () => ({
  ...(await vi.importActual<typeof import("@openreel/core")>("@openreel/core")),
  autoLearnNoiseProfile: vi.fn(),
}));

const profile = () => ({
  frequencyBins: new Float32Array([80, 250, 1000, 4000]),
  magnitudes: new Float32Array([0.4, 0.4, 0.4, 0.4]),
  standardDeviations: new Float32Array([0.02, 0.02, 0.02, 0.02]),
  sampleRate: 48000,
  fftSize: 8,
});
function project(disabled = false): Project {
  const base = createEmptyProject("Noise lifecycle");
  const effect = {
    ...createNoiseReductionEffect({
      threshold: -36,
      reduction: 0.64,
      attack: 9,
      release: 130,
      focus: "speech",
    }),
    enabled: !disabled,
  };
  return {
    ...base,
    id: "noise-project",
    mediaLibrary: {
      items: [
        {
          id: "source",
          name: "source.wav",
          type: "audio",
          blob: new Blob(["source"]),
          fileHandle: null,
          thumbnailUrl: null,
          waveformData: null,
          metadata: {
            duration: 6,
            width: 0,
            height: 0,
            frameRate: 0,
            sampleRate: 48000,
            channels: 1,
            codec: "pcm",
            fileSize: 6,
            hasAudio: true,
          },
        },
      ],
    },
    timeline: {
      ...base.timeline,
      duration: 6,
      tracks: [
        {
          id: "track",
          name: "Audio",
          type: "audio",
          clips: [
            {
              id: "clip",
              mediaId: "source",
              trackId: "track",
              startTime: 0,
              duration: 6,
              inPoint: 0,
              outPoint: 6,
              volume: 1,
              effects: [],
              audioEffects: [effect],
              keyframes: [],
              transform: {
                position: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotation: 0,
                anchor: { x: 0.5, y: 0.5 },
                opacity: 1,
              },
            },
          ],
          transitions: [],
          hidden: false,
          muted: false,
          solo: false,
          locked: false,
        },
      ],
    },
  };
}
const effect = () => useProjectStore.getState().getAudioEffects("clip")[0];
function deferredAnalysis() {
  let finish!: (value: ReturnType<typeof profile>) => void;
  vi.mocked(autoLearnNoiseProfile).mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  return async () => {
    await act(async () => finish(profile()));
  };
}
beforeEach(() => {
  useUIStore
    .getState()
    .setExportState({ isExporting: false, progress: 0, phase: "" });
  vi.mocked(loadAudioBuffer).mockResolvedValue(
    new OfflineAudioContext(1, 1, 48000).createBuffer(1, 288000, 48000),
  );
  const history = new ActionHistory();
  useProjectStore.setState({
    project: project(),
    hasOpenProject: true,
    actionHistory: history,
    actionExecutor: new ActionExecutor(history),
  });
  vi.mocked(autoLearnNoiseProfile).mockReset();
  vi.mocked(autoLearnNoiseProfile).mockResolvedValue(profile());

  vi.spyOn(SpectralNoiseReducer.prototype, "learnNoiseProfile").mockReturnValue(
    profile(),
  );
  vi.spyOn(bridge, "initializeAudioBridgeEffects").mockResolvedValue(
    bridge.getAudioBridgeEffects(),
  );
});
afterEach(() => {
  cleanup();
  useUIStore
    .getState()
    .setExportState({ isExporting: false, progress: 0, phase: "" });
  vi.restoreAllMocks();
});
describe("owned noise reduction controls", () => {
  it("clears a completed preset message when history replaces its effect", async () => {
    render(<NoiseReductionSection clipId="clip" />);
    fireEvent.click(
      screen.getByRole("radio", { name: "Use White Noise noise reduction" }),
    );
    await screen.findByText("White Noise learned and applied to this clip.");
    await act(async () => {
      await useProjectStore.getState().undo();
    });
    expect(effect().params.profile).toBeUndefined();
    expect(
      screen.queryByText("White Noise learned and applied to this clip."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Analyze & Recommend" }),
    ).not.toBeDisabled();
  });
  it("finishes with the applied preset when export blocks a late learned profile", async () => {
    const complete = deferredAnalysis();
    render(<NoiseReductionSection clipId="clip" />);
    fireEvent.click(
      screen.getByRole("radio", { name: "Use White Noise noise reduction" }),
    );
    await waitFor(() => expect(autoLearnNoiseProfile).toHaveBeenCalledOnce());
    act(() =>
      useUIStore
        .getState()
        .setExportState({ isExporting: true, progress: 0, phase: "rendering" }),
    );
    await complete();
    await screen.findByText("White Noise applied to this clip.");
    expect(effect().params.focus).toBe("whiteNoise");
    expect(effect().params.profile).toBeUndefined();
    expect(
      screen.queryByRole("button", { name: "Cancel analysis" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cleanup Applied" }),
    ).not.toBeDisabled();
  });
  it("retains a blocked recommendation for retry without reanalyzing", async () => {
    render(<NoiseReductionSection clipId="clip" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Analyze & Recommend" }),
    );
    await screen.findByRole("button", { name: "Apply Recommended Cleanup" });
    act(() =>
      useUIStore
        .getState()
        .setExportState({ isExporting: true, progress: 0, phase: "rendering" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply Recommended Cleanup" }),
    );
    expect(
      screen.getByRole("button", { name: "Apply Recommended Cleanup" }),
    ).toBeInTheDocument();
    expect(effect().params.profile).toBeUndefined();
    act(() =>
      useUIStore
        .getState()
        .setExportState({ isExporting: false, progress: 0, phase: "" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply Recommended Cleanup" }),
    );
    await waitFor(() => expect(effect().params.profile).toBeDefined());
    expect(autoLearnNoiseProfile).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Apply Recommended Cleanup" }),
    ).not.toBeInTheDocument();
  });
  it("persists manual changes while the effect is disabled", async () => {
    useProjectStore.setState({ project: project(true) });
    render(<NoiseReductionSection clipId="clip" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Threshold value" }),
    );
    const input = screen.getByRole("textbox", { name: "Threshold value" });
    fireEvent.change(input, { target: { value: "-51" } });
    fireEvent.blur(input);
    await waitFor(() => expect(effect().params.threshold).toBe(-51));
    expect(effect().enabled).toBe(false);
  });
  it.each(["unmounted", "source-replaced", "same-id-reloaded"])(
    "does not attach a late learned profile after %s",
    async (reason) => {
      const complete = deferredAnalysis();
      const view = render(<NoiseReductionSection clipId="clip" />);
      fireEvent.click(
        screen.getByRole("radio", { name: /Use White Noise noise reduction/ }),
      );
      await waitFor(() => expect(autoLearnNoiseProfile).toHaveBeenCalledOnce());
      if (reason === "unmounted") view.unmount();
      if (reason === "source-replaced")
        act(() => {
          const p = useProjectStore.getState().project;
          useProjectStore.setState({
            project: {
              ...p,
              mediaLibrary: {
                items: p.mediaLibrary.items.map((item) => ({
                  ...item,
                  blob: new Blob(["replacement"]),
                })),
              },
            },
          });
        });
      if (reason === "same-id-reloaded")
        act(() => {
          const history = new ActionHistory();
          useProjectStore.setState({
            project: { ...useProjectStore.getState().project },
            actionHistory: history,
            actionExecutor: new ActionExecutor(history),
          });
        });
      await complete();
      expect(effect().params.profile).toBeUndefined();
    },
  );
  it("cancels profile learning while retaining the immediately applied preset", async () => {
    const complete = deferredAnalysis();
    render(<NoiseReductionSection clipId="clip" />);
    fireEvent.click(
      screen.getByRole("radio", { name: "Use White Noise noise reduction" }),
    );
    await waitFor(() => expect(autoLearnNoiseProfile).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Cancel analysis" }));
    await complete();
    expect(effect().params.focus).toBe("whiteNoise");
    expect(effect().params.profile).toBeUndefined();
    expect(
      screen.getByRole("button", { name: "Analyze & Recommend" }),
    ).not.toBeDisabled();
  });
  it("invalidates a ready recommendation when its source is replaced", async () => {
    render(<NoiseReductionSection clipId="clip" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Analyze & Recommend" }),
    );
    await screen.findByRole("button", { name: "Apply Recommended Cleanup" });
    act(() => {
      const p = useProjectStore.getState().project;
      useProjectStore.setState({
        project: {
          ...p,
          mediaLibrary: {
            items: p.mediaLibrary.items.map((item) => ({
              ...item,
              blob: new Blob(["new"]),
            })),
          },
        },
      });
    });
    expect(
      screen.queryByRole("button", { name: "Apply Recommended Cleanup" }),
    ).not.toBeInTheDocument();
  });
  it("retains all seven preset configurations and can relearn the currently selected mode", async () => {
    render(<NoiseReductionSection clipId="clip" />);
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    for (const [label, focus] of [
      ["Balanced", "balanced"],
      ["Speech Focus", "speech"],
      ["White Noise", "whiteNoise"],
      ["Music Bed", "music"],
      ["Heavy Noise", "heavy"],
      ["Wind & Rumble", "wind"],
      ["Hum & HVAC", "hum"],
    ]) {
      fireEvent.click(
        screen.getByRole("radio", { name: `Use ${label} noise reduction` }),
      );
      await screen.findByText(`${label} learned and applied to this clip.`);
      expect(effect().params.focus).toBe(focus);
    }
    const calls = vi.mocked(autoLearnNoiseProfile).mock.calls.length;
    fireEvent.click(
      screen.getByRole("radio", { name: "Use Hum & HVAC noise reduction" }),
    );
    await waitFor(() =>
      expect(autoLearnNoiseProfile).toHaveBeenCalledTimes(calls + 1),
    );
  });
});
