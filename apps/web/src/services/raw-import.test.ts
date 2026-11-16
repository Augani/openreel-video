import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRawCachesForTests, writeDng } from "@openreel/core";
import { buildRawMediaItem, RawImportError } from "./raw-import";
import { looksLikeCinemaDngFrame, sequenceFrameSize } from "./cinemadng-sequence";

// jsdom's Blob predates Blob.arrayBuffer().
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

function dngFile(name = "IMG_0001.dng"): File {
  const w = 32;
  const h = 24;
  const samples = new Uint16Array(w * h).map((_, i) => 3000 + (i % w) * 200);
  const bytes = writeDng({
    width: w,
    height: h,
    samples,
    bitsPerSample: 14,
    compression: "lossless-jpeg",
    colorMatrix1: [0.6722, -0.0635, -0.0963, -0.4287, 1.246, 0.2028, -0.0908, 0.2162, 0.5668],
    illuminant1: 21,
    asShotNeutral: [0.5, 1, 0.7],
    make: "OpenReel",
    model: "Unit",
    orientation: 6,
  });
  return new File([bytes], name);
}

afterEach(() => {
  resetRawCachesForTests();
  vi.unstubAllGlobals();
});

describe("buildRawMediaItem", () => {
  it("turns a DNG into an image item that keeps the camera file and the as-shot settings", async () => {
    const file = dngFile();
    const { item } = await buildRawMediaItem(file, "id-1");
    expect(item).toMatchObject({ id: "id-1", type: "image", name: "IMG_0001.dng" });
    expect(item.blob).toBe(file);
    // Orientation 6 swaps the sides of the 32 x 24 mosaic.
    expect(item.metadata).toMatchObject({ width: 24, height: 32, codec: "dng", duration: 0 });
    expect(item.raw).toMatchObject({ format: "dng", developedBy: "openreel", make: "OpenReel", model: "Unit", bitDepth: 14, cfa: "RGGB" });
    expect(item.raw?.settings).toMatchObject({ exposure: 0, highlightRecovery: 0, demosaic: "standard", outputColorSpace: "srgb" });
    expect(item.raw?.asShot?.temperature).toBe(item.raw?.settings?.temperature);
  });

  it("refuses cinema formats and, off macOS, proprietary stills, saying what to do", async () => {
    await expect(buildRawMediaItem(new File([new Uint8Array(8)], "A001.braw"), "x")).rejects.toThrow(/not supported/);
    await expect(buildRawMediaItem(new File([new Uint8Array(8)], "A001.R3D"), "x")).rejects.toThrow(RawImportError);
    await expect(buildRawMediaItem(new File([new Uint8Array(8)], "IMG_1.CR3"), "x")).rejects.toThrow(/Convert to DNG/);
  });

  it("reports a damaged DNG by name instead of importing garbage", async () => {
    const good = dngFile();
    const bytes = new Uint8Array(await good.arrayBuffer());
    const broken = new File([bytes.subarray(0, bytes.length - 30)], "broken.dng");
    await expect(buildRawMediaItem(broken, "y")).rejects.toThrow(/broken\.dng/);
  });

  it("uses macOS ImageIO for proprietary stills on the desktop app", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    vi.stubGlobal("window", {
      openreel: {
        platform: "desktop",
        fs: { pathForFile: () => "/photos/IMG_1.CR3", readFileBytes: async () => png.buffer },
        media: { developRawStill: vi.fn(async () => ({ outPath: "/tmp/x.png", width: 6000, height: 4000 })) },
      },
    });
    vi.stubGlobal("createImageBitmap", async () => ({ width: 6000, height: 4000, close() {} }));
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,AA" };
    vi.stubGlobal("document", { createElement: () => canvas });
    const { item } = await buildRawMediaItem(new File([new Uint8Array(8)], "IMG_1.CR3"), "z");
    expect(item.raw).toEqual({ format: "cr3", developedBy: "macos-imageio" });
    expect(item.metadata).toMatchObject({ width: 6000, height: 4000 });
    expect(item.blob?.type).toBe("image/png");
  });
});

describe("sequenceFrameSize", () => {
  it("keeps even dimensions and caps the long edge", () => {
    expect(sequenceFrameSize(4099, 2161)).toEqual({ width: 3840, height: 2024 });
    expect(sequenceFrameSize(1281, 721)).toEqual({ width: 1280, height: 720 });
  });
});

describe("CinemaDNG detection", () => {
  it("treats numbered stills from a stills camera as photos, and frames with CinemaDNG tags as video", async () => {
    expect(await looksLikeCinemaDngFrame(dngFile("IMG_0001.dng"))).toBe(false);
    const frame = new File(
      [writeDng({ width: 16, height: 16, samples: new Uint16Array(256).fill(1000), bitsPerSample: 12, frameRate: 24 })],
      "take_000001.dng",
    );
    expect(await looksLikeCinemaDngFrame(frame)).toBe(true);
    expect(await looksLikeCinemaDngFrame(new File([new Uint8Array(32)], "junk.dng"))).toBe(false);
  });
});
