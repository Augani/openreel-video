import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { ProjectState } from "../project-store";
import { createMediaSlice } from "./media-slice";
import { createEmptyProject } from "./project-helpers";

const { bridge, persisted, warning } = vi.hoisted(() => ({
  bridge: {
    isInitialized: () => true,
    importFile: vi.fn(),
    generateThumbnailsForMedia: vi.fn(),
  },
  persisted: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("../../bridges/media-bridge", () => ({
  getMediaBridge: () => bridge,
  initializeMediaBridge: vi.fn(),
}));
vi.mock("../../services/media-storage", () => ({
  saveMediaBlob: persisted,
  deleteMediaBlob: vi.fn(),
}));
vi.mock("../notification-store", () => ({ toast: { warning } }));

const decoded = () => ({
  success: true,
  media: {
    metadata: {
      duration: 5,
      width: 1280,
      height: 720,
      frameRate: 30,
      codec: "vp9",
      sampleRate: 0,
      channels: 0,
      hasVideo: true,
      hasAudio: false,
    },
  },
});
function store() {
  return createStore<ProjectState>(
    (set, get) =>
      ({
        project: createEmptyProject("Thumbnail ownership"),
        ...createMediaSlice(set, get),
      }) as ProjectState,
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class ThumbnailCanvas extends OffscreenCanvas {
  constructor(
    readonly convertToBlob = vi.fn(async () => new Blob(["thumbnail"])),
  ) {
    super(160, 90);
  }
}
const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
// The thumbnail retry fires after 100 ms. Advance a bounded span instead of
// runAllTimersAsync: GSAP's ticker (loaded transitively) reschedules itself
// every frame, so "run all timers" never ends and trips Vitest's
// 10,000-timer infinite-loop guard on slower CI runners.
const flushThumbnailRetry = () => vi.advanceTimersByTimeAsync(1_000);
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  persisted.mockReset().mockResolvedValue(undefined);
  bridge.importFile.mockReset().mockResolvedValue(decoded());
  bridge.generateThumbnailsForMedia.mockReset().mockResolvedValue([]);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => `blob:owned-${crypto.randomUUID()}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalCreate)
    Object.defineProperty(URL, "createObjectURL", originalCreate);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevoke)
    Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("unpublished thumbnail ownership", () => {
  it.each(["cancel", "project replacement", "session reload"])(
    "disposes created URLs and stops converting thumbnails after %s",
    async (reason) => {
      const second = deferred<Blob>(),
        started = deferred<void>(),
        unused = new ThumbnailCanvas();
      bridge.importFile.mockResolvedValue({
        ...decoded(),
        media: {
          ...decoded().media,
          thumbnails: [
            { timestamp: 0, canvas: new ThumbnailCanvas() },
            {
              timestamp: 1,
              canvas: new ThumbnailCanvas(
                vi.fn(() => {
                  started.resolve();
                  return second.promise;
                }),
              ),
            },
            { timestamp: 2, canvas: unused },
          ],
        },
      });
      const state = store(),
        controller = new AbortController(),
        before = state.getState().project;
      const pending = state
        .getState()
        .importMedia(
          new File(["video"], "source.webm", { type: "video/webm" }),
          undefined,
          undefined,
          { signal: controller.signal },
        );
      await started.promise;
      const firstUrl = vi.mocked(URL.createObjectURL).mock.results[0].value;
      if (reason === "cancel") controller.abort();
      else if (reason === "project replacement")
        state.setState({ project: createEmptyProject("Replacement") });
      else
        state.setState({
          project: { ...before },
          actionExecutor: {} as ProjectState["actionExecutor"],
        });
      const current = state.getState().project;
      second.resolve(new Blob(["late"]));
      expect((await pending).success).toBe(false);
      expect(state.getState().project).toBe(current);
      expect(persisted).not.toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
      expect(URL.createObjectURL).toHaveBeenCalledOnce();
      expect(unused.convertToBlob).not.toHaveBeenCalled();
    },
  );
  it("keeps published URLs alive when storage fails and retains shared thumbnail URLs", async () => {
    persisted.mockRejectedValue(new Error("Storage unavailable"));
    bridge.importFile.mockResolvedValue({
      ...decoded(),
      media: {
        ...decoded().media,
        thumbnails: [
          { timestamp: 0, canvas: new ThumbnailCanvas() },
          { timestamp: 1, dataUrl: "blob:shared-from-decoder" },
        ],
      },
    });
    const state = store();
    expect(
      (await state.getState().importMedia(new File(["v"], "source.webm")))
        .success,
    ).toBe(true);
    const media = state.getState().project.mediaLibrary.items[0];
    expect(media.thumbnailUrl).toBe(
      vi.mocked(URL.createObjectURL).mock.results[0].value,
    );
    expect(media.filmstripThumbnails?.[1].url).toBe("blob:shared-from-decoder");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
  });
  it("releases uncommitted relink thumbnails when a newer replacement wins", async () => {
    const state = store();
    const imported = await state
      .getState()
      .importMedia(new File(["old"], "old.webm"));
    const second = deferred<Blob>(),
      started = deferred<void>(),
      unused = new ThumbnailCanvas();
    bridge.importFile.mockResolvedValueOnce({
      ...decoded(),
      media: {
        ...decoded().media,
        thumbnails: [
          { timestamp: 0, canvas: new ThumbnailCanvas() },
          {
            timestamp: 1,
            canvas: new ThumbnailCanvas(
              vi.fn(() => {
                started.resolve();
                return second.promise;
              }),
            ),
          },
          { timestamp: 2, canvas: unused },
        ],
      },
    });
    const pending = state
      .getState()
      .replaceMediaAsset(imported.actionId!, new File(["stale"], "stale.webm"));
    await started.promise;
    const url = vi.mocked(URL.createObjectURL).mock.results[0].value;
    expect(
      (
        await state
          .getState()
          .replaceMediaAsset(imported.actionId!, new File(["new"], "new.webm"))
      ).success,
    ).toBe(true);
    second.resolve(new Blob(["late"]));
    expect((await pending).success).toBe(false);
    expect(state.getState().project.mediaLibrary.items[0].name).toBe(
      "new.webm",
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(unused.convertToBlob).not.toHaveBeenCalled();
  });
  it.each(["import", "replacement"])(
    "does not start a %s thumbnail retry after its media disappears",
    async (kind) => {
      const state = store();
      const imported = await state
        .getState()
        .importMedia(new File(["old"], "old.webm"));
      if (kind === "replacement") {
        await flushThumbnailRetry();
        bridge.generateThumbnailsForMedia.mockClear();
        await state
          .getState()
          .replaceMediaAsset(imported.actionId!, new File(["new"], "new.webm"));
      }
      expect(bridge.generateThumbnailsForMedia).toHaveBeenCalledOnce();
      state.setState({
        project: { ...state.getState().project, mediaLibrary: { items: [] } },
      });
      await flushThumbnailRetry();
      expect(bridge.generateThumbnailsForMedia).toHaveBeenCalledOnce();
    },
  );
  it.each(["import", "replacement"])(
    "retains the %s thumbnail retry for live media",
    async (kind) => {
      const state = store();
      const imported = await state
        .getState()
        .importMedia(new File(["old"], "old.webm"));
      if (kind === "replacement") {
        await flushThumbnailRetry();
        bridge.generateThumbnailsForMedia.mockClear();
        await state
          .getState()
          .replaceMediaAsset(imported.actionId!, new File(["new"], "new.webm"));
      }
      const media = state.getState().project.mediaLibrary.items[0];
      bridge.generateThumbnailsForMedia.mockResolvedValue([
        { timestamp: 0, dataUrl: "data:image/jpeg;base64,retry" },
      ]);
      await flushThumbnailRetry();
      const current = state.getState().project.mediaLibrary.items[0];
      expect(bridge.generateThumbnailsForMedia).toHaveBeenCalledTimes(2);
      expect(current).toMatchObject({
        id: media.id,
        name: media.name,
        blob: media.blob,
        thumbnailUrl: "data:image/jpeg;base64,retry",
        filmstripThumbnails: [
          { timestamp: 0, url: "data:image/jpeg;base64,retry" },
        ],
      });
    },
  );
});
