import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SmartAudioPlan, SmartRenderPlan } from "@openreel/core";
import { NativeFFmpegBackend, audioSourceInfoFromProbe } from "./native-ffmpeg-backend";
import { NativeSourceFiles, diskPathOf } from "./native-source-staging";

// jsdom's Blob has no arrayBuffer(); Chromium (the real renderer) does.
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

type Probe = { codec: string; pixelFormat: string; color: { range?: string; matrix?: string; primaries?: string; transfer?: string } } | null;

const plan = (over: Partial<SmartRenderPlan> = {}): SmartRenderPlan => ({
  eligible: true,
  encodeMatch: { codec: "avc", profile: 100, level: 40, frameRate: 30, color: { matrix: null } },
  segments: [
    { kind: "copy", startFrame: 0, endFrame: 120, mediaId: "m1", sourceStart: 0, sourceEnd: 4 },
    { kind: "encode", startFrame: 120, endFrame: 150 },
    { kind: "copy", startFrame: 150, endFrame: 300, mediaId: "m2", sourceStart: 1, sourceEnd: 6 },
  ],
  totalFrames: 300,
  copiedFrames: 270,
  reencodedFrames: 30,
  copiedPercent: 90,
  reasons: [],
  ...over,
});

const h264 = (color: NonNullable<Probe>["color"] = { range: "tv", matrix: "bt709" }, pixelFormat = "yuv420p"): Probe => ({
  codec: "h264",
  pixelFormat,
  color,
});

interface Bridge {
  probes: Record<string, Probe>;
  copyRun: ReturnType<typeof vi.fn>;
  written: Array<{ path: string; bytes: number }>;
  released: string[];
}

function installBridge(files: Record<string, string | null>): Bridge {
  const bridge: Bridge = { probes: {}, copyRun: vi.fn(), written: [], released: [] };
  const open = new Map<string, string>();
  (window as unknown as { openreel: unknown }).openreel = {
    platform: "desktop",
    fs: {
      tempFilePath: async () => "/tmp/staged-1.bin",
      openWrite: async (path: string) => {
        open.set("h1", path);
        bridge.written.push({ path, bytes: 0 });
        return "h1";
      },
      writeChunk: async (_h: string, data: ArrayBuffer) => {
        bridge.written[bridge.written.length - 1].bytes += data.byteLength;
      },
      closeWrite: async () => undefined,
      abortWrite: async () => undefined,
      releaseTemp: async (path: string) => {
        bridge.released.push(path);
        return true;
      },
    },
    export: {
      pathForFile: (file: File & { __path?: string }) => files[file.name] ?? "",
      probeSource: async (path: string) => bridge.probes[path] ?? null,
      copyRun: bridge.copyRun,
    },
  };
  return bridge;
}

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

describe("native smart render: source files", () => {
  let bridge: Bridge;
  beforeEach(() => {
    bridge = installBridge({ "a.mp4": "/Volumes/media/a.mp4", "memory.mp4": null });
  });
  afterEach(() => {
    delete (window as unknown as { openreel?: unknown }).openreel;
  });

  it("uses a picked file where it lives on disk, without copying", async () => {
    const files = new NativeSourceFiles();
    const resolved = await files.resolve(file("a.mp4"));
    expect(resolved).toMatchObject({ path: "/Volumes/media/a.mp4", copied: false });
    expect(bridge.written).toEqual([]);
    expect(diskPathOf(window.openreel!, file("a.mp4"))).toBe("/Volumes/media/a.mp4");
  });

  it("copies an in-memory blob into an app temp file and deletes it on release", async () => {
    const files = new NativeSourceFiles();
    const resolved = await files.resolve(file("memory.mp4", 40));
    expect(resolved).toMatchObject({ path: "/tmp/staged-1.bin", copied: true });
    expect(bridge.written).toEqual([{ path: "/tmp/staged-1.bin", bytes: 40 }]);
    await files.release();
    expect(bridge.released).toEqual(["/tmp/staged-1.bin"]);
  });

  it("copies when asked to even though the file is on disk (it changed since import)", async () => {
    const files = new NativeSourceFiles();
    const blob = file("a.mp4", 7);
    expect((await files.resolve(blob)).copied).toBe(false);
    expect((await files.resolve(blob, true)).copied).toBe(true);
  });
});

describe("native smart render: preparing the plan", () => {
  let bridge: Bridge;
  const blobs: Record<string, Blob> = { m1: file("a.mp4"), m2: file("b.mp4") };
  const blobFor = (id: string) => blobs[id];
  const prepare = (p: SmartRenderPlan = plan()) => new NativeFFmpegBackend(() => "/out.mp4").smartRender.prepare!(p, blobFor);

  beforeEach(() => {
    bridge = installBridge({ "a.mp4": "/m/a.mp4", "b.mp4": "/m/b.mp4" });
  });
  afterEach(() => {
    delete (window as unknown as { openreel?: unknown }).openreel;
  });

  it("tags the re-encoded runs with the colour ffmpeg decodes from the files it copies", async () => {
    bridge.probes["/m/a.mp4"] = h264({ range: "tv", matrix: "smpte170m", primaries: "smpte170m", transfer: "smpte170m" });
    bridge.probes["/m/b.mp4"] = h264({ range: "tv", matrix: "smpte170m", primaries: "smpte170m", transfer: "smpte170m" });
    const result = await prepare();
    expect("plan" in result && result.plan.encodeMatch?.color).toEqual({ matrix: "smpte170m", transfer: "smpte170m", primaries: "smpte170m" });
  });

  it("declines, with the reason, a source the encoder cannot reproduce", async () => {
    bridge.probes["/m/a.mp4"] = h264({ range: "tv", matrix: "bt709" }, "yuv420p10le");
    bridge.probes["/m/b.mp4"] = h264();
    expect(await prepare()).toEqual({ decline: "source pixel format yuv420p10le (10-bit 4:2:0); smart render copies 8-bit 4:2:0 SDR sources only" });
    bridge.probes["/m/a.mp4"] = h264({ range: "pc" });
    expect(await prepare()).toEqual({ decline: "source is full-range" });
  });

  it("prepares a ProRes plan from ProRes 4:2:2 files and declines 4:4:4 or HDR ones", async () => {
    const proresPlan = plan({ encodeMatch: { codec: "prores", proresProfile: "hq", allIntra: true, frameRate: 30 } });
    const prores = (pixelFormat: string, color: NonNullable<Probe>["color"] = { range: "tv", matrix: "bt709" }): Probe => ({ codec: "prores", pixelFormat, color });
    bridge.probes["/m/a.mp4"] = prores("yuv422p10le");
    bridge.probes["/m/b.mp4"] = prores("yuv422p10le");
    const ok = await prepare(proresPlan);
    expect("plan" in ok && ok.plan.encodeMatch).toMatchObject({ codec: "prores", proresProfile: "hq", color: { matrix: "bt709" } });
    bridge.probes["/m/a.mp4"] = prores("yuv444p12le");
    expect(await prepare(proresPlan)).toEqual({ decline: expect.stringMatching(/not ProRes 4:2:2 10-bit/) });
    bridge.probes["/m/a.mp4"] = prores("yuv422p10le", { range: "tv", transfer: "smpte2084" });
    expect(await prepare(proresPlan)).toEqual({ decline: expect.stringMatching(/HDR \(PQ\)/) });
  });

  it("declines when two copied sources carry different colour tags", async () => {
    bridge.probes["/m/a.mp4"] = h264({ range: "tv", matrix: "bt709" });
    bridge.probes["/m/b.mp4"] = h264({ range: "tv", matrix: "smpte170m" });
    expect(await prepare()).toEqual({ decline: "sources carry different colour tags" });
  });

  it("declines when ffmpeg cannot read a file or a source is gone", async () => {
    bridge.probes["/m/a.mp4"] = h264();
    expect(await prepare()).toEqual({ decline: "ffmpeg could not read a source file" });
    const missing = new NativeFFmpegBackend(() => "/out.mp4").smartRender.prepare!(plan(), () => undefined);
    expect(await missing).toEqual({ decline: "a source file is no longer available" });
  });
});

describe("native smart render: copy runs", () => {
  let bridge: Bridge;
  beforeEach(() => {
    bridge = installBridge({ "a.mp4": "/m/a.mp4" });
  });
  afterEach(() => {
    delete (window as unknown as { openreel?: unknown }).openreel;
  });

  it("falls back to a temp copy of the blob when the file on disk changed after import", async () => {
    const backend = new NativeFFmpegBackend(() => "/out.mp4");
    Object.assign(backend as unknown as Record<string, unknown>, { jobId: "job-1", frameRate: 30 });
    bridge.copyRun
      .mockRejectedValueOnce(new Error("Error invoking remote method: SOURCE_CHANGED: /m/a.mp4 is 5 bytes, the project has 10"))
      .mockResolvedValueOnce({ frames: 120 });
    const frames = await backend.smartRender.copyRun(file("a.mp4"), 2, 6, 4);
    expect(frames).toBe(120);
    const hash = expect.stringMatching(/^[0-9a-f]{64}$/);
    // In place: the guard also gets the file's modification time and the full-content hash of the imported Blob.
    expect(bridge.copyRun).toHaveBeenNthCalledWith(1, "job-1", {
      sourcePath: "/m/a.mp4", sourceStart: 2, outputStartFrame: 120, frames: 120, sourceSize: 10, sourceContentHash: hash, sourceMtimeMs: expect.any(Number),
    });
    // A temp copy of the Blob has its own modification time, so only size and hash are sent.
    expect(bridge.copyRun).toHaveBeenNthCalledWith(2, "job-1", {
      sourcePath: "/tmp/staged-1.bin", sourceStart: 2, outputStartFrame: 120, frames: 120, sourceSize: 10, sourceContentHash: hash,
    });
  });

  it("does not hide other failures", async () => {
    const backend = new NativeFFmpegBackend(() => "/out.mp4");
    Object.assign(backend as unknown as Record<string, unknown>, { jobId: "job-1", frameRate: 30 });
    bridge.copyRun.mockRejectedValueOnce(new Error("ffmpeg exited with code 1"));
    await expect(backend.smartRender.copyRun(file("a.mp4"), 0, 4, 0)).rejects.toThrow(/code 1/);
  });
});

describe("native smart render: audio copy", () => {
  const aacProbe = { codec: "aac", profile: "LC", sampleRate: 48000, channels: 2, bitrateKbps: 128, firstPts: -1024, frameSamples: 1024, packets: 376, endSamples: 384000 };
  const audioPlan = (over: Partial<SmartAudioPlan> = {}): SmartAudioPlan => ({
    eligible: true,
    codec: "aac",
    sampleRate: 48000,
    channels: 2,
    totalSamples: 384000,
    segments: [{ kind: "copy", start: 0, end: 384000, mediaId: "m1", sourceStart: 0, priming: 1024 }],
    copiedSamples: 384000,
    encodedSamples: 0,
    copiedSeconds: 8,
    encodedSeconds: 0,
    mode: "whole",
    reasons: [],
    ...over,
  });
  let prepareAudioCopy: ReturnType<typeof vi.fn>;
  let writeAudioChunk: ReturnType<typeof vi.fn>;
  let finishAudio: ReturnType<typeof vi.fn>;
  let probeAudioSource: ReturnType<typeof vi.fn>;
  const backendWithJob = () => {
    const backend = new NativeFFmpegBackend(() => "/out.mp4");
    Object.assign(backend as unknown as Record<string, unknown>, { jobId: "job-1", frameRate: 30 });
    return backend;
  };

  beforeEach(() => {
    installBridge({ "a.mp4": "/m/a.mp4" });
    prepareAudioCopy = vi.fn().mockResolvedValue({});
    writeAudioChunk = vi.fn().mockResolvedValue(undefined);
    finishAudio = vi.fn().mockResolvedValue(undefined);
    probeAudioSource = vi.fn().mockResolvedValue(aacProbe);
    Object.assign((window as unknown as { openreel: { export: object } }).openreel.export, { prepareAudioCopy, writeAudioChunk, finishAudio, probeAudioSource });
  });
  afterEach(() => {
    delete (window as unknown as { openreel?: unknown }).openreel;
  });

  it("describes a source's audio for the planner: AAC-LC with its encoder delay, or 16/24-bit PCM from time zero", () => {
    expect(audioSourceInfoFromProbe("m1", aacProbe)).toEqual({
      mediaId: "m1", codec: "aac", sampleRate: 48000, channels: 2, sampleCount: 384000, bitrateKbps: 128, startsAtZero: true, priming: 1024, frameSamples: 1024, packets: 376,
    });
    const pcm = { ...aacProbe, codec: "pcm_s24le", profile: undefined, firstPts: 0, frameSamples: 1024 };
    expect(audioSourceInfoFromProbe("m1", pcm)).toMatchObject({ codec: "pcm", startsAtZero: true });
    expect(audioSourceInfoFromProbe("m1", { ...pcm, firstPts: 480 })).toMatchObject({ codec: "pcm", startsAtZero: false });
    expect(audioSourceInfoFromProbe("m1", { ...aacProbe, profile: "HE-AAC" })).toBeNull();
    expect(audioSourceInfoFromProbe("m1", { ...aacProbe, frameSamples: 0 })).toBeNull();
    expect(audioSourceInfoFromProbe("m1", { ...pcm, codec: "pcm_f32le" })).toBeNull();
    expect(audioSourceInfoFromProbe("m1", { ...aacProbe, codec: "mp3" })).toBeNull();
    expect(audioSourceInfoFromProbe("m1", null)).toBeNull();
  });

  it("probes through the bridge using the file on disk", async () => {
    const info = await backendWithJob().smartRender.audio!.probe("m1", file("a.mp4"));
    expect(probeAudioSource).toHaveBeenCalledWith("/m/a.mp4");
    expect(info).toMatchObject({ codec: "aac", priming: 1024 });
  });

  it("sends the plan with the source's path and fingerprint and accepts what the main process accepts", async () => {
    const backend = backendWithJob();
    expect(await backend.smartRender.audio!.begin(audioPlan(), () => file("a.mp4"))).toBeNull();
    expect(prepareAudioCopy).toHaveBeenCalledWith("job-1", {
      codec: "aac",
      sampleRate: 48000,
      channels: 2,
      totalSamples: 384000,
      segments: [
        { kind: "copy", start: 0, end: 384000, sourcePath: "/m/a.mp4", sourceStart: 0, priming: 1024, sourceSize: 10, sourceContentHash: expect.stringMatching(/^[0-9a-f]{64}$/), sourceMtimeMs: expect.any(Number) },
      ],
    });
  });

  it("returns the main process's reason when it declines the copy, and writes the rendered audio as usual", async () => {
    prepareAudioCopy.mockResolvedValue({ declined: "the AAC stream's decoder carries state" });
    const backend = backendWithJob();
    expect(await backend.smartRender.audio!.begin(audioPlan(), () => file("a.mp4"))).toBe("the AAC stream's decoder carries state");
    await backend.closeAudio();
    expect(finishAudio).toHaveBeenCalledWith("job-1");
    // silence was written as the (declined) copy left the mixdown to render
    expect(writeAudioChunk).toHaveBeenCalled();
  });

  it("retries once with a temp copy of the blob when the file on disk changed", async () => {
    prepareAudioCopy.mockRejectedValueOnce(new Error("SOURCE_CHANGED: /m/a.mp4: size changed")).mockResolvedValueOnce({});
    expect(await backendWithJob().smartRender.audio!.begin(audioPlan(), () => file("a.mp4"))).toBeNull();
    expect(prepareAudioCopy).toHaveBeenCalledTimes(2);
    expect(prepareAudioCopy.mock.calls[1][1].segments[0]).toMatchObject({ sourcePath: "/tmp/staged-1.bin" });
    expect(prepareAudioCopy.mock.calls[1][1].segments[0]).not.toHaveProperty("sourceMtimeMs");
  });

  it("writes no mixdown at all when every sample is copied", async () => {
    const backend = backendWithJob();
    await backend.smartRender.audio!.begin(audioPlan(), () => file("a.mp4"));
    await backend.smartRender.audio!.skip(384000);
    await backend.closeAudio();
    expect(writeAudioChunk).not.toHaveBeenCalled();
  });

  it("keeps later chunks at their positions in the WAV when a copied chunk is not mixed", async () => {
    const backend = backendWithJob();
    const plan = audioPlan({
      codec: "pcm",
      segments: [
        { kind: "copy", start: 0, end: 720000, mediaId: "m1", sourceStart: 0 },
        { kind: "encode", start: 720000, end: 744000 },
      ],
      totalSamples: 744000,
    });
    expect(await backend.smartRender.audio!.begin(plan, () => file("a.mp4"))).toBeNull();
    await backend.smartRender.audio!.skip(720000);
    const state = backend as unknown as { audioDataOffset: number; audioFramesWritten: number };
    // 44-byte header, then 720000 stereo 16-bit frames left unwritten
    expect(state.audioDataOffset).toBe(44 + 720000 * 4);
    expect(state.audioFramesWritten).toBe(720000);
  });
});
