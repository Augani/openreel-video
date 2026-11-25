import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSceneDetectionDialogStore } from "../../stores/scene-detection-dialog-store";
import {
  analyseClipScenes,
  applySceneCuts,
  type SceneAnalysis,
} from "../../services/scene-detection";
import { SceneDetectionDialog } from "./SceneDetectionDialog";

vi.mock("../../services/scene-detection", () => ({
  analyseClipScenes: vi.fn(),
  applySceneCuts: vi.fn(),
  sceneDetectionBlockReason: () => null,
}));

const analysis = (count: number): SceneAnalysis => ({
  projectId: "p",
  clipId: "clip",
  mediaId: "m",
  cuts: Array.from({ length: count }, (_, i) => ({ time: i + 1, score: 1 })),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(analyseClipScenes).mockReset();
  vi.mocked(applySceneCuts).mockReset();
  act(() => useSceneDetectionDialogStore.getState().open("clip"));
});
afterEach(() => {
  cleanup();
  useSceneDetectionDialogStore.getState().close();
});

describe("SceneDetectionDialog", () => {
  it("analyses, reports cuts, then applies the analysed result", async () => {
    vi.mocked(analyseClipScenes).mockResolvedValue(analysis(2));
    vi.mocked(applySceneCuts).mockResolvedValue({
      splits: 2,
      markers: 0,
      subclips: 0,
      skippedLockedLinked: 0,
      droppedCuts: 0,
    });
    render(<SceneDetectionDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    await screen.findByText("2 cuts found");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(applySceneCuts).toHaveBeenCalledTimes(1));
    expect(vi.mocked(applySceneCuts).mock.calls[0][0]).toEqual(analysis(2));
    expect(vi.mocked(applySceneCuts).mock.calls[0][1]).toEqual({
      splitClip: true,
      addMarkers: false,
      createSubclips: false,
    });
    await waitFor(() => expect(useSceneDetectionDialogStore.getState().clipId).toBeNull());
  });

  it("shows progress, cancels through the abort signal and ignores a late result", async () => {
    const late = deferred<SceneAnalysis>();
    let signal: AbortSignal | undefined;
    vi.mocked(analyseClipScenes).mockImplementation(async (_id, options) => {
      signal = options.signal;
      options.onProgress?.({ processed: 1, total: 2, fraction: 0.5, time: 1 });
      return late.promise;
    });
    render(<SceneDetectionDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    await screen.findByText(/Analysing… 50%/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(signal?.aborted).toBe(true);
    // A result from the cancelled run must not be published.
    await act(async () => {
      late.resolve(analysis(5));
    });
    expect(screen.queryByText("5 cuts found")).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.getByRole("button", { name: "Analyse" })).toBeTruthy();
  });

  it("aborts analysis when the dialog is closed", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(analyseClipScenes).mockImplementation(async (_id, options) => {
      signal = options.signal;
      return new Promise<SceneAnalysis>(() => {});
    });
    render(<SceneDetectionDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    await waitFor(() => expect(signal).toBeDefined());
    act(() => useSceneDetectionDialogStore.getState().close());
    expect(signal?.aborted).toBe(true);
  });

  it("passes the dissolve / fade switches to the analysis and the output choices to apply", async () => {
    vi.mocked(analyseClipScenes).mockResolvedValue({
      ...analysis(1),
      edits: [
        { kind: "cut", time: 1, start: 1, end: 1, score: 1 },
        { kind: "dissolve", time: 3, start: 2.5, end: 3.5, score: 1 },
        { kind: "fade-through-black", time: 5, start: 4, end: 6, score: 1 },
      ],
    });
    vi.mocked(applySceneCuts).mockResolvedValue({ splits: 3, markers: 3, subclips: 4, skippedLockedLinked: 0, droppedCuts: 0 });
    render(<SceneDetectionDialog />);
    fireEvent.click(screen.getByRole("switch", { name: "Detect cross-dissolves" }));
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    await screen.findByText("3 edits found (1 cut, 1 dissolve, 1 fade)");
    expect(vi.mocked(analyseClipScenes).mock.calls[0][1]).toMatchObject({ detectDissolves: false, detectFades: true });
    fireEvent.click(screen.getByRole("switch", { name: "Create subclips for each scene" }));
    fireEvent.click(screen.getByRole("switch", { name: "Add timeline markers" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(applySceneCuts).toHaveBeenCalledTimes(1));
    expect(vi.mocked(applySceneCuts).mock.calls[0][1]).toEqual({ splitClip: true, addMarkers: true, createSubclips: true });
  });
});
