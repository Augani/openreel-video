import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { PreviewProxyControls, PreviewProxyBadge } from "./PreviewProxyControls";
import { previewProxyCache } from "../../stores/preview-proxy-store";

const generation = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../../stores/preview-proxy-store", async () => {
  const { PreviewProxyCache } = await import("../../services/preview-proxy-cache");
  const { useStore } = await import("zustand");
  const previewProxyCache = new PreviewProxyCache({
    loadOriginal: async (_id, item) => item.blob!,
    generate: generation.generate,
    inspect: async () => ({ width: 1280, height: 720 }),
  });
  return { previewProxyCache, usePreviewProxyStore: (selector: (state: ReturnType<typeof previewProxyCache.store.getState>) => unknown) => useStore(previewProxyCache.store, selector) };
});
const item: MediaItem = {
  id: "video", name: "Camera.mp4", type: "video", blob: new Blob(["original"]), fileHandle: null, waveformData: null, thumbnailUrl: null,
  metadata: { width: 3840, height: 2160, duration: 30, frameRate: 30, codec: "avc", sampleRate: 48000, channels: 2, fileSize: 8 },
};
const project = { id: "project", mediaLibrary: { items: [item] } } as Project;

describe("visible proxy workflow", () => {
  beforeEach(() => {
    generation.generate.mockReset().mockResolvedValue(new Blob(["proxy"]));
    previewProxyCache.syncProject(project);
  });
  afterEach(() => { cleanup(); previewProxyCache.syncProject(null); });

  it("creates the selected quality, shows dimensions and toggles preview without changing the project", async () => {
    render(<><PreviewProxyControls item={item} /><PreviewProxyBadge mediaId={item.id} /></>);
    expect(screen.getByText(/Exports always use your original video/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Proxy quality" }), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "Create preview proxy" }));
    await screen.findByText(/Proxy ready · 1280 × 720/);
    expect(generation.generate.mock.calls[0][1]).toBe("high");
    expect(screen.getByRole("button", { name: "Proxy", pressed: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Original" }));
    expect(previewProxyCache.resolve(project.id, item).blob).toBe(item.blob);
    expect(screen.getByText("Original preview")).toBeInTheDocument();
    expect(project.mediaLibrary.items[0].blob).toBe(item.blob);
    fireEvent.click(screen.getByRole("button", { name: "Remove cached proxy" }));
    expect(screen.getByRole("button", { name: "Create preview proxy" })).toBeInTheDocument();
  });

  it("shows per-media progress and cancellation keeps the original after late completion", async () => {
    let complete!: (blob: Blob) => void;
    generation.generate.mockImplementation((_file: File, _preset: string, onProgress: (value: number) => void) => {
      onProgress(0.5);
      return new Promise<Blob>((resolve) => { complete = resolve; });
    });
    render(<><PreviewProxyControls item={item} /><PreviewProxyBadge mediaId={item.id} /></>);
    fireEvent.click(screen.getByRole("button", { name: "Create preview proxy" }));
    await screen.findByText("Proxy 50%");
    expect(screen.getByRole("progressbar", { name: "Proxy progress for Camera.mp4" })).toHaveAttribute("value", "0.5");
    fireEvent.click(screen.getByRole("button", { name: "Cancel proxy" }));
    expect((generation.generate.mock.calls[0][3] as AbortSignal).aborted).toBe(true);
    await act(async () => { complete(new Blob(["late"])); });
    expect(previewProxyCache.resolve(project.id, item)).toBe(item);
    expect(screen.queryByText(/Proxy ready/)).not.toBeInTheDocument();
  });

  it("explains encoder errors and lets users retry", async () => {
    generation.generate.mockRejectedValueOnce(new Error("Browser encoder unavailable"));
    render(<PreviewProxyControls item={item} />);
    fireEvent.click(screen.getByRole("button", { name: "Create preview proxy" }));
    await screen.findByText("Browser encoder unavailable");
    expect(previewProxyCache.resolve(project.id, item)).toBe(item);
    fireEvent.click(screen.getByRole("button", { name: "Create preview proxy" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Proxy", pressed: true })).toBeInTheDocument());
  });
});
