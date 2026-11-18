import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SoundItem } from "@openreel/core";
import { MusicLibraryPanel } from "./MusicLibraryPanel";
import { useTimelineStore } from "../../../stores/timeline-store";

const engine = vi.hoisted(() => ({
  ensureInitialized: vi.fn(),
  getMusic: vi.fn(),
  getSFX: vi.fn(() => []),
  getSoundBlob: vi.fn((): Blob | null => null),
  previewSound: vi.fn(),
  stopPreview: vi.fn(),
  pausePreview: vi.fn(() => true),
  resumePreview: vi.fn(async () => true),
  getPreviewProgress: vi.fn(() => 0),
  getLoadProgress: vi.fn(() => ({ done: 1, total: 1 })),
  onLoadProgress: vi.fn((_listener: () => void) => () => {}),
}));
const getEngine = vi.hoisted(() => vi.fn(async () => engine));
vi.mock("../../../stores/engine-store", () => ({
  useEngineStore: (
    selector: (state: { getSoundLibraryEngine: typeof getEngine }) => unknown,
  ) => selector({ getSoundLibraryEngine: getEngine }),
}));
const store = vi.hoisted(() => ({
  project: { id: "qa", timeline: { tracks: [] as Array<{ clips: Array<{ mediaId: string }> }> },
    mediaLibrary: { items: [] as Array<{ id: string; name?: string; blob?: Blob | null; isPlaceholder?: boolean; metadata: { soundLibraryId?: string } }> } },
  actionExecutor: {}, importMedia: vi.fn(), placeMediaClip: vi.fn(),
}));
vi.mock("../../../stores/project-store", () => ({
  useProjectStore: Object.assign((selector: (state: unknown) => unknown) => selector(store), { getState: () => store }),
}));
const sound: SoundItem = {
  id: "bed",
  name: "Cinematic Bed",
  category: "music",
  subcategory: "cinematic",
  duration: 30,
  bpm: 92,
  tags: ["background"],
  mood: ["calm"],
  previewUrl: "",
  downloadUrl: "",
  isBuiltin: true,
  license: "royalty-free",
};
beforeEach(() => {
  vi.clearAllMocks();
  store.project = { id: "qa", timeline: { tracks: [] }, mediaLibrary: { items: [] } };
  store.actionExecutor = {};
  store.importMedia.mockResolvedValue({ success: true, actionId: "imported" });
  store.placeMediaClip.mockResolvedValue({ success: true });
  engine.getSoundBlob.mockReturnValue(null);
  engine.getPreviewProgress.mockReturnValue(0);
  engine.pausePreview.mockReturnValue(true);
  engine.resumePreview.mockResolvedValue(true);
  getEngine.mockImplementation(async () => engine);
  engine.ensureInitialized.mockResolvedValue(undefined);
  engine.getMusic.mockReturnValue([sound]);
  engine.previewSound.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("sound library loading", () => {
  it("lists rows as they are generated and reports real progress until the library is ready", async () => {
    let listener: () => void = () => {};
    engine.onLoadProgress.mockImplementation((cb: () => void) => { listener = cb; return () => {}; });
    let finish!: () => void;
    engine.ensureInitialized.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    engine.getMusic.mockReturnValue([]);
    engine.getLoadProgress.mockReturnValue({ done: 0, total: 3 });
    render(<MusicLibraryPanel source="music" />);
    const bar = await screen.findByTestId("sound-library-progress");
    expect(bar).toHaveTextContent("Generating demo loops 0 of 3");
    engine.getMusic.mockReturnValue([sound]);
    engine.getLoadProgress.mockReturnValue({ done: 1, total: 3 });
    act(() => listener());
    expect(await screen.findByRole("button", { name: "Preview Cinematic Bed" })).toBeInTheDocument();
    expect(screen.getByTestId("sound-library-progress")).toHaveAttribute("aria-valuenow", "1");
    engine.getLoadProgress.mockReturnValue({ done: 3, total: 3 });
    await act(async () => finish());
    expect(screen.queryByTestId("sound-library-progress")).toBeNull();
  });

  it("shows every duration in one format", async () => {
    engine.getMusic.mockReturnValue([sound, { ...sound, id: "b", name: "Short Loop", duration: 7.5 }, { ...sound, id: "c", name: "Mid Loop", duration: 10.8 }]);
    render(<MusicLibraryPanel source="music" />);
    await screen.findByRole("button", { name: "Preview Mid Loop" });
    const times = Array.from(document.querySelectorAll(".workspace-sound-title time")).map((n) => n.textContent);
    expect(times).toEqual(["30.0s", "7.5s", "10.8s"]);
  });
});

describe("sound library workflow", () => {
  it("imports source identity once and disables repeated placement while the import is pending", async () => {
    engine.getSoundBlob.mockReturnValue(new Blob(["sound"], { type: "audio/wav" }));
    let finish!: (value: { success: boolean; actionId: string }) => void;
    store.importMedia.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    useTimelineStore.setState({ playheadPosition: 2.25 });
    render(<MusicLibraryPanel source="music" />);
    const add = await screen.findByRole("button", { name: "Add Cinematic Bed to timeline" });
    fireEvent.click(add); fireEvent.click(add);
    await waitFor(() => expect(store.importMedia).toHaveBeenCalledOnce());
    expect(store.importMedia).toHaveBeenCalledWith(expect.any(File), undefined, { soundLibraryId: sound.id });
    expect(add).toBeDisabled();
    await act(async () => finish({ success: true, actionId: "imported" }));
    expect(store.placeMediaClip).toHaveBeenCalledOnce();
    expect(store.placeMediaClip).toHaveBeenCalledWith("imported", undefined, 2.25);
    expect(add).toBeEnabled();
  });

  it("reuses an existing source asset independently of its current name", async () => {
    store.project.mediaLibrary.items = [{ id: "saved", name: "Renamed.wav", blob: new Blob(["audio"]), metadata: { soundLibraryId: sound.id } }];
    render(<MusicLibraryPanel source="music" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Cinematic Bed to timeline" }));
    await waitFor(() => expect(store.placeMediaClip).toHaveBeenCalled());
    expect(store.placeMediaClip.mock.calls[0][0]).toBe("saved");
    expect(store.importMedia).not.toHaveBeenCalled();
  });

  it("does not place a completed import into a reloaded same-ID project session", async () => {
    engine.getSoundBlob.mockReturnValue(new Blob(["audio"]));
    let finish!: (value: { success: boolean; actionId: string }) => void;
    store.importMedia.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<MusicLibraryPanel source="music" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Cinematic Bed to timeline" }));
    await waitFor(() => expect(store.importMedia).toHaveBeenCalled());
    store.actionExecutor = {};
    await act(async () => finish({ success: true, actionId: "old-import" }));
    expect(store.placeMediaClip).not.toHaveBeenCalled();
  });

  it("keeps the newer preview intent when an earlier engine request resolves late", async () => {
    engine.getMusic.mockReturnValue([sound, { ...sound, id: "second", name: "Second Bed" }]);
    render(<MusicLibraryPanel source="music" />);
    await screen.findByRole("button", { name: "Preview Second Bed" });
    let finish!: (value: typeof engine) => void;
    getEngine.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Preview Cinematic Bed" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview Second Bed" }));
    await waitFor(() => expect(engine.previewSound).toHaveBeenCalledOnce());
    await act(async () => finish(engine));
    expect(engine.previewSound).toHaveBeenCalledOnce();
    expect(engine.previewSound.mock.calls[0][0].id).toBe("second");
    expect(screen.getByRole("button", { name: "Pause Second Bed" })).toBeInTheDocument();
  });

});
