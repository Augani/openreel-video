import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { useMediaWaveforms } from "./use-media-waveforms";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { serializeProjectForAutoSave } from "../services/auto-save";
import { restoreMediaItem } from "../utils/media-recovery";
const generate = vi.hoisted(() => vi.fn());
vi.mock("../bridges/media-bridge", () => ({
  getMediaBridge: () => ({ generateWaveform: generate }),
}));
const audio: MediaItem = {
  id: "audio",
  name: "Recovered.wav",
  type: "audio",
  blob: new Blob(["pcm"]),
  fileHandle: null,
  thumbnailUrl: null,
  waveformData: new Float32Array([0.2, 0.8]),
  metadata: {
    duration: 2,
    width: 0,
    height: 0,
    frameRate: 0,
    codec: "pcm",
    sampleRate: 48000,
    channels: 1,
    fileSize: 3,
  },
};
beforeEach(() => {
  generate
    .mockReset()
    .mockResolvedValue({ peaks: new Float32Array([0.2, 0.8]) });
  useUIStore.setState({ showWaveforms: true });
});
afterEach(cleanup);
describe("waveforms after project recovery", () => {
  it("rebuilds stripped peaks after initialization without adding an edit or changing the saved project", async () => {
    const project = {
      ...createEmptyProject("Waveform recovery"),
      mediaLibrary: { items: [audio] },
    };
    const saved = serializeProjectForAutoSave(project);
    const recovered = JSON.parse(saved) as Project;
    const restored = await restoreMediaItem(
      recovered.mediaLibrary.items[0],
      audio.blob!,
    );
    expect(restored.waveformData).toBeNull();
    useProjectStore.setState({
      hasOpenProject: true,
      project: { ...recovered, mediaLibrary: { items: [restored] } },
    });
    const recoveredSnapshot = serializeProjectForAutoSave(
      useProjectStore.getState().project,
    );
    const historySize = useProjectStore
      .getState()
      .actionHistory.getUndoStackSize();
    const view = renderHook(({ ready }) => useMediaWaveforms(ready), {
      initialProps: { ready: false },
    });
    expect(generate).not.toHaveBeenCalled();
    view.rerender({ ready: true });
    await waitFor(() =>
      expect(
        useProjectStore.getState().getMediaItem("audio")?.waveformData,
      ).toEqual(new Float32Array([0.2, 0.8])),
    );
    expect(generate).toHaveBeenCalledWith(
      audio.blob,
      "audio",
      100,
      expect.objectContaining({
        enableCaching: false,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      serializeProjectForAutoSave(useProjectStore.getState().project),
    ).toBe(recoveredSnapshot);
    expect(useProjectStore.getState().actionHistory.getUndoStackSize()).toBe(
      historySize,
    );
  });
  it("always restores audio and loads embedded video audio when its preference is enabled", async () => {
    const video = {
      ...audio,
      id: "video",
      type: "video" as const,
      waveformData: null,
      metadata: { ...audio.metadata, width: 640, height: 360 },
    };
    const silent = {
      ...video,
      id: "silent-video",
      metadata: { ...video.metadata, channels: 0, hasAudio: false },
    };
    const project = {
      ...createEmptyProject("Video waveforms"),
      mediaLibrary: {
        items: [{ ...audio, waveformData: null }, video, silent],
      },
    };
    useProjectStore.setState({ hasOpenProject: true, project });
    useUIStore.setState({ showWaveforms: false });
    renderHook(() => useMediaWaveforms(true));
    await waitFor(() =>
      expect(
        useProjectStore.getState().getMediaItem("audio")?.waveformData,
      ).not.toBeNull(),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    act(() => useUIStore.getState().setShowWaveforms(true));
    await waitFor(() =>
      expect(
        useProjectStore.getState().getMediaItem("video")?.waveformData,
      ).not.toBeNull(),
    );
    expect(generate).toHaveBeenCalledTimes(2);
    expect(
      useProjectStore.getState().getMediaItem("silent-video")?.waveformData,
    ).toBeNull();
  });
});
