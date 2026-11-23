import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenReelBrowserEntry, OpenReelBrowserListing } from "../../types/global";
import { MediaBrowserPanel } from "./MediaBrowserPanel";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMediaBrowserStore } from "../../stores/media-browser-store";
import { useSourceMonitorStore } from "../../stores/source-monitor-store";

const clipEntry = (name: string, kind: "sony-xavc" | "avchd" | "gopro", paths: string[]): OpenReelBrowserEntry => ({
  id: `${kind}:${paths[0]}`,
  kind: "clip",
  name,
  path: paths[0],
  size: 1000 * paths.length,
  mtimeMs: 1,
  mediaType: "video",
  clip: { id: `${kind}:${paths[0]}`, name, kind, spanned: paths.length > 1, segments: paths.map((p) => ({ path: p, name: p.split("/").pop()!, size: 1000 })), sidecars: [] },
});

const listings: Record<string, OpenReelBrowserListing> = {
  "/Volumes/CARD": { path: "/Volumes/CARD", parent: "/Volumes", card: { kinds: [{ kind: "avchd", label: "AVCHD" }] }, entries: [clipEntry("00000", "avchd", ["/Volumes/CARD/00000.MTS"]), clipEntry("00001", "avchd", ["/Volumes/CARD/00001.MTS", "/Volumes/CARD/00002.MTS"])] },
  "/Users/me": {
    path: "/Users/me",
    parent: "/Users",
    entries: [
      { id: "/Users/me/Footage", kind: "dir", name: "Footage", path: "/Users/me/Footage", size: 0, mtimeMs: 1 },
      { id: "/Users/me/voice.wav", kind: "file", name: "voice.wav", path: "/Users/me/voice.wav", size: 10, mtimeMs: 1, mediaType: "audio" },
      { id: "/Users/me/still.jpg", kind: "file", name: "still.jpg", path: "/Users/me/still.jpg", size: 10, mtimeMs: 1, mediaType: "image" },
    ],
  },
};

function desktopBridge() {
  return {
    places: vi.fn().mockResolvedValue([{ name: "Home", path: "/Users/me", kind: "place" }, { name: "CARD", path: "/Volumes/CARD", kind: "volume" }]),
    list: vi.fn(async ({ path }: { path: string }) => listings[path] ?? { path, parent: null, entries: [] }),
    thumbnail: vi.fn().mockResolvedValue("data:image/jpeg;base64,AAAA"),
    filmstrip: vi.fn().mockResolvedValue({ duration: 3.5, frames: ["data:a", "data:b", "data:c", "data:d"] }),
    probeClip: vi.fn().mockResolvedValue({ duration: 3.5, segmentDurations: [2, 1.5], width: 320, height: 180, frameRate: 25 }),
    preview: vi.fn().mockResolvedValue({ data: new ArrayBuffer(8), duration: 3.5, truncated: false }),
    prepareImport: vi.fn().mockResolvedValue({ path: "/cache/joined/abc.mts", name: "00001.mts", duration: 3.5, joined: true }),
    readXmp: vi.fn().mockResolvedValue({ fields: { keywords: ["night"], scene: "4" }, source: "sidecar" }),
    writeSidecar: vi.fn(),
  };
}

describe("MediaBrowserPanel (desktop)", () => {
  let bridge: ReturnType<typeof desktopBridge>;
  beforeEach(() => {
    bridge = desktopBridge();
    (window as unknown as { openreel: unknown }).openreel = {
      platform: "desktop",
      mediaBrowser: bridge,
      ingest: { stat: vi.fn().mockResolvedValue({ "/cache/joined/abc.mts": { exists: true, size: 10 } }) },
      fs: { readFileBytes: vi.fn().mockResolvedValue(new ArrayBuffer(4)) },
    };
    const project = createEmptyProject("Browser");
    useProjectStore.setState({ hasOpenProject: true, project });
    useProjectStore.getState().actionExecutor.getHistory().clear();
    useMediaBrowserStore.setState({ path: null, listing: null, selected: [], query: "", typeFilter: "all", rawFolders: false, favourites: [], importing: false });
    useSourceMonitorStore.setState({ externalPreview: null, mediaId: null });
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as { openreel?: unknown }).openreel;
    vi.restoreAllMocks();
  });

  it("opens at Home, filters by type and searches", async () => {
    render(<MediaBrowserPanel />);
    await waitFor(() => expect(screen.getAllByTestId("media-browser-entry")).toHaveLength(3));
    fireEvent.change(screen.getByTestId("media-browser-type"), { target: { value: "audio" } });
    expect(screen.getAllByTestId("media-browser-entry").map((e) => e.getAttribute("data-entry-name"))).toEqual(["Footage", "voice.wav"]);
    fireEvent.change(screen.getByTestId("media-browser-type"), { target: { value: "all" } });
    fireEvent.change(screen.getByTestId("media-browser-search"), { target: { value: "still" } });
    expect(screen.getAllByTestId("media-browser-entry").map((e) => e.getAttribute("data-entry-name"))).toEqual(["still.jpg"]);
  });

  it("shows a camera card's clips, with the spanned clip as one entry", async () => {
    render(<MediaBrowserPanel />);
    await waitFor(() => expect(bridge.list).toHaveBeenCalled());
    await act(async () => useMediaBrowserStore.getState().setPath("/Volumes/CARD"));
    await waitFor(() => expect(screen.getByTestId("media-browser-card-banner")).toHaveTextContent("AVCHD card"));
    const entries = screen.getAllByTestId("media-browser-entry");
    expect(entries.map((e) => [e.getAttribute("data-entry-name"), e.getAttribute("data-entry-segments")])).toEqual([["00000", "1"], ["00001", "2"]]);
    expect(entries.every((e) => e.getAttribute("data-entry-kind") === "clip")).toBe(true);
    fireEvent.click(screen.getByTestId("media-browser-raw"));
    await waitFor(() => expect(bridge.list).toHaveBeenLastCalledWith({ path: "/Volumes/CARD", rawFolders: true }));
  });

  it("scrubs a thumbnail through the clip on hover", async () => {
    render(<MediaBrowserPanel />);
    await waitFor(() => expect(bridge.list).toHaveBeenCalled());
    await act(async () => useMediaBrowserStore.getState().setPath("/Volumes/CARD"));
    const entry = await screen.findAllByTestId("media-browser-entry");
    const thumb = within(entry[1]).getByTestId("media-browser-thumb");
    vi.spyOn(thumb, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100, top: 0, height: 56, right: 100, bottom: 56, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.mouseEnter(thumb);
    await waitFor(() => expect(bridge.filmstrip).toHaveBeenCalled(), { timeout: 2000 });
    await waitFor(() => expect(thumb.querySelector("img")?.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA"));
    fireEvent.mouseMove(thumb, { clientX: 90 });
    await waitFor(() => expect(thumb.querySelector("img")?.getAttribute("src")).toBe("data:d"));
    fireEvent.mouseMove(thumb, { clientX: 1 });
    await waitFor(() => expect(thumb.querySelector("img")?.getAttribute("src")).toBe("data:a"));
  });

  it("previews a clip in the Source monitor without importing it", async () => {
    render(<MediaBrowserPanel />);
    await waitFor(() => expect(bridge.list).toHaveBeenCalled());
    await act(async () => useMediaBrowserStore.getState().setPath("/Volumes/CARD"));
    const entries = await screen.findAllByTestId("media-browser-entry");
    fireEvent.doubleClick(entries[1]);
    await waitFor(() => expect(useSourceMonitorStore.getState().externalPreview).not.toBeNull());
    expect(useSourceMonitorStore.getState()).toMatchObject({ tab: "source", externalPreview: { name: "00001", duration: 3.5, note: expect.stringContaining("2 files joined") } });
    expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(0);
  });

  it("imports a spanned clip as ONE item with its XMP metadata", async () => {
    const importMedia = vi.fn().mockImplementation(async (file: File) => {
      const project = useProjectStore.getState().project;
      useProjectStore.setState({ project: { ...project, mediaLibrary: { items: [...project.mediaLibrary.items, { id: "new1", name: file.name, type: "video", blob: file, fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { duration: 3.5, width: 320, height: 180, frameRate: 25, codec: "h264", sampleRate: 0, channels: 0, fileSize: 4 } } as never] } } });
      return { success: true, actionId: "new1" };
    });
    useProjectStore.setState({ importMedia } as never);
    render(<MediaBrowserPanel />);
    await waitFor(() => expect(bridge.list).toHaveBeenCalled());
    await act(async () => useMediaBrowserStore.getState().setPath("/Volumes/CARD"));
    const entries = await screen.findAllByTestId("media-browser-entry");
    fireEvent.click(entries[1]);
    fireEvent.click(screen.getByTestId("media-browser-import"));
    await waitFor(() => expect(importMedia).toHaveBeenCalledTimes(1));
    expect(bridge.prepareImport).toHaveBeenCalledWith({ clip: { name: "00001", kind: "avchd", segments: [{ path: "/Volumes/CARD/00001.MTS" }, { path: "/Volumes/CARD/00002.MTS" }] } });
    expect((importMedia.mock.calls[0][0] as File).name).toBe("00001.mts");
    await waitFor(() => expect(useProjectStore.getState().project.mediaLibrary.items[0].keywords).toEqual(["night"]));
    const item = useProjectStore.getState().project.mediaLibrary.items[0];
    expect(item).toMatchObject({ scene: "4", xmpSource: "sidecar", sourceFile: { path: "/cache/joined/abc.mts" } });
    expect(bridge.readXmp).toHaveBeenCalledWith("/Volumes/CARD/00001.MTS");
    expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(1);
  });

  it("favourites a folder and remembers the view", async () => {
    render(<MediaBrowserPanel />);
    await waitFor(() => expect(screen.getAllByTestId("media-browser-entry").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("media-browser-favourite"));
    expect(useMediaBrowserStore.getState().favourites).toEqual([{ name: "me", path: "/Users/me" }]);
    fireEvent.click(screen.getByTestId("media-browser-view-list"));
    expect(screen.getByTestId("media-browser-list")).toHaveAttribute("data-view", "list");
    expect(JSON.parse(localStorage.getItem("openreel-media-browser")!)).toMatchObject({ view: "list", favourites: [{ path: "/Users/me" }] });
  });
});

describe("MediaBrowserPanel (web, File System Access)", () => {
  const file = (name: string, text = "x") => new File([text], name, { type: name.endsWith(".mp4") ? "video/mp4" : "" });
  type Node = { kind: "directory"; entries: Record<string, Node> } | { kind: "file"; file: File };
  const dir = (entries: Record<string, Node>): Node => ({ kind: "directory", entries });
  const fileNode = (f: File): Node => ({ kind: "file", file: f });
  const handleOf = (name: string, node: Node): FileSystemHandle => {
    if (node.kind === "file") return { kind: "file", name, getFile: async () => node.file } as unknown as FileSystemHandle;
    return {
      kind: "directory",
      name,
      getDirectoryHandle: async (n: string) => {
        const child = node.entries[n];
        if (!child || child.kind !== "directory") throw new Error("NotFound");
        return handleOf(n, child);
      },
      getFileHandle: async (n: string) => {
        const child = node.entries[n];
        if (!child || child.kind !== "file") throw new Error("NotFound");
        return handleOf(n, child);
      },
      async *entries() {
        for (const [n, child] of Object.entries(node.entries)) yield [n, handleOf(n, child)];
      },
    } as unknown as FileSystemHandle;
  };

  beforeEach(() => {
    const tree = dir({
      "GH010123.MP4": fileNode(file("GH010123.MP4")),
      "GH020123.MP4": fileNode(file("GH020123.MP4")),
      "interview.mp4": fileNode(file("interview.mp4")),
      "clip.xmp": fileNode(file("clip.xmp")),
      PRIVATE: dir({ M4ROOT: dir({ CLIP: dir({ "C0001.MP4": fileNode(file("C0001.MP4")) }) }) }),
    });
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn().mockResolvedValue(handleOf("SD", tree));
    useProjectStore.setState({ hasOpenProject: true, project: createEmptyProject("Web") });
    useMediaBrowserStore.setState({ path: null, listing: null, selected: [], query: "", typeFilter: "all", rawFolders: false, favourites: [], importing: false });
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    vi.restoreAllMocks();
  });

  it("opens a folder, recognises the Sony card and shows chaptered GoPro files as one clip", async () => {
    render(<MediaBrowserPanel />);
    fireEvent.click(screen.getByTestId("media-browser-open-folder"));
    await waitFor(() => expect(screen.getByTestId("media-browser-card-banner")).toHaveTextContent("Sony XAVC card"));
    expect(screen.getAllByTestId("media-browser-entry").map((e) => e.getAttribute("data-entry-name"))).toEqual(["C0001"]);
    fireEvent.click(screen.getByTestId("media-browser-raw"));
    await waitFor(() => expect(screen.getByTestId("media-browser-card-banner")).toHaveAttribute("data-raw", "true"));
    await waitFor(() => expect(screen.getAllByTestId("media-browser-entry").map((e) => `${e.getAttribute("data-entry-kind")}:${e.getAttribute("data-entry-name")}`)).toEqual(["dir:PRIVATE", "clip:GH0123", "file:interview.mp4"]));
  });

  it("explains itself where the browser cannot open folders", () => {
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    render(<MediaBrowserPanel />);
    expect(screen.getByTestId("media-browser-unsupported")).toBeInTheDocument();
  });
});
