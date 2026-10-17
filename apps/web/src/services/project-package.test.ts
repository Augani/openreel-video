import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import type { MediaItem } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { createProjectPackage, readProjectPackage, copyPackagedProject } from "./project-package";
beforeEach(() => { vi.stubGlobal("Blob", NodeBlob); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture() {
  const project = createEmptyProject("Portable project");
  const item: MediaItem = { id: "media", name: "source.mp4", type: "video", fileHandle: null,
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "video/mp4" }), thumbnailUrl: "blob:old-tab", waveformData: null,
    metadata: { duration: 2, width: 640, height: 360, frameRate: 24, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 4 } };
  return { ...project, mediaLibrary: { items: [item] } };
}

describe("portable project packages", () => {
  it("round trips original bytes and editable data without reading media into JavaScript buffers", async () => {
    const project = fixture();
    const read = vi.spyOn(project.mediaLibrary.items[0].blob!, "arrayBuffer").mockRejectedValue(new Error("Must not buffer original media"));
    const archive = await createProjectPackage(project);
    const wholeRead = vi.spyOn(archive, "arrayBuffer").mockRejectedValue(new Error("Must not buffer the whole backup"));
    const restored = await readProjectPackage(archive);
    expect(restored.settings).toEqual(project.settings);
    expect(restored.mediaLibrary.items[0]).toMatchObject({ id: "media", thumbnailUrl: null, isPlaceholder: false });
    expect([...new Uint8Array(await restored.mediaLibrary.items[0].blob!.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect(restored.mediaLibrary.items[0].blob!.type).toBe("video/mp4");
    expect(read).not.toHaveBeenCalled(); expect(wholeRead).not.toHaveBeenCalled();
  });
  it("blocks backups with missing originals instead of silently creating placeholders", async () => {
    const project = fixture();
    project.mediaLibrary.items = [{ ...project.mediaLibrary.items[0], blob: null, isPlaceholder: true }];
    await expect(createProjectPackage(project)).rejects.toThrow("Relink");
    const restored = await readProjectPackage(await createProjectPackage(project, { resolveMedia: async () => new Blob(["stored original"]) }));
    expect(await restored.mediaLibrary.items[0].blob!.text()).toBe("stored original");
  });
  it("rejects truncated, trailing, and unrelated files", async () => {
    const archive = await createProjectPackage(fixture());
    await expect(readProjectPackage(archive.slice(0, archive.size - 1))).rejects.toThrow("incomplete");
    await expect(readProjectPackage(new Blob([archive, "unexpected"]))).rejects.toThrow("trailing");
    await expect(readProjectPackage(new Blob(["not an OpenReel package"]))).rejects.toThrow("not an OpenReel");
  });
  it("rejects a forged media size before slicing media", async () => {
    const archive = await createProjectPackage(fixture());
    const header = await archive.slice(0, 16).arrayBuffer();
    const length = new DataView(header).getUint32(12, true);
    const manifest = JSON.parse(await archive.slice(16, 16 + length).text());
    manifest.assets[0].size = Number.MAX_SAFE_INTEGER;
    const text = new TextEncoder().encode(JSON.stringify(manifest));
    new DataView(header).setUint32(12, text.byteLength, true);
    await expect(readProjectPackage(new Blob([header, text, new Uint8Array([1, 2, 3, 4])]))).rejects.toThrow("invalid media");
  });
  it("cancels while resolving an original and does not produce a partial backup", async () => {
    const controller = new AbortController();
    const project = fixture(); project.mediaLibrary.items = [{ ...project.mediaLibrary.items[0], blob: null }];
    await expect(createProjectPackage(project, { signal: controller.signal, resolveMedia: async () => { controller.abort(); return new Blob(["original"]); } })).rejects.toMatchObject({ name: "AbortError" });
  });
  it("opens copies with new storage IDs while preserving names and nested media references", () => {
    const original = fixture();
    const copy = copyPackagedProject({ ...original, metadata: { mediaId: "media", note: "media" } } as typeof original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.mediaLibrary.items[0].id).not.toBe("media");
    expect(copy.mediaLibrary.items[0].blob).toBe(original.mediaLibrary.items[0].blob);
    expect((copy as unknown as { metadata: { mediaId: string; note: string } }).metadata).toEqual({ mediaId: copy.mediaLibrary.items[0].id, note: "media" });
    expect(original.mediaLibrary.items[0].id).toBe("media");
  });
});
