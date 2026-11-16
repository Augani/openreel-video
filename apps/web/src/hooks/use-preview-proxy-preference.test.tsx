import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { usePreviewProxyPreference } from "./use-preview-proxy-preference";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { previewProxyCache } from "../stores/preview-proxy-store";
import { createEmptyProject } from "../stores/project/project-helpers";

const generation = vi.hoisted(() => vi.fn());
vi.mock("../stores/preview-proxy-store", async () => {
  const { PreviewProxyCache } = await import("../services/preview-proxy-cache");
  return {
    previewProxyCache: new PreviewProxyCache({
      loadOriginal: async () => new Blob(["source"]),
      generate: generation,
      inspect: async () => ({ width: 1280, height: 720 }),
    }),
  };
});
const item: MediaItem = {
  id: "4k",
  type: "video",
  name: "4K camera.mp4",
  blob: new Blob(["source"]),
  fileHandle: null,
  thumbnailUrl: null,
  waveformData: null,
  metadata: {
    width: 3840,
    height: 2160,
    duration: 10,
    frameRate: 30,
    codec: "avc",
    fileSize: 6,
    sampleRate: 48000,
    channels: 2,
  },
};
let project: Project;
beforeEach(() => {
  generation.mockReset().mockResolvedValue(new Blob(["proxy"]));
  project = createEmptyProject("Proxy preference QA");
  project = {
    ...project,
    mediaLibrary: {
      ...project.mediaLibrary,
      items: [
        item,
        {
          ...item,
          id: "hd",
          metadata: { ...item.metadata, width: 1920, height: 1080 },
        },
        { ...item, id: "pending", isPending: true },
      ],
    },
  };
  useProjectStore.setState({ project, hasOpenProject: true });
  useUIStore.setState({ autoProxy4k: false, hardwareAcceleration: true });
  previewProxyCache.syncProject(project);
});
afterEach(() => {
  cleanup();
  previewProxyCache.syncProject(null);
});
describe("4K preview proxy preference", () => {
  it("queues only ready 4K videos, reuses completed proxies across toggles and keeps original media", async () => {
    renderHook(usePreviewProxyPreference);
    expect(generation).not.toHaveBeenCalled();
    act(() => useUIStore.getState().setAutoProxy4k(true));
    await waitFor(() =>
      expect(previewProxyCache.store.getState().entries["4k"]?.status).toBe(
        "ready",
      ),
    );
    expect(generation).toHaveBeenCalledOnce();
    expect(Object.keys(previewProxyCache.store.getState().entries)).toEqual([
      "4k",
    ]);
    act(() => useUIStore.getState().setAutoProxy4k(false));
    expect(previewProxyCache.store.getState().entries["4k"].enabled).toBe(
      false,
    );
    act(() => useUIStore.getState().setAutoProxy4k(true));
    expect(previewProxyCache.store.getState().entries["4k"].enabled).toBe(true);
    expect(generation).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().project.mediaLibrary.items[0].blob).toBe(
      item.blob,
    );
  });
  it("cancels pending automatic work when disabled and ignores late output", async () => {
    let finish!: (blob: Blob) => void;
    generation.mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    );
    renderHook(usePreviewProxyPreference);
    act(() => useUIStore.getState().setAutoProxy4k(true));
    await waitFor(() => expect(generation).toHaveBeenCalledOnce());
    const signal = generation.mock.calls[0][3] as AbortSignal;
    act(() => useUIStore.getState().setAutoProxy4k(false));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish(new Blob(["late"]));
    });
    expect(previewProxyCache.store.getState().entries["4k"]).toBeUndefined();
  });
  it("preserves a manually selected original preview", async () => {
    previewProxyCache.request(item, "low");
    await waitFor(() =>
      expect(previewProxyCache.store.getState().entries["4k"]?.status).toBe(
        "ready",
      ),
    );
    previewProxyCache.setEnabled(item.id, false);
    useUIStore.setState({ autoProxy4k: true });
    renderHook(usePreviewProxyPreference);
    expect(previewProxyCache.store.getState().entries["4k"].enabled).toBe(
      false,
    );
    act(() => useUIStore.getState().setAutoProxy4k(false));
    expect(previewProxyCache.store.getState().entries["4k"].enabled).toBe(
      false,
    );
  });
});
