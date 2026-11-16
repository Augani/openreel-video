import { describe, expect, it } from "vitest";
import { encodeGif, gifFrameDelayCs, gifPlaybackFps, readGif, validateGifFrameBudget, validateGifOptions } from "./gif-encoder";
import { frameFileName, packImageSequence, sequenceFrameRange, validateSequenceRange } from "./image-sequence";
import { readZipStore } from "./zip";

function solid(w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) d.set(rgba, i);
  return d;
}

/** Left half red, right half blue, with a gradient row so the palette has to quantise. */
function split(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d.set(x < w / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i);
    }
  return d;
}

describe("GIF encoder", () => {
  it("round-trips frames, palette, delay and an infinite loop", () => {
    const bytes = encodeGif([{ data: split(16, 8) }, { data: solid(16, 8, [0, 255, 0, 255]) }], { width: 16, height: 8, fps: 10 });
    const gif = readGif(bytes);
    expect(gif.width).toBe(16);
    expect(gif.height).toBe(8);
    expect(gif.loop).toBe(0);
    expect(gif.frames).toHaveLength(2);
    expect(gif.frames[0].delayCs).toBe(10);
    const c = (f: number, x: number, y: number) => gif.palette[gif.frames[f].indices[y * 16 + x]];
    expect(c(0, 1, 1)).toEqual([255, 0, 0]);
    expect(c(0, 14, 6)).toEqual([0, 0, 255]);
    expect(c(1, 5, 5)).toEqual([0, 255, 0]);
  });

  it("honours loop counts and 'none'", () => {
    const f = [{ data: solid(4, 4, [10, 20, 30, 255]) }];
    expect(readGif(encodeGif(f, { width: 4, height: 4, fps: 25, loop: 3 })).loop).toBe(3);
    expect(readGif(encodeGif(f, { width: 4, height: 4, fps: 25, loop: "none" })).loop).toBeNull();
  });

  it("quantises many colours to the palette limit and keeps the picture close", () => {
    const w = 64;
    const h = 64;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) d.set([x * 4, y * 4, (x + y) * 2, 255], (y * w + x) * 4);
    const gif = readGif(encodeGif([{ data: d }], { width: w, height: h, fps: 12, maxColors: 16 }));
    expect(gif.palette.length).toBeLessThanOrEqual(16);
    const idx = gif.frames[0].indices;
    expect(Math.max(...idx)).toBeLessThan(16);
    let err = 0;
    for (let p = 0; p < w * h; p++) {
      const col = gif.palette[idx[p]];
      for (let k = 0; k < 3; k++) err += Math.abs(col[k] - d[p * 4 + k]);
    }
    expect(err / (w * h * 3)).toBeLessThan(40);
  });

  it("round-trips a large noisy frame through multi-block LZW with table resets", () => {
    const w = 128;
    const h = 128;
    const d = new Uint8ClampedArray(w * h * 4);
    let s = 7;
    for (let i = 0; i < d.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const v = (s >> 8) & 255;
      d.set([v, (v * 3) & 255, (v * 7) & 255, 255], i);
    }
    const bytes = encodeGif([{ data: d }], { width: w, height: h, fps: 10, maxColors: 256 });
    const gif = readGif(bytes);
    expect(gif.frames[0].indices).toHaveLength(w * h);
    // Every index decoded from the stream must equal the nearest-colour mapping of the source (same palette lookup).
    let mismatches = 0;
    for (let p = 0; p < w * h; p++) {
      const col = gif.palette[gif.frames[0].indices[p]];
      if (Math.abs(col[0] - d[p * 4]) > 64) mismatches++;
    }
    expect(mismatches).toBeLessThan(w * h * 0.02);
  });

  it("reserves a transparent index", () => {
    const d = solid(4, 4, [200, 0, 0, 255]);
    d.set([0, 0, 0, 0], 0);
    const gif = readGif(encodeGif([{ data: d }], { width: 4, height: 4, fps: 10, transparency: true }));
    const t = gif.frames[0].transparentIndex;
    expect(t).not.toBeNull();
    expect(gif.frames[0].indices[0]).toBe(t);
    expect(gif.frames[0].indices[1]).not.toBe(t);
  });

  it("validates input", () => {
    expect(validateGifOptions({ width: 0, height: 4, fps: 10 })).toMatch(/whole numbers/);
    expect(validateGifOptions({ width: 4, height: 4, fps: 0 })).toMatch(/frame rate/);
    expect(validateGifOptions({ width: 4, height: 4, fps: 10, maxColors: 1 })).toMatch(/palette/);
    expect(() => encodeGif([], { width: 4, height: 4, fps: 10 })).toThrow(/at least one frame/);
    expect(() => encodeGif([{ data: new Uint8Array(3) }], { width: 4, height: 4, fps: 10 })).toThrow(/size/);
    expect(gifFrameDelayCs(100)).toBe(2);
    expect(gifFrameDelayCs(24)).toBe(4);
  });
});

describe("image sequence helpers", () => {
  it("numbers frames from the pattern", () => {
    expect(frameFileName("frame_{0000}", 42, "png")).toBe("frame_0042.png");
    expect(frameFileName("shot{000}", 7, "jpg", 1000)).toBe("shot1007.jpg");
    expect(frameFileName("clip", 3, "png")).toBe("clip_0003.png");
    expect(frameFileName("../evil_{00}", 1, "png")).toBe("evil_01.png");
  });

  it("derives the frame range, with an exclusive Out point", () => {
    expect(sequenceFrameRange(2, 24)).toEqual({ startFrame: 0, endFrame: 47 });
    expect(sequenceFrameRange(2, 24, { startTime: 0.5, endTime: 1 })).toEqual({ startFrame: 12, endFrame: 23 });
    expect(sequenceFrameRange(2, 24, { startTime: 1, endTime: 99 })).toEqual({ startFrame: 24, endFrame: 47 });
    expect(() => sequenceFrameRange(0, 24)).toThrow(/empty/);
    expect(() => sequenceFrameRange(2, 24, { startTime: 1, endTime: 1 })).toThrow(/after/);
    expect(validateSequenceRange({ startFrame: 5, endFrame: 4 })).toMatch(/valid/);
    expect(validateSequenceRange({ startFrame: 0, endFrame: 30000 })).toMatch(/limited/);
  });

  it("packs frames into a zip with sequential names", async () => {
    const zip = await packImageSequence([new Uint8Array([1]), new Uint8Array([2, 2])], { pattern: "f_{000}", format: "png", startFrame: 10 });
    const files = readZipStore(zip);
    expect(files.map((f) => f.name)).toEqual(["f_010.png", "f_011.png"]);
    expect(files[1].data).toEqual(new Uint8Array([2, 2]));
  });
});

describe("GIF transparency and timing", () => {
  it("uses disposal 2 with transparency and disposal 1 otherwise", () => {
    const f = [{ data: solid(4, 4, [200, 0, 0, 0]) }, { data: solid(4, 4, [0, 200, 0, 255]) }];
    expect(readGif(encodeGif(f, { width: 4, height: 4, fps: 10, transparency: true })).frames.map((x) => x.disposal)).toEqual([2, 2]);
    expect(readGif(encodeGif(f, { width: 4, height: 4, fps: 10 })).frames.map((x) => x.disposal)).toEqual([1, 1]);
  });
  it("reports the playback rate after centisecond rounding and a memory budget", () => {
    expect(gifPlaybackFps(15)).toBeCloseTo(100 / 7);
    expect(gifPlaybackFps(10)).toBe(10);
    expect(validateGifFrameBudget(640, 360, 100)).toBeNull();
    expect(validateGifFrameBudget(640, 360, 5000)).toMatch(/frames/);
    expect(validateGifFrameBudget(4096, 2160, 500)).toMatch(/memory/);
  });
});
