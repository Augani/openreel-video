import { useCallback, useState } from "react";
import {
  getExportEngine,
  type VideoExportSettings,
  type ExportResult,
  type Project,
} from "@openreel/core";

export interface ExportRunnerState {
  isExporting: boolean;
  progress: number;
  phase: string;
  error: string | null;
  complete: boolean;
}

export type ExportContainer = "mp4" | "webm" | "mov" | "wav";

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  wav: "audio/wav",
};

export function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function extForFormat(format: string, codec?: string): ExportContainer {
  if (codec === "prores") return "mov";
  if (format === "mov") return "mov";
  if (format === "webm") return "webm";
  if (format === "wav") return "wav";
  return "mp4";
}

const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/g;

export function sanitizeFilenameBase(name: string): string {
  const withoutControls = Array.from(name, (ch) =>
    ch.charCodeAt(0) < 0x20 ? " " : ch,
  ).join("");
  return withoutControls
    .replace(ILLEGAL_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 200)
    .trim();
}

export function exportFilename(projectName: string | undefined, ext: string): string {
  const cleaned = projectName ? sanitizeFilenameBase(projectName) : "";
  const base = cleaned.length > 0 ? cleaned : "export";
  return `${base}.${ext}`;
}

export async function writeBlobToWritable(
  blob: Blob,
  writable: FileSystemWritableFileStream,
): Promise<void> {
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) await writable.write(value);
    }
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      void 0;
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function progressPhaseLabel(phase: string): string {
  return phase === "complete" ? "Complete!" : `${phase}...`;
}

function triggerAnchorDownload(data: Blob, filename: string, onRelease?: () => void): void {
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.addEventListener(
    "pagehide",
    () => {
      URL.revokeObjectURL(url);
      onRelease?.();
    },
    { once: true },
  );
}

const OPFS_TMP_PREFIX = ".openreel-export-";
const OPFS_TMP_TTL_MS = 60 * 60 * 1000;

type OpfsWriteHandle = FileSystemFileHandle & {
  createWritable?: (opts?: { keepExistingData?: boolean }) => Promise<FileSystemWritableFileStream>;
};

type OpfsDirHandle = FileSystemDirectoryHandle & {
  keys?: () => AsyncIterableIterator<string>;
};

async function getOpfsRoot(): Promise<OpfsDirHandle | null> {
  try {
    const storage = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<OpfsDirHandle>;
    };
    if (!storage || typeof storage.getDirectory !== "function") return null;
    return await storage.getDirectory();
  } catch {
    return null;
  }
}

async function sweepStaleOpfsTemps(root: OpfsDirHandle, now: number): Promise<void> {
  if (typeof root.keys !== "function") return;
  try {
    const stale: string[] = [];
    for await (const name of root.keys()) {
      if (!name.startsWith(OPFS_TMP_PREFIX)) continue;
      const stamp = Number(name.slice(OPFS_TMP_PREFIX.length).split("-")[0]);
      if (Number.isFinite(stamp) && now - stamp > OPFS_TMP_TTL_MS) stale.push(name);
    }
    for (const name of stale) {
      await root.removeEntry(name).catch(() => undefined);
    }
  } catch {
    void 0;
  }
}

async function createOpfsDownloadWritable(
  filename: string,
): Promise<FileSystemWritableFileStream | null> {
  const root = await getOpfsRoot();
  if (!root) return null;

  const now = Date.now();
  await sweepStaleOpfsTemps(root, now);

  const tmpName = `${OPFS_TMP_PREFIX}${now}-${Math.random().toString(36).slice(2)}.tmp`;
  let fileHandle: OpfsWriteHandle;
  let writable: FileSystemWritableFileStream;
  try {
    fileHandle = (await root.getFileHandle(tmpName, { create: true })) as OpfsWriteHandle;
    if (typeof fileHandle.createWritable !== "function") return null;
    writable = await fileHandle.createWritable({ keepExistingData: false });
  } catch (error) {
    console.warn("[export-runner] OPFS streaming unavailable; using in-memory fallback", error);
    return null;
  }

  return {
    async seek(position: number) {
      await writable.seek(position);
    },
    async write(data: unknown) {
      await writable.write(data as Parameters<typeof writable.write>[0]);
    },
    async truncate(size: number) {
      await writable.truncate(size);
    },
    async close() {
      await writable.close();
      const file = await fileHandle.getFile();
      triggerAnchorDownload(file, filename, () => {
        root.removeEntry(tmpName).catch(() => undefined);
      });
    },
    async abort() {
      try {
        await writable.abort();
      } catch {
        void 0;
      }
      await root.removeEntry(tmpName).catch(() => undefined);
    },
  } as unknown as FileSystemWritableFileStream;
}

function createBufferedDownloadWritable(
  filename: string,
  mime: string,
): FileSystemWritableFileStream {
  let buffer = new Uint8Array(16 * 1024 * 1024);
  let length = 0;
  let cursor = 0;

  const grow = (needed: number) => {
    if (needed <= buffer.length) return;
    let newSize = buffer.length;
    while (newSize < needed) newSize *= 2;
    const next = new Uint8Array(newSize);
    next.set(buffer.subarray(0, length));
    buffer = next;
  };

  const writeBytes = (bytes: Uint8Array, position: number) => {
    const end = position + bytes.byteLength;
    grow(end);
    buffer.set(bytes, position);
    if (end > length) length = end;
    cursor = end;
  };

  return {
    seek(position: number) {
      cursor = position;
      return Promise.resolve();
    },
    write(data: unknown) {
      if (data instanceof ArrayBuffer) {
        writeBytes(new Uint8Array(data), cursor);
      } else if (ArrayBuffer.isView(data)) {
        writeBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), cursor);
      }
      return Promise.resolve();
    },
    close() {
      triggerAnchorDownload(new Blob([buffer.slice(0, length)], { type: mime }), filename);
      return Promise.resolve();
    },
    abort() {
      return Promise.resolve();
    },
    truncate() {
      return Promise.resolve();
    },
  } as unknown as FileSystemWritableFileStream;
}

async function createFallbackWritable(
  filename: string,
  mime: string,
): Promise<FileSystemWritableFileStream> {
  return (await createOpfsDownloadWritable(filename)) ?? createBufferedDownloadWritable(filename, mime);
}

export async function createDownloadWritable(
  filename: string,
  mime: string,
): Promise<FileSystemWritableFileStream> {
  const ext = filename.split(".").pop() || "mp4";

  if (typeof window.openreel?.fs?.showSaveDialog === "function") {
    const chosen = await window.openreel.fs.showSaveDialog({
      defaultPath: filename,
      filters: [{ name: "Media file", extensions: [ext] }],
    });
    if (!chosen) {
      throw new DOMException("User cancelled", "AbortError");
    }
    (window as { __openreelExportPath?: string }).__openreelExportPath = chosen;
    const handleId = await window.openreel.fs.openWrite(chosen);
    let cursor = 0;
    return {
      async seek(position: number) {
        cursor = position;
      },
      async write(data: unknown) {
        let bytes: ArrayBuffer | Uint8Array;
        if (data instanceof ArrayBuffer) {
          bytes = data;
        } else if (data instanceof Uint8Array) {
          bytes = data;
        } else if (ArrayBuffer.isView(data)) {
          bytes = new Uint8Array(
            data.buffer as ArrayBuffer,
            data.byteOffset,
            data.byteLength,
          );
        } else {
          return;
        }
        await window.openreel!.fs.writeChunk(handleId, bytes, cursor);
        cursor += bytes.byteLength;
      },
      async close() {
        await window.openreel!.fs.closeWrite(handleId);
      },
      async abort() {
        await window.openreel!.fs.abortWrite(handleId);
      },
      async truncate() {},
    } as unknown as FileSystemWritableFileStream;
  }

  if ("showSaveFilePicker" in window) {
    try {
      const handle = await (
        window as unknown as {
          showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "Media file",
            accept: { [mime]: [`.${ext}`] },
          },
        ],
      });
      return handle.createWritable();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      console.warn(
        "[export-runner] showSaveFilePicker unavailable; streaming to a downloaded file instead",
        error,
      );
    }
  }

  return createFallbackWritable(filename, mime);
}

const INITIAL_STATE: ExportRunnerState = {
  isExporting: false,
  progress: 0,
  phase: "",
  error: null,
  complete: false,
};

interface ExportRunnerOptions {
  project: Project;
  onExported?: (settings: Partial<VideoExportSettings>) => void;
}

export interface UseExportRunner {
  state: ExportRunnerState;
  runExport: (
    videoSettings: Partial<VideoExportSettings>,
    ext: string,
    writableStream: FileSystemWritableFileStream,
  ) => Promise<void>;
  showSavePicker: (filename: string, ext: string, opts?: { streamToFile?: boolean }) => Promise<FileSystemWritableFileStream>;
  reportProgress: (progress01: number, phase: string) => void;
  markComplete: () => void;
  beginExport: () => void;
  finishExportSoon: () => void;
  failExport: (error: unknown) => void;
  cancel: () => void;
  resetError: () => void;
}

export function useExportRunner(options: ExportRunnerOptions): UseExportRunner {
  const { project, onExported } = options;
  const [state, setState] = useState<ExportRunnerState>(INITIAL_STATE);

  const beginExport = useCallback(() => {
    setState({
      isExporting: true,
      progress: 0,
      phase: "Initializing...",
      error: null,
      complete: false,
    });
  }, []);

  const reportProgress = useCallback((progress01: number, phase: string) => {
    setState((prev) => ({
      ...prev,
      progress: progress01 * 100,
      phase: progressPhaseLabel(phase),
    }));
  }, []);

  const markComplete = useCallback(() => {
    setState((prev) => ({ ...prev, complete: true, phase: "Saved!" }));
  }, []);

  const finishExportSoon = useCallback(() => {
    setTimeout(() => {
      setState(INITIAL_STATE);
    }, 2000);
  }, []);

  const failExport = useCallback((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") {
      setState(INITIAL_STATE);
      return;
    }
    setState((prev) => ({
      ...prev,
      isExporting: false,
      error: error instanceof Error ? error.message : "Export failed",
    }));
  }, []);

  const resetError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const runExport = useCallback(
    async (
      videoSettings: Partial<VideoExportSettings>,
      _ext: string,
      writableStream: FileSystemWritableFileStream,
    ): Promise<void> => {
      const engine = getExportEngine();
      await engine.initialize();

      const generator = engine.exportVideo(project, videoSettings, writableStream);
      let finalResult: ExportResult | undefined;

      while (true) {
        const { value, done } = await generator.next();
        if (done) {
          finalResult = value;
          break;
        }
        setState((prev) => ({
          ...prev,
          progress: value.progress * 100,
          phase: progressPhaseLabel(value.phase),
        }));
      }

      if (finalResult?.success) {
        setState((prev) => ({ ...prev, complete: true, phase: "Saved!" }));
        onExported?.(videoSettings);
      } else {
        throw new Error(finalResult?.error?.message || "Export failed");
      }
    },
    [project, onExported],
  );

  const showSavePicker = useCallback(
    async (
      filename: string,
      ext: string,
      opts?: { streamToFile?: boolean },
    ): Promise<FileSystemWritableFileStream> => {
      const mime = mimeForExt(ext);

      if (typeof window.openreel?.fs?.showSaveDialog === "function") {
        const chosen = await window.openreel.fs.showSaveDialog({
          defaultPath: filename,
          filters: [{ name: "Media file", extensions: [ext] }],
        });
        if (!chosen) {
          throw new DOMException("User cancelled", "AbortError");
        }
        (window as { __openreelExportPath?: string }).__openreelExportPath = chosen;

        // The WAV path and any WebCodecs export (streamToFile) mux directly to
        // disk through the fs bridge. The native ffmpeg video path writes the
        // file itself via __openreelExportPath, so it gets the no-op stub below.
        if (ext === "wav" || opts?.streamToFile === true) {
          const handleId = await window.openreel.fs.openWrite(chosen);
          let cursor = 0;
          return {
            async seek(position: number) {
              cursor = position;
            },
            async write(data: unknown) {
              let bytes: ArrayBuffer | Uint8Array;
              if (data instanceof ArrayBuffer) {
                bytes = data;
              } else if (data instanceof Uint8Array) {
                bytes = data;
              } else if (ArrayBuffer.isView(data)) {
                bytes = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
              } else {
                return;
              }
              await window.openreel!.fs.writeChunk(handleId, bytes, cursor);
              cursor += bytes.byteLength;
            },
            async close() {
              await window.openreel!.fs.closeWrite(handleId);
            },
            async abort() {
              await window.openreel!.fs.abortWrite(handleId);
            },
            async truncate() {},
          } as unknown as FileSystemWritableFileStream;
        }

        return {
          async seek() {},
          async write() {},
          async close() {},
          async abort() {},
          async truncate() {},
        } as unknown as FileSystemWritableFileStream;
      }

      if ("showSaveFilePicker" in window) {
        try {
          const handle = await (
            window as unknown as {
              showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
            }
          ).showSaveFilePicker({
            suggestedName: filename,
            types: [
              {
                description: "Media file",
                accept: { [mime]: [`.${ext}`] },
              },
            ],
          });
          return handle.createWritable();
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
          }
          console.warn(
            "[export-runner] showSaveFilePicker unavailable; streaming to a downloaded file instead",
            error,
          );
          return createFallbackWritable(filename, mime);
        }
      }

      return createFallbackWritable(filename, mime);
    },
    [],
  );

  const cancel = useCallback(() => {
    const engine = getExportEngine();
    engine.cancel();
    setState(INITIAL_STATE);
  }, []);

  return {
    state,
    runExport,
    showSavePicker,
    reportProgress,
    markComplete,
    beginExport,
    finishExportSoon,
    failExport,
    cancel,
    resetError,
  };
}
