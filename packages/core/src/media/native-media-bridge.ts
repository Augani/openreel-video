// Renderer-side bridge to the desktop native FFmpeg sidecar (window.openreel.media).
// packages/core cannot see apps/web's ambient window.openreel type, so we declare the
// minimal slice this module uses and access it via a typed cast on globalThis.

import { claimNativeSource } from "./native-frame-source";

interface NativeMediaBridge {
  platform?: string;
  fs: {
    tempFilePath(ext: string): Promise<string>;
    openWrite(path: string): Promise<string>;
    writeChunk(handleId: string, data: ArrayBuffer, position: number): Promise<void>;
    closeWrite(handleId: string): Promise<void>;
    readFileBytes(path: string): Promise<ArrayBuffer>;
    releaseTemp?(path: string): Promise<boolean>;
  };
  media: {
    generateProxy(args: { srcPath: string; preset: "low" | "medium" | "high" }): Promise<{ outPath: string }>;
    transcode(args: {
      srcPath: string;
      container?: "mp4" | "webm" | "mov";
      videoBitrateKbps?: number;
      audioBitrateKbps?: number;
    }): Promise<{ outPath: string }>;
    extractAudioWav(args: { srcPath: string; streamIndex?: number; channels?: number }): Promise<{ outPath: string }>;
    probeAudioStreams(args: { srcPath: string }): Promise<{
      streams: { index: number; codec: string; channels: number; sampleRate: number; language?: string }[];
    }>;
  };
}

function getBridge(): NativeMediaBridge | undefined {
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
async function writeBlobToTemp(bridge: NativeMediaBridge, file: File | Blob): Promise<string> {
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

// One temp copy per Blob: probe, extract, proxy and transcode on the same blob share it. Keyed by
// the Blob itself, so replacing the media item (a new Blob) naturally gets a fresh copy. The set of
// live input copies is a small LRU: the oldest copy is released (fsReleaseTemp) once evicted and no
// job is still using it, so imports of many large files cannot pile up temp files.
const MAX_CACHED_INPUTS = 3;

interface InputCopy {
  path: Promise<string>;
  users: number;
  evicted: boolean;
}

// Map iteration order is insertion order; re-inserting on use makes it least-recently-used first.
const inputCopies = new Map<File | Blob, InputCopy>();

function releaseInputCopy(bridge: NativeMediaBridge, copy: InputCopy): void {
  void copy.path
    .then((p) => bridge.fs.releaseTemp?.(p))
    .catch(() => {});
}

function evictInputCopies(bridge: NativeMediaBridge): void {
  while (inputCopies.size > MAX_CACHED_INPUTS) {
    const oldest = inputCopies.keys().next().value as File | Blob;
    const copy = inputCopies.get(oldest)!;
    inputCopies.delete(oldest);
    copy.evicted = true;
    if (copy.users === 0) releaseInputCopy(bridge, copy);
  }
}

// Runs `fn` with the temp path of `file`, keeping the copy alive until `fn` settles.
async function withInputCopy<T>(
  bridge: NativeMediaBridge,
  file: File | Blob,
  fn: (srcPath: string) => Promise<T>,
): Promise<T> {
  // A file the sidecar already decodes natively (MXF, ProRes...) is read where it lives: copying a
  // multi-gigabyte camera file to a temp path just to pull its audio would double the disk traffic.
  const native = await claimNativeSource(file).catch(() => null);
  if (native?.id) return fn(native.id);
  let copy = inputCopies.get(file);
  if (copy) {
    inputCopies.delete(file);
  } else {
    const created: InputCopy = {
      path: writeBlobToTemp(bridge, file),
      users: 0,
      evicted: false,
    };
    copy = created;
    // A failed write must not poison later attempts (its half-written temp is swept at quit).
    created.path.catch(() => {
      if (inputCopies.get(file) === created) inputCopies.delete(file);
    });
  }
  inputCopies.set(file, copy);
  const active = copy;
  active.users++;
  evictInputCopies(bridge);
  try {
    return await fn(await active.path);
  } finally {
    active.users--;
    if (active.evicted && active.users === 0) releaseInputCopy(bridge, active);
  }
}

async function readBackBlob(bridge: NativeMediaBridge, outPath: string, mime: string): Promise<Blob> {
  const bytes = await bridge.fs.readFileBytes(outPath);
  // The output is read into memory now, so the temp file can go (the quit sweep is the backstop).
  void bridge.fs.releaseTemp?.(outPath)?.catch(() => {});
  return new Blob([bytes], { type: mime });
}

export async function proxyViaNative(file: File | Blob, preset: "low" | "medium" | "high"): Promise<Blob> {
  const bridge = getBridge();
  if (!bridge) throw new Error("native media bridge unavailable");
  const { outPath } = await withInputCopy(bridge, file, (srcPath) =>
    bridge.media.generateProxy({ srcPath, preset }),
  );
  return readBackBlob(bridge, outPath, "video/mp4");
}

export async function transcodeViaNative(
  file: File | Blob,
  opts: { container: "mp4" | "webm" | "mov"; videoBitrateKbps: number; audioBitrateKbps: number },
): Promise<Blob> {
  const bridge = getBridge();
  if (!bridge) throw new Error("native media bridge unavailable");
  const { outPath } = await withInputCopy(bridge, file, (srcPath) =>
    bridge.media.transcode({ srcPath, ...opts }),
  );
  const mime = opts.container === "webm" ? "video/webm" : opts.container === "mov" ? "video/quicktime" : "video/mp4";
  return readBackBlob(bridge, outPath, mime);
}

export class NoAudioStreamError extends Error {
  constructor(message = "media has no matching audio stream") {
    super(message);
    this.name = "NoAudioStreamError";
  }
}

export async function extractAudioWavViaNative(file: File | Blob, streamIndex?: number, channels?: number): Promise<Blob> {
  const bridge = getBridge();
  if (!bridge) throw new Error("native media bridge unavailable");
  const { outPath } = await withInputCopy(bridge, file, async (srcPath) => {
    const { streams } = await bridge.media.probeAudioStreams({ srcPath });
    if (streams.length === 0 || (streamIndex ?? 0) >= streams.length) {
      throw new NoAudioStreamError();
    }
    return bridge.media.extractAudioWav({ srcPath, streamIndex, ...(channels ? { channels } : {}) });
  });
  return readBackBlob(bridge, outPath, "audio/wav");
}

export async function probeAudioStreamCountViaNative(file: File | Blob): Promise<number> {
  const bridge = getBridge();
  if (!bridge) throw new Error("native media bridge unavailable");
  const { streams } = await withInputCopy(bridge, file, (srcPath) =>
    bridge.media.probeAudioStreams({ srcPath }),
  );
  return streams.length;
}
