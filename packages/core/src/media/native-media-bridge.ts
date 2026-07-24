// Renderer-side bridge to the desktop native FFmpeg sidecar (window.openreel.media).
// packages/core cannot see apps/web's ambient window.openreel type, so we declare the
// minimal slice this module uses and access it via a typed cast on globalThis.

export interface NativeMediaBridge {
  platform?: string;
  fs: {
    tempFilePath(ext: string): Promise<string>;
    openWrite(path: string): Promise<string>;
    writeChunk(handleId: string, data: ArrayBuffer, position: number): Promise<void>;
    closeWrite(handleId: string): Promise<void>;
    readFileBytes(path: string): Promise<ArrayBuffer>;
  };
  gpu?: {
    uploadMedia(args: { srcPath: string; filename: string; contentType?: string }): Promise<{ mediaKey: string }>;
    submitJob(args: { kind: string; params: Record<string, unknown>; mediaKey?: string; mediaFilename?: string }): Promise<{ jobID: string; status: string; manifestURL?: string }>;
    jobStatus(jobID: string): Promise<{ jobID: string; status: string; progress?: number; message?: string; manifestURL?: string; error?: string; queuePosition?: number; pendingAhead?: number }>;
    fetchManifest(jobID: string): Promise<Record<string, unknown>>;
    downloadArtifact(jobID: string, relativePath: string): Promise<{ tempPath: string; mime: string }>;
    cancelJob(jobID: string): Promise<{ jobID: string; status: string }>;
  };
  media: {
    generateProxy(args: { srcPath: string; preset: "low" | "medium" | "high" }): Promise<{ outPath: string }>;
    transcode(args: {
      srcPath: string;
      container?: "mp4" | "webm" | "mov";
      videoBitrateKbps?: number;
      audioBitrateKbps?: number;
    }): Promise<{ outPath: string }>;
    extractAudioWav(args: { srcPath: string; streamIndex?: number }): Promise<{ outPath: string }>;
    probeAudioStreams(args: { srcPath: string }): Promise<{
      streams: { index: number; codec: string; channels: number; sampleRate: number; language?: string }[];
    }>;
  };
}

export function getBridge(): NativeMediaBridge | undefined {
  const w = globalThis as unknown as { openreel?: Partial<NativeMediaBridge> };
  const o = w.openreel;
  if (o && o.platform === "desktop" && o.fs && o.media) {
    return o as NativeMediaBridge;
  }
  return undefined;
}

export function nativeMediaAvailable(): boolean {
  return getBridge() !== undefined;
}

function extensionFor(file: File | Blob): string {
  const name = (file as File).name;
  if (name && name.includes(".")) return name.slice(name.lastIndexOf(".") + 1);
  const t = file.type;
  if (t.includes("mp4")) return "mp4";
  if (t.includes("webm")) return "webm";
  if (t.includes("quicktime") || t.includes("mov")) return "mov";
  if (t.includes("wav")) return "wav";
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  return "bin";
}

// Stream a File/Blob to a temp file on disk (chunked — bounded peak memory) and return its path.
export async function materializeToTemp(bridge: NativeMediaBridge, file: File | Blob): Promise<string> {
  const tmpPath = await bridge.fs.tempFilePath(extensionFor(file));
  const handleId = await bridge.fs.openWrite(tmpPath);
  const reader = file.stream().getReader();
  let position = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const view = value as Uint8Array;
      const buf = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
      await bridge.fs.writeChunk(handleId, buf, position);
      position += view.byteLength;
    }
    await bridge.fs.closeWrite(handleId);
  } catch (err) {
    await bridge.fs.closeWrite(handleId).catch(() => {});
    throw err;
  }
  return tmpPath;
}

export async function readBackBlob(bridge: NativeMediaBridge, outPath: string, mime: string): Promise<Blob> {
  const bytes = await bridge.fs.readFileBytes(outPath);
  return new Blob([bytes], { type: mime });
}

export async function proxyViaNative(file: File | Blob, preset: "low" | "medium" | "high"): Promise<Blob> {
  const bridge = getBridge();
  if (!bridge) throw new Error("native media bridge unavailable");
  const srcPath = await materializeToTemp(bridge, file);
  const { outPath } = await bridge.media.generateProxy({ srcPath, preset });
  return readBackBlob(bridge, outPath, "video/mp4");
}

export async function transcodeViaNative(
  file: File | Blob,
  opts: { container: "mp4" | "webm" | "mov"; videoBitrateKbps: number; audioBitrateKbps: number },
): Promise<Blob> {
  const bridge = getBridge();
  if (!bridge) throw new Error("native media bridge unavailable");
  const srcPath = await materializeToTemp(bridge, file);
  const { outPath } = await bridge.media.transcode({ srcPath, ...opts });
  const mime = opts.container === "webm" ? "video/webm" : opts.container === "mov" ? "video/quicktime" : "video/mp4";
  return readBackBlob(bridge, outPath, mime);
}

export class NoAudioStreamError extends Error {
  constructor(message = "media has no matching audio stream") {
    super(message);
    this.name = "NoAudioStreamError";
  }
}

export async function extractAudioWavViaNative(file: File | Blob, streamIndex?: number): Promise<Blob> {
  const bridge = getBridge();
  if (!bridge) throw new Error("native media bridge unavailable");
  const srcPath = await materializeToTemp(bridge, file);
  const { streams } = await bridge.media.probeAudioStreams({ srcPath });
  if (streams.length === 0 || (streamIndex ?? 0) >= streams.length) {
    throw new NoAudioStreamError();
  }
  const { outPath } = await bridge.media.extractAudioWav({ srcPath, streamIndex });
  return readBackBlob(bridge, outPath, "audio/wav");
}

export async function probeAudioStreamCountViaNative(file: File | Blob): Promise<number> {
  const bridge = getBridge();
  if (!bridge) throw new Error("native media bridge unavailable");
  const srcPath = await materializeToTemp(bridge, file);
  const { streams } = await bridge.media.probeAudioStreams({ srcPath });
  return streams.length;
}
