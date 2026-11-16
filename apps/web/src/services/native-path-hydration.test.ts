import { describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { findMovedNativeSources, hydrateNativePaths, nativePathOf } from "./native-path-hydration";
import { createDesktopNativeFrameProvider, hasRememberedNativePath } from "./native-decode";

const probe = { path: "/media/clip.mov", codec: "prores", width: 1080, height: 1920, frameRate: 24, duration: 4, frameCount: 96, rotation: 90 };

function item(over: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "m1",
    name: "clip.mov",
    type: "video",
    fileHandle: null,
    blob: new Blob([new Uint8Array(4)], { type: "video/quicktime" }),
    metadata: { duration: 4, width: 1080, height: 1920, frameRate: 24, codec: "", sampleRate: 0, channels: 0, fileSize: 4, hasVideo: true, hasAudio: false },
    thumbnailUrl: null,
    waveformData: null,
    nativeSource: { path: "/media/clip.mov", codec: "prores", width: 1080, height: 1920, frameRate: 24, rotation: 90 },
    sourceFile: { name: "clip.mov", size: 4, lastModified: 1, path: "/media/clip.mov" },
    ...over,
  } as MediaItem;
}

describe("native path hydration", () => {
  it("teaches the decoder where a Blob restored from storage came from, so it is claimed natively again", async () => {
    const restored = item();
    expect(hasRememberedNativePath(restored.blob as Blob)).toBe(false);
    expect(hydrateNativePaths([restored])).toHaveLength(1);
    expect(hasRememberedNativePath(restored.blob as Blob)).toBe(true);

    const nativeProbe = vi.fn(async () => probe);
    const bridge = { platform: "desktop", export: { pathForFile: () => "" }, media: { nativeProbe, nativeFrame: vi.fn() } } as unknown as NonNullable<Window["openreel"]>;
    const claimed = await createDesktopNativeFrameProvider(bridge).claim(restored.blob as Blob);
    expect(nativeProbe).toHaveBeenCalledWith({ path: "/media/clip.mov" });
    expect(claimed).toMatchObject({ id: "/media/clip.mov", codec: "prores", width: 1080, height: 1920, rotation: 90 });
  });

  it("leaves browser-decoded media, placeholders and path-less items alone", () => {
    const web = item({ nativeSource: undefined });
    const offline = item({ isPlaceholder: true, blob: null });
    const nameless = item({ nativeSource: { path: "", codec: "prores", width: 1, height: 1, frameRate: 24 }, sourceFile: { name: "a", size: 1, lastModified: 1 } });
    expect(hydrateNativePaths([web, offline, nameless])).toEqual([]);
    expect(hasRememberedNativePath(web.blob as Blob)).toBe(false);
  });

  it("prefers the saved native path over the recorded file path", () => {
    expect(nativePathOf(item({ nativeSource: { path: "/new/clip.mov", codec: "prores", width: 1, height: 1, frameRate: 24 } }))).toBe("/new/clip.mov");
  });

  it("finds the native files that moved", async () => {
    const here = item({ id: "here" });
    const gone = item({ id: "gone", nativeSource: { path: "/gone/clip.mov", codec: "prores", width: 1, height: 1, frameRate: 24 } });
    const stat = vi.fn(async () => ({ "/media/clip.mov": { exists: true, size: 4 }, "/gone/clip.mov": { exists: false, size: 0 } }));
    const moved = await findMovedNativeSources({ stat }, [here, gone]);
    expect(moved.map((entry) => entry.id)).toEqual(["gone"]);
    expect(stat).toHaveBeenCalledWith(["/media/clip.mov", "/gone/clip.mov"]);
    expect(await findMovedNativeSources({ stat }, [])).toEqual([]);
  });
});
