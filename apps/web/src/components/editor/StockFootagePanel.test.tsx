import "../../test/install-local-storage-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StockFootagePanel } from "./StockFootagePanel";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import {
  downloadStockFootage,
  searchStockFootage,
  type StockFootage,
} from "../../services/stock-footage";

vi.mock("../../services/stock-footage", async (original) => ({
  ...(await original<typeof import("../../services/stock-footage")>()),
  searchStockFootage: vi.fn(),
  downloadStockFootage: vi.fn(),
}));
const original = {
  importMedia: useProjectStore.getState().importMedia,
  addClipToNewTrack: useProjectStore.getState().addClipToNewTrack,
};
const footage: StockFootage = {
  id: "commons-1",
  title: "Ocean",
  duration: 5,
  thumbnailUrl: "https://thumb.wikimedia.org/ocean.jpg",
  sources: [
    {
      url: "https://upload.wikimedia.org/ocean.webm",
      mime: "video/webm",
      width: 1920,
      height: 1080,
    },
  ],
  credit: {
    provider: "wikimedia-commons",
    id: "commons-1",
    title: "Ocean",
    creator: "A Creator",
    license: "CC BY 4.0",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Ocean.webm",
  },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.clearAllMocks();
  useProjectStore.setState(original);
  useProjectStore.getState().loadProject(createEmptyProject("Footage test"));
  useUIStore.setState({
    exportState: { isExporting: false, progress: 0, phase: "idle" },
  });
  useTimelineStore.setState({ playbackLockedReason: null });
  vi.mocked(searchStockFootage)
    .mockReset()
    .mockResolvedValue({ items: [footage] });
  vi.mocked(downloadStockFootage)
    .mockReset()
    .mockResolvedValue(
      new File(["video"], "Ocean.webm", { type: "video/webm" }),
    );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useProjectStore.setState(original);
});
async function show() {
  const view = render(<StockFootagePanel />);
  await screen.findByRole("button", { name: "Add footage Ocean" });
  return view;
}

describe("footage browsing and owned imports", () => {
  it("imports with retained credits and places once, despite duplicate activation", async () => {
    const downloaded = deferred<File>();
    vi.mocked(downloadStockFootage).mockReturnValueOnce(downloaded.promise);
    const imported = vi
        .fn()
        .mockResolvedValue({ success: true, actionId: "media" }),
      placed = vi.fn().mockResolvedValue({ success: true });
    useProjectStore.setState({
      importMedia: imported,
      addClipToNewTrack: placed,
    });
    await show();
    const add = screen.getByRole("button", { name: "Add footage Ocean" });
    act(() => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    expect(downloadStockFootage).toHaveBeenCalledOnce();
    await act(async () =>
      downloaded.resolve(new File(["video"], "Ocean.webm")),
    );
    expect(imported).toHaveBeenCalledOnce();
    expect(imported.mock.calls[0][2]).toEqual({ stockSource: footage.credit });
    expect(imported.mock.calls[0][3]).toMatchObject({
      signal: expect.any(AbortSignal),
      isCurrent: expect.any(Function),
    });
    expect(placed).toHaveBeenCalledOnce();
    expect(placed).toHaveBeenCalledWith("media");
    expect(screen.getByRole("status")).toHaveTextContent("Added Ocean");
  });
  it.each([
    "replacement",
    "same-id reload",
    "export",
    "operation",
    "cancel",
    "unmount",
  ])("prevents stale download import after %s", async (reason) => {
    const downloaded = deferred<File>();
    vi.mocked(downloadStockFootage).mockReturnValueOnce(downloaded.promise);
    const imported = vi.fn(),
      placed = vi.fn();
    useProjectStore.setState({
      importMedia: imported,
      addClipToNewTrack: placed,
    });
    const view = await show();
    fireEvent.click(screen.getByRole("button", { name: "Add footage Ocean" }));
    const signal = vi.mocked(downloadStockFootage).mock.calls[0][1];
    act(() => {
      if (reason === "replacement")
        useProjectStore
          .getState()
          .loadProject(createEmptyProject("Replacement"));
      else if (reason === "same-id reload")
        useProjectStore
          .getState()
          .loadProject({ ...useProjectStore.getState().project });
      else if (reason === "export")
        useUIStore.getState().setExportState({
          isExporting: true,
          progress: 1,
          phase: "encoding",
        });
      else if (reason === "operation")
        useTimelineStore.setState({ playbackLockedReason: "Preparing media" });
      else if (reason === "cancel")
        fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
      else view.unmount();
    });
    await act(async () => downloaded.resolve(new File(["video"], "old.webm")));
    expect(signal.aborted).toBe(true);
    expect(imported).not.toHaveBeenCalled();
    expect(placed).not.toHaveBeenCalled();
  });
  it("cancels the decoder's publication lease when export starts", async () => {
    const decoding = deferred<{ success: boolean; actionId: string }>(),
      imported = vi.fn(() => decoding.promise),
      placed = vi.fn();
    useProjectStore.setState({
      importMedia: imported,
      addClipToNewTrack: placed,
    });
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Add footage Ocean" }));
    await waitFor(() => expect(imported).toHaveBeenCalledOnce());
    const options = imported.mock.calls[0] as unknown as [
      File,
      unknown,
      unknown,
      { signal: AbortSignal; isCurrent: () => boolean },
    ];
    act(() =>
      useUIStore
        .getState()
        .setExportState({ isExporting: true, progress: 1, phase: "encoding" }),
    );
    expect(options[3].signal.aborted).toBe(true);
    expect(options[3].isCurrent()).toBe(false);
    await act(async () => decoding.resolve({ success: true, actionId: "old" }));
    expect(placed).not.toHaveBeenCalled();
  });
  it("reuses an already imported clip while preserving a separate placement command", async () => {
    const project = useProjectStore.getState().project;
    useProjectStore.getState().loadProject({
      ...project,
      mediaLibrary: {
        items: [
          {
            id: "existing",
            name: "Renamed.webm",
            type: "video",
            blob: new Blob(["video"]),
            fileHandle: null,
            thumbnailUrl: null,
            waveformData: null,
            metadata: {
              duration: 5,
              width: 1920,
              height: 1080,
              frameRate: 30,
              codec: "vp9",
              channels: 0,
              sampleRate: 0,
              fileSize: 5,
              stockSource: footage.credit,
            },
          },
        ],
      },
    });
    const placed = vi.fn().mockResolvedValue({ success: true });
    useProjectStore.setState({ addClipToNewTrack: placed });
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Add footage Ocean" }));
    await waitFor(() => expect(placed).toHaveBeenCalledWith("existing"));
    expect(downloadStockFootage).not.toHaveBeenCalled();
  });
});
