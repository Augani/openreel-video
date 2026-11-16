// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportEngine } from "./export-engine";
import { readGif } from "./gif-encoder";
import { readZipStore } from "./zip";
import type { ExportProgress, ExportResult } from "./types";
import type { Project } from "../types/project";

const renderTimes: number[] = [];
const renderFrame = vi.fn(async (_project: unknown, time: number) => {
  renderTimes.push(time);
  return { image: { close: vi.fn(), tag: time }, width: 8, height: 4 };
});

class FakeCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    const w = this.width;
    const h = this.height;
    return {
      drawImage: vi.fn(),
      getImageData: () => {
        const data = new Uint8ClampedArray(w * h * 4);
        const shade = (renderTimes.length * 40) & 255;
        for (let i = 0; i < data.length; i += 4) data.set([shade, 100, 200, 255], i);
        return { data };
      },
    };
  }
  async convertToBlob(opts: { type: string }) {
    const bytes = new TextEncoder().encode(`${opts.type}#${renderTimes.length}`);
    return { size: bytes.byteLength, type: opts.type, arrayBuffer: async () => bytes.buffer.slice(0) };
  }
}

/** jsdom's Blob has no arrayBuffer(); read it with FileReader. */
const bytesOf = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

const project = (duration: number, frameRate = 10): Project =>
  ({
    id: "p",
    name: "P",
    settings: { width: 8, height: 4, frameRate, sampleRate: 48000, channels: 2 },
    timeline: { duration, tracks: [], subtitles: [], markers: [] },
    mediaLibrary: { items: [] },
  }) as unknown as Project;

async function drain(gen: AsyncGenerator<ExportProgress, ExportResult>): Promise<{ result: ExportResult; phases: string[] }> {
  const phases: string[] = [];
  for (;;) {
    const next = await gen.next();
    if (next.done) return { result: next.value, phases };
    phases.push(next.value.phase);
  }
}

async function makeEngine(): Promise<ExportEngine> {
  const video = {
    isInitialized: () => true,
    initialize: async () => undefined,
    renderFrame,
  };
  const audio = { isInitialized: () => true, initialize: async () => undefined };
  const engine = new ExportEngine({
    videoEngine: video as unknown as import("../video/video-engine").VideoEngine,
    audioEngine: audio as unknown as import("../audio/audio-engine").AudioEngine,
  });
  await engine.initialize();
  return engine;
}

beforeEach(() => {
  renderTimes.length = 0;
  renderFrame.mockClear();
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExportEngine image sequence", () => {
  it("renders every frame of the range and zips them with pattern numbering", async () => {
    const engine = await makeEngine();
    const { result, phases } = await drain(
      engine.exportImageSequenceZip(project(1), { format: "jpg", range: { startTime: 0.3, endTime: 0.6 }, pattern: "shot_{000}", startNumber: 100 }),
    );
    expect(result.success, JSON.stringify(result.error)).toBe(true);
    expect(phases).toContain("complete");
    expect(renderTimes).toEqual([0.3, 0.4, 0.5]);
    const files = readZipStore(await bytesOf(result.blob!));
    expect(files.map((f) => f.name)).toEqual(["shot_103.jpg", "shot_104.jpg", "shot_105.jpg"]);
    expect(new TextDecoder().decode(files[0].data)).toMatch(/^image\/jpeg#/);
  });

  it("the legacy exportImageSequence returns the whole zip, not the first frame", async () => {
    const engine = await makeEngine();
    const { result } = await drain(engine.exportImageSequence(project(1), { format: "png", startFrame: 2, endFrame: 4, namingPattern: "f_{00}" }));
    expect(result.success).toBe(true);
    const files = readZipStore(await bytesOf(result.blob!));
    expect(files.map((f) => f.name)).toEqual(["f_02.png", "f_03.png", "f_04.png"]);
  });

  it("refuses an empty range and an over-long sequence", async () => {
    const engine = await makeEngine();
    const bad = await drain(engine.exportImageSequenceZip(project(1), { range: { startTime: 0.5, endTime: 0.5 } }));
    expect(bad.result.success).toBe(false);
    const long = await drain(engine.exportImageSequenceZip(project(1000, 24)));
    expect(long.result.success).toBe(false);
    expect(long.result.error?.message).toMatch(/limited/);
    expect(renderFrame).not.toHaveBeenCalled();
  });

  it("stops when cancelled", async () => {
    const engine = await makeEngine();
    const gen = engine.exportImageSequenceZip(project(2));
    await gen.next();
    engine.cancel();
    let last = await gen.next();
    while (!last.done) last = await gen.next();
    expect(last.value.success).toBe(false);
    expect(last.value.error?.code).toBe("CANCELLED");
  });
});

describe("ExportEngine GIF", () => {
  it("samples frames at the delay-rounded playback rate over the range and loops forever", async () => {
    const engine = await makeEngine();
    // 15 fps rounds to a 7 cs delay (14.29 fps): frames are sampled at 100/7 so playback duration stays true.
    const { result } = await drain(engine.exportGif(project(2, 30), { fps: 15, range: { startTime: 0, endTime: 1 }, maxColors: 16 }));
    expect(result.success, JSON.stringify(result.error)).toBe(true);
    expect(renderTimes).toHaveLength(14);
    expect(renderTimes[1]).toBeCloseTo(0.07);
    const gif = readGif(await bytesOf(result.blob!));
    expect(gif.frames).toHaveLength(14);
    expect(gif.frames[0].delayCs).toBe(7);
    expect(gif.loop).toBe(0);
    expect(gif.width).toBe(8);
  });

  it("honours loop count and palette size", async () => {
    const engine = await makeEngine();
    const { result } = await drain(engine.exportGif(project(1), { fps: 10, loop: 2, maxColors: 4, range: { startTime: 0, endTime: 0.3 } }));
    const gif = readGif(await bytesOf(result.blob!));
    expect(gif.loop).toBe(2);
    expect(gif.palette.length).toBeLessThanOrEqual(4);
    expect(gif.frames).toHaveLength(3);
  });

  it("rejects a GIF that would not fit in memory", async () => {
    const engine = await makeEngine();
    const { result } = await drain(engine.exportGif(project(600, 30), { fps: 10, width: 4096, height: 2160 }));
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/memory|frames/);
  });
});
