import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearNativeDecodeSamples,
  createDesktopNativeFrameProvider,
  getNativeDecodeSamples,
  isNativeCandidate,
  rememberNativePath,
} from "./native-decode";

type Bridge = NonNullable<Window["openreel"]>;

const probe = { path: "/media/a.mov", codec: "prores", width: 1920, height: 1080, frameRate: 24, duration: 4, frameCount: 96 };

function bridge(over: { nativeProbe?: unknown; nativeFrame?: unknown; path?: string } = {}): Bridge {
  return {
    platform: "desktop",
    export: { pathForFile: () => over.path ?? "/media/a.mov" },
    media: {
      nativeProbe: over.nativeProbe ?? vi.fn(async () => probe),
      nativeFrame: over.nativeFrame ?? vi.fn(async () => null),
    },
  } as unknown as Bridge;
}

const file = (type = "video/quicktime") => new File([new Uint8Array(4)], "a.mov", { type });

afterEach(() => clearNativeDecodeSamples());

describe("isNativeCandidate", () => {
  it("sends codecs WebCodecs cannot decode to the sidecar", () => {
    for (const codec of ["prores", "dnxhd", "mpeg4", "mpeg2video", "ffv1", "cfhd", "rawvideo"]) expect(isNativeCandidate("video/quicktime", codec)).toBe(true);
  });

  it("leaves browser-decodable codecs, pictures and audio alone", () => {
    for (const codec of ["h264", "hevc", "vp9", "av1", "vp8"]) expect(isNativeCandidate("video/mp4", codec)).toBe(false);
    expect(isNativeCandidate("image/png", "png")).toBe(false);
    expect(isNativeCandidate("image/jpeg", "mjpeg")).toBe(false);
    expect(isNativeCandidate("audio/wav", "pcm_s16le")).toBe(false);
    expect(isNativeCandidate("", "gif")).toBe(false);
  });
});

describe("MXF and other pro wrappers", () => {
  it("an MXF is always a native candidate, even when it holds H.264 (AVC-Intra) that WebCodecs knows", () => {
    expect(isNativeCandidate("", "h264", "A001C002.MXF")).toBe(true);
    expect(isNativeCandidate("application/mxf", "dnxhd", "/cards/A001/clip.mxf")).toBe(true);
    expect(isNativeCandidate("video/mp4", "h264", "clip.mp4")).toBe(false);
  });

  it("claims an MXF with its container and one audio track per mono PCM stream", async () => {
    const mxf = { path: "/cards/clip.mxf", codec: "h264", width: 1920, height: 1080, frameRate: 25, duration: 8, frameCount: 200, container: "mxf", audioStreams: [1, 2, 3, 4].map(() => ({ codec: "pcm_s24le", channels: 1, sampleRate: 48000 })) };
    const provider = createDesktopNativeFrameProvider(bridge({ nativeProbe: vi.fn(async () => mxf), path: "/cards/clip.mxf" }));
    const claimed = await provider.claim(new File([new Uint8Array(4)], "clip.mxf", { type: "" }));
    expect(claimed).toMatchObject({ id: "/cards/clip.mxf", codec: "h264", container: "mxf", audio: { trackCount: 4, channels: 1, sampleRate: 48000 } });
  });
});

describe("MXF / MOV with audio streams of different widths", () => {
  it("reports the channel count of every stream, not only the widest", async () => {
    const mov = { path: "/cards/mix.mov", codec: "prores", width: 1920, height: 1080, frameRate: 25, duration: 8, frameCount: 200, audioStreams: [{ codec: "pcm_s24le", channels: 1, sampleRate: 48000 }, { codec: "pcm_s24le", channels: 2, sampleRate: 48000 }] };
    const provider = createDesktopNativeFrameProvider(bridge({ nativeProbe: vi.fn(async () => mov), path: "/cards/mix.mov" }));
    const claimed = await provider.claim(new File([new Uint8Array(4)], "mix.mov", { type: "video/quicktime" }));
    expect(claimed?.audio).toEqual({ trackCount: 2, channels: 2, sampleRate: 48000, streamChannels: [1, 2] });
  });
});

describe("desktop native frame provider", () => {
  it("claims a ProRes file with a path and describes it", async () => {
    const provider = createDesktopNativeFrameProvider(bridge());
    expect(await provider.claim(file())).toEqual({ id: "/media/a.mov", width: 1920, height: 1080, frameRate: 24, duration: 4, codec: "prores" });
  });

  it("does not claim H.264, files with no path, or when the sidecar cannot read the file", async () => {
    expect(await createDesktopNativeFrameProvider(bridge({ nativeProbe: vi.fn(async () => ({ ...probe, codec: "h264" })) })).claim(file("video/mp4"))).toBeNull();
    expect(await createDesktopNativeFrameProvider(bridge({ path: "" })).claim(file())).toBeNull();
    expect(await createDesktopNativeFrameProvider(bridge({ nativeProbe: vi.fn(async () => null) })).claim(file())).toBeNull();
  });

  it("uses a remembered path for Blobs that are not picked Files (relinked media)", async () => {
    const nativeProbe = vi.fn(async () => probe);
    const blob = new Blob([new Uint8Array(4)], { type: "video/quicktime" });
    rememberNativePath(blob, "/media/relinked.mov");
    await createDesktopNativeFrameProvider(bridge({ nativeProbe })).claim(blob);
    expect(nativeProbe).toHaveBeenCalledWith({ path: "/media/relinked.mov" });
  });

  it("requests frames by path at the asked width and quality, and records the round trip", async () => {
    const rgba = new Uint8Array(2 * 2 * 4).fill(200);
    const nativeFrame = vi.fn(async () => ({ width: 2, height: 2, frameIndex: 24, timestamp: 1, duration: 1 / 24, rgba }));
    // The test setup provides an OffscreenCanvas mock; jsdom may not provide ImageData.
    const globals = globalThis as { ImageData?: unknown };
    globals.ImageData ??= class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
    const provider = createDesktopNativeFrameProvider(bridge({ nativeFrame }));
    const source = (await provider.claim(file()))!;
    const frame = await provider.getFrame(source, 1.01, { width: 640, quality: "preview" });
    expect(nativeFrame).toHaveBeenCalledWith({ path: "/media/a.mov", time: 1.01, width: 640, quality: "preview" });
    expect(frame).toMatchObject({ timestamp: 1, duration: 1 / 24 });
    expect(frame!.canvas.width).toBe(2);
    expect(getNativeDecodeSamples()).toHaveLength(1);
    expect(getNativeDecodeSamples()[0].quality).toBe("preview");
  });

  it("returns null when the sidecar has no frame", async () => {
    const provider = createDesktopNativeFrameProvider(bridge());
    const source = (await provider.claim(file()))!;
    expect(await provider.getFrame(source, 0, { quality: "full" })).toBeNull();
  });
});
