import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetsPanel } from "./AssetsPanel";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { BACKGROUND_PRESETS, generateBackgroundBlob } from "../../services/background-generator";
import { saveFileHandle } from "../../services/media-storage";
import type { MediaItem, Track } from "@openreel/core";

vi.mock("../../services/background-generator", async original => ({
  ...await original<typeof import("../../services/background-generator")>(),
  generateBackgroundBlob: vi.fn(),
}));
vi.mock("../../services/media-storage", async original => ({ ...await original<typeof import("../../services/media-storage")>(), saveFileHandle: vi.fn(async () => {}) }));
vi.mock("../../services/stock-footage", async original => ({ ...await original<typeof import("../../services/stock-footage")>(), searchStockFootage: vi.fn(async () => ({ items: [] })) }));
const originals = {
  importMedia: useProjectStore.getState().importMedia,
  addClipToNewTrack: useProjectStore.getState().addClipToNewTrack,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const media: MediaItem = {
  id: "media", name: "Source.mp4", type: "video", blob: null, fileHandle: null,
  thumbnailUrl: "blob:source", waveformData: null,
  metadata: { duration: 5, width: 1920, height: 1080, frameRate: 30, codec: "vp9", sampleRate: 0, channels: 0, fileSize: 1024 },
};
function load(populated = false) {
  const project = createEmptyProject("Media preservation");
  const track: Track = { id: "main", name: "Main", type: "video", hidden: false, locked: false, muted: false, solo: false, transitions: [], clips: populated ? [{
    id: "clip", mediaId: media.id, trackId: "main", startTime: 0, duration: 5,
    inPoint: 0, outPoint: 5, volume: 1, effects: [], audioEffects: [], keyframes: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } },
  }] : [] };
  useProjectStore.getState().loadProject({ ...project, mediaLibrary: { items: populated ? [media] : [] }, timeline: { ...project.timeline, tracks: [track], duration: populated ? 5 : 0 } });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateBackgroundBlob).mockReset();
  useProjectStore.setState(originals);
  load();
  useEditorWorkspaceStore.getState().setSection("media");
  useUIStore.setState({ selectedItems: [], exportState: { isExporting: false, progress: 0, phase: "idle" } });
  useTimelineStore.setState({ playbackLockedReason: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useProjectStore.setState(originals); });
function startBackground() {
  fireEvent.click(screen.getByRole("button", { name: "Browse stock footage Free clips, music and SFX" }));
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Backgrounds" }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole("button", { name: BACKGROUND_PRESETS[0].name }));
}

describe("media library preservation", () => {
  it("settles a pending background without importing if export starts, then allows retry", async () => {
    const generated = deferred<Blob>(); vi.mocked(generateBackgroundBlob).mockReturnValueOnce(generated.promise);
    const imported = vi.fn(); const added = vi.fn(); useProjectStore.setState({ importMedia: imported, addClipToNewTrack: added });
    render(<AssetsPanel />); startBackground();
    act(() => useUIStore.getState().setExportState({ isExporting: true, progress: 1, phase: "encoding" }));
    await act(async () => generated.resolve(new Blob(["image"], { type: "image/png" })));
    expect(imported).not.toHaveBeenCalled(); expect(added).not.toHaveBeenCalled();
    act(() => useUIStore.getState().setExportState({ isExporting: false, progress: 0, phase: "idle" }));
    expect(screen.getByRole("button", { name: BACKGROUND_PRESETS[0].name })).toBeEnabled();
  });
  it("snapshots dropped files before asynchronous handle capture protects the transfer", async () => {
    vi.stubGlobal("DataTransferItem", class { getAsFileSystemHandle() {} });
    const picked = deferred<FileSystemFileHandle>(); const imported = vi.fn().mockResolvedValue({ success: true });
    const file = new File(["audio"], "snapshot.wav", { type: "audio/wav" });
    const liveFiles = [file];
    useProjectStore.setState({ importMedia: imported }); const view = render(<AssetsPanel />);
    fireEvent.drop(view.container.querySelector('.workspace-media-scroll')!, { dataTransfer: { files: liveFiles, items: [{ kind: "file", getAsFileSystemHandle: () => picked.promise }] } });
    liveFiles.splice(0);
    await act(async () => picked.resolve({ kind: "file", getFile: async () => file } as unknown as FileSystemFileHandle));
    expect(imported).toHaveBeenCalledOnce(); expect(imported.mock.calls[0][0]).toBe(file);
  });
  it("generates and places one current-project background at its exact dimensions", async () => {
    const project = useProjectStore.getState().project;
    useProjectStore.getState().loadProject({ ...project, settings: { ...project.settings, width: 1280, height: 720 } });
    const generated = deferred<Blob>(); vi.mocked(generateBackgroundBlob).mockReturnValueOnce(generated.promise);
    const imported = vi.fn().mockResolvedValue({ success: true, actionId: "background" }); const added = vi.fn().mockResolvedValue({ success: true });
    useProjectStore.setState({ importMedia: imported, addClipToNewTrack: added }); render(<AssetsPanel />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Stock" }), { button: 0, ctrlKey: false });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Backgrounds" }), { button: 0, ctrlKey: false });
    const button = screen.getByRole("button", { name: BACKGROUND_PRESETS[0].name });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(generateBackgroundBlob).toHaveBeenCalledOnce();
    expect(generateBackgroundBlob).toHaveBeenCalledWith(BACKGROUND_PRESETS[0], 1280, 720);
    await act(async () => generated.resolve(new Blob(["image"], { type: "image/png" })));
    expect(imported).toHaveBeenCalledOnce();
    expect(imported.mock.calls[0][0]).toMatchObject({ name: `${BACKGROUND_PRESETS[0].name}_1280x720.png`, type: "image/png" });
    expect(added).toHaveBeenCalledOnce();
    expect(added).toHaveBeenCalledWith("background");
    expect(button).toBeEnabled();
  });
  it("imports every file in order while the original session stays open", async () => {
    const first = deferred<{ success: boolean }>(); const imported = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ success: true });
    useProjectStore.setState({ importMedia: imported }); render(<AssetsPanel />);
    const files = [new File(["a"], "a.wav", { type: "audio/wav" }), new File(["b"], "b.wav", { type: "audio/wav" })];
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });
    await act(async () => first.resolve({ success: true }));
    expect(imported.mock.calls.map(call => call[0])).toEqual(files);
    expect(document.querySelector('.workspace-assets')).not.toHaveTextContent("Importing");
  });
  it("rejects a drop delayed by file-handle capture after its session changes", async () => {
    vi.stubGlobal("DataTransferItem", class { getAsFileSystemHandle() {} });
    const picked = deferred<FileSystemFileHandle>(); const imported = vi.fn();
    const file = new File(["audio"], "drop.wav", { type: "audio/wav" });
    useProjectStore.setState({ importMedia: imported }); const view = render(<AssetsPanel />);
    fireEvent.drop(view.container.querySelector('.workspace-media-scroll')!, { dataTransfer: { files: [file], items: [{ kind: "file", getAsFileSystemHandle: () => picked.promise }] } });
    act(() => load());
    await act(async () => picked.resolve({ kind: "file", getFile: async () => file } as unknown as FileSystemFileHandle));
    expect(saveFileHandle).toHaveBeenCalled(); expect(imported).not.toHaveBeenCalled();
  });
  it.each([false, true])("rejects a generated background after project replacement (same id: %s)", async sameId => {
    const generated = deferred<Blob>(); vi.mocked(generateBackgroundBlob).mockReturnValueOnce(generated.promise);
    const imported = vi.fn().mockResolvedValue({ success: true, actionId: "old" });
    const added = vi.fn().mockResolvedValue({ success: true });
    useProjectStore.setState({ importMedia: imported, addClipToNewTrack: added });
    render(<AssetsPanel />); startBackground();
    act(() => { if (sameId) useProjectStore.getState().loadProject({ ...useProjectStore.getState().project }); else load(); });
    await act(async () => generated.resolve(new Blob(["old"], { type: "image/png" })));
    expect(imported).not.toHaveBeenCalled(); expect(added).not.toHaveBeenCalled();
  });
  it("does not place an imported background into a replacement project", async () => {
    vi.mocked(generateBackgroundBlob).mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }));
    const imported = deferred<{ success: boolean; actionId: string }>();
    const importMedia = vi.fn(() => imported.promise); const added = vi.fn();
    useProjectStore.setState({ importMedia, addClipToNewTrack: added });
    render(<AssetsPanel />);
    startBackground();
    await act(async () => {});
    expect(importMedia).toHaveBeenCalledOnce();
    act(() => load());
    await act(async () => imported.resolve({ success: true, actionId: "old" }));
    expect(added).not.toHaveBeenCalled();
  });
  it("stops the remaining file batch after the editing session is replaced", async () => {
    const first = deferred<{ success: boolean }>();
    const importMedia = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ success: true });
    useProjectStore.setState({ importMedia }); render(<AssetsPanel />);
    const fileInput = document.querySelector('input[type="file"]')!;
    fireEvent.change(fileInput, { target: { files: [new File(["a"], "a.wav", { type: "audio/wav" }), new File(["b"], "b.wav", { type: "audio/wav" })] } });
    expect(importMedia).toHaveBeenCalledTimes(1);
    act(() => load());
    await act(async () => first.resolve({ success: true }));
    expect(importMedia).toHaveBeenCalledTimes(1);
  });
});
