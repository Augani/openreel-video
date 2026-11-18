import "../../test/install-local-storage-mock";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { AssetsPanel } from "./AssetsPanel";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";

const metadata = { duration: 4, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 10 };
const base = { fileHandle: null, thumbnailUrl: null, waveformData: null, sourceFile: { name: "x", size: 1, lastModified: 0 }, metadata };
const items: MediaItem[] = [
  { ...base, id: "offline", name: "Offline.mp4", type: "video", blob: null, isPlaceholder: true },
  { ...base, id: "pending-thumb", name: "NoThumb.mp4", type: "video", blob: new Blob(["v"]) },
  // A cover image on an audio item must not hide its waveform.
  { ...base, id: "audio", name: "Song.mp3", type: "audio", blob: new Blob(["a"]), thumbnailUrl: "data:image/png;base64,AAAA", waveformData: new Float32Array([0.1, 0.9, 0.4, 0.7]) },
];

beforeEach(() => {
  vi.useFakeTimers();
  useProjectStore.getState().loadProject({ ...createEmptyProject("Tiles"), mediaLibrary: { items } });
  useEditorWorkspaceStore.getState().setSection("media");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("media tile states", () => {
  it("shows the offline tile, a waveform for audio even with a thumbnail, and a bounded skeleton", async () => {
    render(<AssetsPanel />);
    expect(screen.getByTestId("media-offline-tile").textContent).toContain("Media offline");
    expect(screen.getByTestId("media-thumbnail-skeleton")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByTestId("media-audio-wave").querySelectorAll("i").length).toBe(48);
    // A thumbnail that never arrives must settle, not shimmer forever.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(screen.queryByTestId("media-thumbnail-skeleton")).toBeNull();
  });
});
