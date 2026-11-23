import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { MetadataPanel } from "./MetadataPanel";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { filterMediaItems } from "@openreel/core";

const clip = (id: string, name: string, over: Partial<MediaItem> = {}): MediaItem =>
  ({ id, name, type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { duration: 5, width: 1920, height: 1080, frameRate: 25, codec: "h264", sampleRate: 0, channels: 0, fileSize: 1, hasVideo: true, hasAudio: false }, ...over }) as MediaItem;

const select = (...ids: string[]): void => {
  useUIStore.setState({ selectedItems: ids.map((id) => ({ id, type: "media" })) } as never);
};
const items = (): MediaItem[] => useProjectStore.getState().project.mediaLibrary.items;

describe("MetadataPanel", () => {
  beforeEach(() => {
    const project = createEmptyProject("Metadata");
    useProjectStore.setState({ hasOpenProject: true, project: { ...project, mediaLibrary: { items: [clip("a", "A001.mov", { scene: "12" }), clip("b", "B002.mov", { keywords: ["day"] })] } } });
    useProjectStore.getState().actionExecutor.getHistory().clear();
    useUIStore.getState().clearSelection();
  });
  afterEach(() => {
    cleanup();
    useUIStore.getState().clearSelection();
    vi.restoreAllMocks();
  });

  it("asks for a selection first", () => {
    render(<MetadataPanel />);
    expect(screen.getByTestId("metadata-empty")).toBeInTheDocument();
  });

  it("edits keywords, scene and the good flag as undoable project changes the Project panel can search", async () => {
    select("a");
    render(<MetadataPanel />);
    const input = screen.getByTestId("metadata-keyword-input");
    fireEvent.change(input, { target: { value: "night, Interior" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(items()[0].keywords).toEqual(["night", "Interior"]));
    expect(screen.getAllByTestId("metadata-keyword").map((k) => k.textContent)).toEqual(["night", "Interior"]);

    fireEvent.change(screen.getByTestId("metadata-reel"), { target: { value: "A007" } });
    fireEvent.blur(screen.getByTestId("metadata-reel"));
    await waitFor(() => expect(items()[0].reel).toBe("A007"));
    fireEvent.click(screen.getByTestId("metadata-good"));
    await waitFor(() => expect(items()[0].goodTake).toBe(true));

    const ctx = { usage: new Map<string, number>() };
    expect(filterMediaItems(items(), "keyword:interior reel:a007", "all", ctx).map((i) => i.id)).toEqual(["a"]);

    await act(async () => {
      await useProjectStore.getState().undo();
    });
    expect(items()[0].goodTake).toBeUndefined();
    await act(async () => {
      await useProjectStore.getState().undo();
    });
    expect(items()[0].reel).toBeUndefined();
  });

  it("removes a keyword and adds keywords to every selected clip without replacing theirs", async () => {
    select("a", "b");
    render(<MetadataPanel />);
    const input = screen.getByTestId("metadata-keyword-input");
    fireEvent.change(input, { target: { value: "broll" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(items().map((i) => i.keywords)).toEqual([["broll"], ["day", "broll"]]));
    fireEvent.click(screen.getByLabelText("Remove keyword broll"));
    await waitFor(() => expect(items().map((i) => i.keywords)).toEqual([undefined, ["day"]]));
  });

  it("shows the XMP source and hides sidecar controls on the web build", () => {
    useProjectStore.setState({ project: { ...useProjectStore.getState().project, mediaLibrary: { items: [clip("a", "A001.mov", { xmpSource: "sidecar" })] } } });
    select("a");
    render(<MetadataPanel />);
    expect(screen.getByTestId("metadata-source")).toHaveTextContent("sidecar");
    expect(screen.queryByTestId("metadata-write-sidecar")).toBeNull();
  });

  it("writes a sidecar through the desktop bridge", async () => {
    const writeSidecar = vi.fn().mockResolvedValue({ path: "/media/A001.xmp" });
    vi.stubGlobal("openreel", { platform: "desktop", mediaBrowser: { writeSidecar }, fs: {} });
    (window as unknown as { openreel: unknown }).openreel = { platform: "desktop", mediaBrowser: { writeSidecar }, fs: {} };
    useProjectStore.setState({ project: { ...useProjectStore.getState().project, mediaLibrary: { items: [clip("a", "A001.mov", { keywords: ["x"], sourceFile: { name: "A001.mov", size: 1, lastModified: 1, path: "/media/A001.mov" } })] } } });
    select("a");
    render(<MetadataPanel />);
    fireEvent.click(screen.getByTestId("metadata-write-sidecar"));
    await waitFor(() => expect(writeSidecar).toHaveBeenCalled());
    expect(writeSidecar.mock.calls[0][0]).toMatchObject({ path: "/media/A001.mov", fields: { keywords: ["x"] } });
    delete (window as unknown as { openreel?: unknown }).openreel;
    vi.unstubAllGlobals();
  });
});
