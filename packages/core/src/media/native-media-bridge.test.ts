import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  nativeMediaAvailable,
  proxyViaNative,
  transcodeViaNative,
  extractAudioWavViaNative,
  probeAudioStreamCountViaNative,
  NoAudioStreamError,
} from "./native-media-bridge";

/* eslint-disable @typescript-eslint/no-explicit-any */
const disk = new Map<string, Uint8Array>();
const writers = new Map<string, { path: string; chunks: { data: Uint8Array; pos: number }[] }>();
let counter = 0;

function installBridge(): void {
  counter = 0;
  const bridge: any = {
    platform: "desktop",
    fs: {
      tempFilePath: vi.fn(async (ext: string) => `/tmp/mat-${++counter}.${ext}`),
      openWrite: vi.fn(async (path: string) => {
        const id = `w${++counter}`;
        writers.set(id, { path, chunks: [] });
        return id;
      }),
      writeChunk: vi.fn(async (id: string, data: ArrayBuffer, pos: number) => {
        writers.get(id)!.chunks.push({ data: new Uint8Array(data), pos });
      }),
      closeWrite: vi.fn(async (id: string) => {
        const w = writers.get(id)!;
        const total = w.chunks.reduce((m, c) => Math.max(m, c.pos + c.data.byteLength), 0);
        const out = new Uint8Array(total);
        for (const c of w.chunks) out.set(c.data, c.pos);
        disk.set(w.path, out);
      }),
      releaseTemp: vi.fn(async () => true),
      readFileBytes: vi.fn(async (path: string) => {
        const b = disk.get(path) ?? new Uint8Array();
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      }),
    },
    media: {
      generateProxy: vi.fn(async () => {
        disk.set("/tmp/proxy.mp4", new Uint8Array([1, 2, 3]));
        return { outPath: "/tmp/proxy.mp4" };
      }),
      transcode: vi.fn(async () => {
        disk.set("/tmp/tc.webm", new Uint8Array([4, 5]));
        return { outPath: "/tmp/tc.webm" };
      }),
      extractAudioWav: vi.fn(async () => {
        disk.set("/tmp/a.wav", new Uint8Array([9]));
        return { outPath: "/tmp/a.wav" };
      }),
      probeAudioStreams: vi.fn(async () => ({
        streams: [{ index: 1, codec: "aac", channels: 2, sampleRate: 48000 }],
      })),
    },
  };
  (globalThis as any).openreel = bridge;
}

function bridgeMock(): any {
  return (globalThis as any).openreel;
}

beforeEach(() => {
  disk.clear();
  writers.clear();
  installBridge();
});
afterEach(() => {
  delete (globalThis as any).openreel;
});

describe("native-media-bridge", () => {
  it("nativeMediaAvailable is true only when a desktop bridge is present", () => {
    expect(nativeMediaAvailable()).toBe(true);
    delete (globalThis as any).openreel;
    expect(nativeMediaAvailable()).toBe(false);
  });

  it("proxyViaNative materializes the source, calls generateProxy with the temp path, returns a Blob", async () => {
    const src = new File([new Uint8Array([7, 7, 7, 7])], "in.mp4", { type: "video/mp4" });
    const blob = await proxyViaNative(src, "low");
    const o = bridgeMock();
    expect(o.fs.openWrite).toHaveBeenCalled();
    expect(o.media.generateProxy).toHaveBeenCalledWith(
      expect.objectContaining({ preset: "low", srcPath: expect.stringContaining("/tmp/mat-") }),
    );
    const matPath = o.media.generateProxy.mock.calls[0][0].srcPath as string;
    expect(Array.from(disk.get(matPath)!)).toEqual([7, 7, 7, 7]); // materialized bytes == source
    expect(blob.type).toBe("video/mp4");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("transcodeViaNative returns a Blob with the container mime", async () => {
    const blob = await transcodeViaNative(new File([new Uint8Array([1, 2])], "in.mp4"), {
      container: "webm",
      videoBitrateKbps: 2000,
      audioBitrateKbps: 128,
    });
    expect(bridgeMock().media.transcode).toHaveBeenCalledWith(
      expect.objectContaining({ container: "webm", videoBitrateKbps: 2000 }),
    );
    expect(blob.type).toBe("video/webm");
  });

  it("extractAudioWavViaNative returns a wav Blob", async () => {
    const blob = await extractAudioWavViaNative(new File([new Uint8Array([1])], "in.mp4"));
    expect(blob.type).toBe("audio/wav");
  });

  it("extractAudioWavViaNative throws NoAudioStreamError when the source has no audio (no failing ffmpeg spawn)", async () => {
    bridgeMock().media.probeAudioStreams = vi.fn(async () => ({ streams: [] }));
    await expect(
      extractAudioWavViaNative(new File([new Uint8Array([1])], "silent.mp4")),
    ).rejects.toBeInstanceOf(NoAudioStreamError);
    expect(bridgeMock().media.extractAudioWav).not.toHaveBeenCalled();
  });

  it("extractAudioWavViaNative throws NoAudioStreamError when the requested stream index is out of range", async () => {
    await expect(
      extractAudioWavViaNative(new File([new Uint8Array([1])], "in.mp4"), 3),
    ).rejects.toBeInstanceOf(NoAudioStreamError);
    expect(bridgeMock().media.extractAudioWav).not.toHaveBeenCalled();
  });

  it("probeAudioStreamCountViaNative returns the stream count", async () => {
    expect(await probeAudioStreamCountViaNative(new File([new Uint8Array([1])], "in.mp4"))).toBe(1);
  });

  it("materializes a blob once across probe and extract", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "video/mp4" });
    await probeAudioStreamCountViaNative(blob);
    await extractAudioWavViaNative(blob);
    expect(bridgeMock().fs.tempFilePath).toHaveBeenCalledTimes(1);
    const other = new Blob([new Uint8Array([5])], { type: "video/mp4" });
    await probeAudioStreamCountViaNative(other);
    expect(bridgeMock().fs.tempFilePath).toHaveBeenCalledTimes(2);
  });

  it("retries materialization after a failed write", async () => {
    const blob = new Blob([new Uint8Array([1])], { type: "video/mp4" });
    bridgeMock().fs.openWrite.mockRejectedValueOnce(new Error("disk full"));
    await expect(probeAudioStreamCountViaNative(blob)).rejects.toThrow("disk full");
    await expect(probeAudioStreamCountViaNative(blob)).resolves.toBe(1);
  });

  it("releases the oldest input copy once more than three are cached", async () => {
    const blobs = Array.from({ length: 5 }, (_, i) => new Blob([new Uint8Array([i])], { type: "video/mp4" }));
    for (const b of blobs) await probeAudioStreamCountViaNative(b);
    const o = bridgeMock();
    expect(o.fs.tempFilePath).toHaveBeenCalledTimes(5);
    // Copies cached by earlier tests may also be evicted, so check this test's own paths.
    const created = (await Promise.all(o.fs.tempFilePath.mock.results.map((r: { value: Promise<string> }) => r.value))) as string[];
    const released: string[] = o.fs.releaseTemp.mock.calls.map((c: string[]) => c[0]);
    expect(released).toEqual(expect.arrayContaining(created.slice(0, 2)));
    for (const kept of created.slice(2)) expect(released).not.toContain(kept);
    // The newest three stay cached and are reused.
    await probeAudioStreamCountViaNative(blobs[4]);
    expect(o.fs.tempFilePath).toHaveBeenCalledTimes(5);
  });

  it("does not release an evicted input copy while a job is still using it", async () => {
    const o = bridgeMock();
    let finish!: () => void;
    o.media.generateProxy = vi.fn(async () => {
      await new Promise<void>((r) => (finish = r));
      disk.set("/tmp/proxy.mp4", new Uint8Array([1]));
      return { outPath: "/tmp/proxy.mp4" };
    });
    const first = new Blob([new Uint8Array([1])], { type: "video/mp4" });
    const running = proxyViaNative(first, "low");
    await vi.waitFor(() => expect(o.media.generateProxy).toHaveBeenCalled());
    for (let i = 0; i < 3; i++) await probeAudioStreamCountViaNative(new Blob([new Uint8Array([i])], { type: "video/mp4" }));
    const firstPath = o.media.generateProxy.mock.calls[0][0].srcPath as string;
    expect(o.fs.releaseTemp).not.toHaveBeenCalledWith(firstPath);
    finish();
    await running;
    await vi.waitFor(() => expect(o.fs.releaseTemp).toHaveBeenCalledWith(firstPath));
  });
});
