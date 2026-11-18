import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { TitleEngine, type MediaItem } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import {
  createProjectPackage,
  readProjectPackage,
  copyPackagedProject,
  readProjectPackageContents,
} from "./project-package";
import { registerPackagedFonts, setBrotliDecoder } from "./font-embedding";
import { makeSfnt, makeWoff2 } from "./font-fixtures";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const project = createEmptyProject("Portable project");
  const item: MediaItem = {
    id: "media",
    name: "source.mp4",
    type: "video",
    fileHandle: null,
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "video/mp4" }),
    thumbnailUrl: "blob:old-tab",
    waveformData: null,
    metadata: {
      duration: 2,
      width: 640,
      height: 360,
      frameRate: 24,
      codec: "h264",
      sampleRate: 48000,
      channels: 2,
      fileSize: 4,
    },
  };
  return { ...project, mediaLibrary: { items: [item] } };
}

describe("portable project packages", () => {
  it("copies typed samples and nested metadata without losing their types or changing the source", () => {
    const original = fixture(),
      title = new TitleEngine().createTextClip({
        id: "title",
        trackId: "titles",
        startTime: 0,
        text: "Retained metadata",
        metadata: {
          samples: new Float32Array([0, 0.25, 1]),
          references: new Map([["channel", { sourceMediaId: "media" }]]),
        },
      });
    const copy = copyPackagedProject({ ...original, textClips: [title] });
    const metadata = copy.textClips![0].metadata!;
    expect(ArrayBuffer.isView(metadata.samples)).toBe(true);
    expect(Object.prototype.toString.call(metadata.samples)).toBe(
      "[object Float32Array]",
    );
    expect(Array.from(metadata.samples as Float32Array)).toEqual([0, 0.25, 1]);
    expect(metadata.samples).not.toBe(title.metadata!.samples);
    expect(metadata.references).toBeInstanceOf(Map);
    expect(
      (metadata.references as Map<string, unknown>).get("channel"),
    ).toEqual({ sourceMediaId: copy.mediaLibrary.items[0].id });
    expect(
      (title.metadata!.references as Map<string, unknown>).get("channel"),
    ).toEqual({ sourceMediaId: "media" });
  });
  it("round trips original bytes and editable data without reading media into JavaScript buffers", async () => {
    const project = fixture();
    const read = vi
      .spyOn(project.mediaLibrary.items[0].blob!, "arrayBuffer")
      .mockRejectedValue(new Error("Must not buffer original media"));
    const archive = await createProjectPackage(project);
    const wholeRead = vi
      .spyOn(archive, "arrayBuffer")
      .mockRejectedValue(new Error("Must not buffer the whole backup"));
    const restored = await readProjectPackage(archive);
    expect(restored.settings).toEqual(project.settings);
    expect(restored.mediaLibrary.items[0]).toMatchObject({
      id: "media",
      thumbnailUrl: null,
      isPlaceholder: false,
    });
    expect([
      ...new Uint8Array(
        await restored.mediaLibrary.items[0].blob!.arrayBuffer(),
      ),
    ]).toEqual([1, 2, 3, 4]);
    expect(restored.mediaLibrary.items[0].blob!.type).toBe("video/mp4");
    expect(read).not.toHaveBeenCalled();
    expect(wholeRead).not.toHaveBeenCalled();
  });
  it("blocks backups with missing originals instead of silently creating placeholders", async () => {
    const project = fixture();
    project.mediaLibrary.items = [
      { ...project.mediaLibrary.items[0], blob: null, isPlaceholder: true },
    ];
    await expect(createProjectPackage(project)).rejects.toThrow("Relink");
    const restored = await readProjectPackage(
      await createProjectPackage(project, {
        resolveMedia: async () => new Blob(["stored original"]),
      }),
    );
    expect(await restored.mediaLibrary.items[0].blob!.text()).toBe(
      "stored original",
    );
  });
  it("rejects truncated, trailing, and unrelated files", async () => {
    const archive = await createProjectPackage(fixture());
    await expect(
      readProjectPackage(archive.slice(0, archive.size - 1)),
    ).rejects.toThrow("incomplete");
    await expect(
      readProjectPackage(new Blob([archive, "unexpected"])),
    ).rejects.toThrow("trailing");
    await expect(
      readProjectPackage(new Blob(["not an OpenReel package"])),
    ).rejects.toThrow("not an OpenReel");
  });
  it("rejects a forged media size before slicing media", async () => {
    const archive = await createProjectPackage(fixture());
    const header = await archive.slice(0, 16).arrayBuffer();
    const length = new DataView(header).getUint32(12, true);
    const manifest = JSON.parse(await archive.slice(16, 16 + length).text());
    manifest.assets[0].size = Number.MAX_SAFE_INTEGER;
    const text = new TextEncoder().encode(JSON.stringify(manifest));
    new DataView(header).setUint32(12, text.byteLength, true);
    await expect(
      readProjectPackage(
        new Blob([header, text, new Uint8Array([1, 2, 3, 4])]),
      ),
    ).rejects.toThrow("invalid media");
  });
  it("cancels while resolving an original and does not produce a partial backup", async () => {
    const controller = new AbortController();
    const project = fixture();
    project.mediaLibrary.items = [
      { ...project.mediaLibrary.items[0], blob: null },
    ];
    await expect(
      createProjectPackage(project, {
        signal: controller.signal,
        resolveMedia: async () => {
          controller.abort();
          return new Blob(["original"]);
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("opens copies with new storage IDs while preserving names and nested media references", () => {
    const original = fixture();
    const copy = copyPackagedProject({
      ...original,
      metadata: { mediaId: "media", note: "media" },
    } as typeof original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.mediaLibrary.items[0].id).not.toBe("media");
    expect(copy.mediaLibrary.items[0].blob).toBe(
      original.mediaLibrary.items[0].blob,
    );
    expect(
      (copy as unknown as { metadata: { mediaId: string; note: string } })
        .metadata,
    ).toEqual({ mediaId: copy.mediaLibrary.items[0].id, note: "media" });
    expect(original.mediaLibrary.items[0].id).toBe("media");
  });
  it("embeds permitted user fonts, skips restricted ones, and registers the embedded fonts on open", async () => {
    const files: Record<string, ArrayBuffer> = {
      "Brand Open": makeSfnt(8),
      "Brand Locked": makeSfnt(2),
    };
    const project = {
      ...fixture(),
      textClips: ["Brand Open", "Brand Locked", "Bangers"].map((family, index) => ({
        id: "t" + index,
        trackId: "x",
        startTime: 0,
        duration: 1,
        text: "Hello",
        style: { fontFamily: family, fontWeight: 400 },
      })),
    } as unknown as ReturnType<typeof fixture>;
    let report: { family: string; status: string }[] = [];
    const archive = await createProjectPackage(project, {
      resolveFont: async (family) => files[family] ?? null,
      onFontReport: (entries) => (report = entries.map((e) => ({ family: e.family, status: e.status }))),
    });
    expect(report).toEqual([
      { family: "Bangers", status: "web" },
      { family: "Brand Locked", status: "restricted" },
      { family: "Brand Open", status: "embedded" },
    ]);
    const restored = await readProjectPackageContents(archive);
    expect(restored.fonts.map((f) => f.family)).toEqual(["Brand Open"]);
    expect(new Uint8Array(await restored.fonts[0].data.arrayBuffer())).toEqual(new Uint8Array(files["Brand Open"]));
    expect(restored.fontRecords.find((r) => r.family === "Brand Locked")?.status).toBe("restricted");
    expect(restored.fontRecords.find((r) => r.family === "Bangers")?.url).toContain("Bangers");
    expect(restored.project.mediaLibrary.items[0].blob!.size).toBe(4);
    const registered: string[] = [];
    await registerPackagedFonts(restored.fonts, {
      compare: () => "absent",
      register: async (family) => void registered.push(family),
    });
    expect(registered).toEqual(["Brand Open"]);
  });
  it("round-trips WOFF2 fonts as-is and registers them on open", async () => {
    const previous = setBrotliDecoder(async (data) => new Uint8Array(brotliDecompressSync(data)));
    try {
      const files: Record<string, ArrayBuffer> = {
        "Web Open": makeWoff2(0, brotliCompressSync),
        "Web Locked": makeWoff2(2, brotliCompressSync),
      };
      const project = {
        ...fixture(),
        textClips: Object.keys(files).map((family, index) => ({
          id: "w" + index,
          trackId: "x",
          startTime: 0,
          duration: 1,
          text: "Hello",
          style: { fontFamily: family, fontWeight: 400 },
        })),
      } as unknown as ReturnType<typeof fixture>;
      const archive = await createProjectPackage(project, { resolveFont: async (family) => files[family] ?? null });
      const restored = await readProjectPackageContents(archive);
      expect(restored.fonts.map((f) => f.family)).toEqual(["Web Open"]);
      expect(restored.fonts[0].data.type).toBe("font/woff2");
      expect(new Uint8Array(await restored.fonts[0].data.arrayBuffer())).toEqual(new Uint8Array(files["Web Open"]));
      expect(restored.fontRecords.find((r) => r.family === "Web Locked")?.status).toBe("restricted");
    } finally {
      setBrotliDecoder(previous);
    }
  });
  it("still reads packages written without a font list", async () => {
    const archive = await createProjectPackage(fixture());
    const restored = await readProjectPackageContents(archive);
    expect(restored.fonts).toEqual([]);
    expect(restored.fontRecords).toEqual([]);
  });
});
