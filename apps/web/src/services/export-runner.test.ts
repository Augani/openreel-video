import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Project, VideoExportSettings, ExportResult } from "@openreel/core";
import {
  useExportRunner,
  mimeForExt,
  extForFormat,
  exportFilename,
  sanitizeFilenameBase,
  writeBlobToWritable,
  progressPhaseLabel,
  createDownloadWritable,
} from "./export-runner";

const { mockEngine, getExportEngineMock } = vi.hoisted(() => {
  const engine = {
    initialize: vi.fn().mockResolvedValue(undefined),
    exportVideo: vi.fn(),
    cancel: vi.fn(),
  };
  return {
    mockEngine: engine,
    getExportEngineMock: vi.fn(() => engine),
  };
});

vi.mock("@openreel/core", () => ({
  getExportEngine: getExportEngineMock,
}));

function fakeProject(): Project {
  return {
    name: "My Movie",
    settings: { width: 1920, height: 1080, frameRate: 30 },
    timeline: { duration: 10 },
  } as unknown as Project;
}

async function* successGenerator(): AsyncGenerator<
  { phase: ExportResult extends never ? never : "rendering" | "encoding" | "complete"; progress: number },
  ExportResult
> {
  yield { phase: "rendering", progress: 0.25 };
  yield { phase: "encoding", progress: 0.75 };
  yield { phase: "complete", progress: 1 };
  return { success: true } as ExportResult;
}

async function* failureGenerator(): AsyncGenerator<
  { phase: "rendering"; progress: number },
  ExportResult
> {
  yield { phase: "rendering", progress: 0.5 };
  return { success: false, error: { message: "boom" } } as unknown as ExportResult;
}

function fakeBlob(chunks: Uint8Array[]): Blob {
  return {
    stream() {
      let index = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index < chunks.length) {
            controller.enqueue(chunks[index]);
            index += 1;
          } else {
            controller.close();
          }
        },
      });
    },
  } as unknown as Blob;
}

function fakeStream(): FileSystemWritableFileStream {
  return {
    seek: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    truncate: vi.fn().mockResolvedValue(undefined),
  } as unknown as FileSystemWritableFileStream;
}

describe("export-runner pure helpers", () => {
  it("maps extension to mime", () => {
    expect(mimeForExt("mp4")).toBe("video/mp4");
    expect(mimeForExt("mov")).toBe("video/quicktime");
    expect(mimeForExt("webm")).toBe("video/webm");
    expect(mimeForExt("wav")).toBe("audio/wav");
    expect(mimeForExt("xyz")).toBe("application/octet-stream");
  });

  it("resolves container ext from format", () => {
    expect(extForFormat("mov")).toBe("mov");
    expect(extForFormat("webm")).toBe("webm");
    expect(extForFormat("wav")).toBe("wav");
    expect(extForFormat("mp4")).toBe("mp4");
    expect(extForFormat("unknown")).toBe("mp4");
  });

  it("builds export filename with fallback", () => {
    expect(exportFilename("Vacation", "mp4")).toBe("Vacation.mp4");
    expect(exportFilename("", "mov")).toBe("export.mov");
    expect(exportFilename(undefined, "webm")).toBe("export.webm");
    expect(exportFilename("   ", "mp4")).toBe("export.mp4");
  });

  it("strips filesystem-illegal characters from the suggested filename", () => {
    expect(exportFilename("Vlog: Ep 1", "mp4")).toBe("Vlog Ep 1.mp4");
    expect(exportFilename("6/14/2026", "mov")).toBe("6 14 2026.mov");
    expect(exportFilename('a<b>c:"d"|e?f*g\\h', "webm")).toBe("a b c d e f g h.webm");
    expect(exportFilename("...hidden", "mp4")).toBe("hidden.mp4");
    expect(exportFilename("///", "mp4")).toBe("export.mp4");
  });

  it("keeps legal filename characters intact", () => {
    expect(exportFilename("My-Video_v2 (final)", "mp4")).toBe("My-Video_v2 (final).mp4");
    expect(sanitizeFilenameBase("café déjà-vu")).toBe("café déjà-vu");
  });

  it("labels progress phase", () => {
    expect(progressPhaseLabel("rendering")).toBe("rendering...");
    expect(progressPhaseLabel("encoding")).toBe("encoding...");
    expect(progressPhaseLabel("complete")).toBe("Complete!");
  });
});

describe("extForFormat codec-awareness", () => {
  it("forces mov for prores regardless of format", () => {
    expect(extForFormat("mp4", "prores")).toBe("mov");
  });
  it("keeps format-based extension otherwise", () => {
    expect(extForFormat("mp4", "h264")).toBe("mp4");
    expect(extForFormat("mov")).toBe("mov");
  });
});

describe("useExportRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEngine.initialize.mockResolvedValue(undefined);
  });

  it("advances progress and completes on success", async () => {
    mockEngine.exportVideo.mockImplementation(() => successGenerator());
    const onExported = vi.fn();
    const { result } = renderHook(() =>
      useExportRunner({ project: fakeProject(), onExported }),
    );

    expect(result.current.state.isExporting).toBe(false);

    await act(async () => {
      result.current.beginExport();
    });
    expect(result.current.state.isExporting).toBe(true);
    expect(result.current.state.phase).toBe("Initializing...");

    const settings: Partial<VideoExportSettings> = { format: "mp4", codec: "h264" };
    await act(async () => {
      await result.current.runExport(settings, "mp4", fakeStream());
    });

    expect(mockEngine.initialize).toHaveBeenCalledTimes(1);
    expect(result.current.state.complete).toBe(true);
    expect(result.current.state.phase).toBe("Saved!");
    expect(result.current.state.progress).toBe(100);
    expect(onExported).toHaveBeenCalledWith(settings);
  });

  it("throws and surfaces error on failed result", async () => {
    mockEngine.exportVideo.mockImplementation(() => failureGenerator());
    const { result } = renderHook(() => useExportRunner({ project: fakeProject() }));

    await act(async () => {
      result.current.beginExport();
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.runExport({ format: "mp4" }, "mp4", fakeStream());
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("boom");

    act(() => {
      result.current.failExport(caught);
    });
    expect(result.current.state.isExporting).toBe(false);
    expect(result.current.state.error).toBe("boom");
  });

  it("swallows AbortError without surfacing an error", () => {
    const { result } = renderHook(() => useExportRunner({ project: fakeProject() }));
    act(() => {
      result.current.beginExport();
    });
    const abort = new Error("User cancelled");
    abort.name = "AbortError";
    act(() => {
      result.current.failExport(abort);
    });
    expect(result.current.state.isExporting).toBe(false);
    expect(result.current.state.error).toBeNull();
  });

  it("cancel calls engine.cancel and resets state", () => {
    const { result } = renderHook(() => useExportRunner({ project: fakeProject() }));
    act(() => {
      result.current.beginExport();
    });
    act(() => {
      result.current.cancel();
    });
    expect(mockEngine.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.state.isExporting).toBe(false);
    expect(result.current.state.progress).toBe(0);
  });
});

describe("writeBlobToWritable", () => {
  it("streams blob bytes into a plain-object writable and closes it", async () => {
    const chunks: number[] = [];
    let closed = false;
    const writable = {
      seek: vi.fn().mockResolvedValue(undefined),
      write: vi.fn(async (data: ArrayBufferView) => {
        chunks.push(data.byteLength);
      }),
      close: vi.fn(async () => {
        closed = true;
      }),
      abort: vi.fn().mockResolvedValue(undefined),
      truncate: vi.fn().mockResolvedValue(undefined),
    } as unknown as FileSystemWritableFileStream;

    const blob = fakeBlob([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
    await writeBlobToWritable(blob, writable);

    expect(closed).toBe(true);
    expect(chunks.reduce((sum, n) => sum + n, 0)).toBe(5);
  });

  it("aborts and rethrows when a write fails", async () => {
    const writable = {
      seek: vi.fn().mockResolvedValue(undefined),
      write: vi.fn(async () => {
        throw new Error("disk full");
      }),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      truncate: vi.fn().mockResolvedValue(undefined),
    } as unknown as FileSystemWritableFileStream;

    const blob = fakeBlob([new Uint8Array([1, 2, 3])]);
    await expect(writeBlobToWritable(blob, writable)).rejects.toThrow("disk full");
    expect(writable.abort).toHaveBeenCalledTimes(1);
    expect(writable.close).not.toHaveBeenCalled();
  });
});

describe("useExportRunner showSavePicker fallback", () => {
  const win = window as unknown as Record<string, unknown>;
  const urlApi = URL as unknown as {
    createObjectURL?: unknown;
    revokeObjectURL?: unknown;
  };
  const hadPicker = "showSaveFilePicker" in window;
  const originalPicker = win.showSaveFilePicker;
  const originalCreate = urlApi.createObjectURL;
  const originalRevoke = urlApi.revokeObjectURL;
  const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");

  let createObjectURL: ReturnType<typeof vi.fn>;
  let click: MockInstance;

  const setOpfs = (value: unknown) => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value,
    });
  };

  beforeEach(() => {
    createObjectURL = vi.fn().mockReturnValue("blob:fake");
    urlApi.createObjectURL = createObjectURL;
    urlApi.revokeObjectURL = vi.fn();
    click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    setOpfs(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    urlApi.createObjectURL = originalCreate;
    urlApi.revokeObjectURL = originalRevoke;
    if (originalStorage) {
      Object.defineProperty(navigator, "storage", originalStorage);
    } else {
      delete (navigator as unknown as Record<string, unknown>).storage;
    }
    if (hadPicker) {
      win.showSaveFilePicker = originalPicker;
    } else {
      delete win.showSaveFilePicker;
    }
    delete win.openreel;
    delete win.__openreelExportPath;
  });

  it("falls back to an in-memory download when OPFS is unavailable and the picker is blocked", async () => {
    const picker = vi.fn().mockRejectedValue(
      new DOMException(
        "Failed to execute 'showSaveFilePicker' on 'Window': Cross origin sub frames aren't allowed to show a file picker.",
        "SecurityError",
      ),
    );
    win.showSaveFilePicker = picker;

    const { result } = renderHook(() => useExportRunner({ project: fakeProject() }));

    const writable = await result.current.showSavePicker("My Movie.mp4", "mp4");
    expect(picker).toHaveBeenCalledTimes(1);

    await writeBlobToWritable(fakeBlob([new Uint8Array([1, 2, 3, 4])]), writable);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("streams to an OPFS temp file (not memory) when the picker is blocked", async () => {
    win.showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException("blocked", "SecurityError"));

    const opfsWrites: number[] = [];
    let opfsClosed = false;
    const opfsWritable = {
      seek: vi.fn().mockResolvedValue(undefined),
      write: vi.fn(async (chunk: ArrayBufferView) => {
        opfsWrites.push(chunk.byteLength);
      }),
      truncate: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(async () => {
        opfsClosed = true;
      }),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const fileHandle = {
      createWritable: vi.fn().mockResolvedValue(opfsWritable),
      getFile: vi.fn().mockResolvedValue(new Blob([new Uint8Array([9, 9, 9])])),
    };
    const getFileHandle = vi.fn().mockResolvedValue(fileHandle);
    async function* noKeys(): AsyncGenerator<string> {}
    const getDirectory = vi.fn().mockResolvedValue({
      getFileHandle,
      removeEntry: vi.fn().mockResolvedValue(undefined),
      keys: noKeys,
    });
    setOpfs({ getDirectory });

    const { result } = renderHook(() => useExportRunner({ project: fakeProject() }));
    const writable = await result.current.showSavePicker("Clip.mp4", "mp4");

    expect(getDirectory).toHaveBeenCalledTimes(1);
    expect(fileHandle.createWritable).toHaveBeenCalledTimes(1);

    await writeBlobToWritable(fakeBlob([new Uint8Array([1, 2, 3, 4, 5])]), writable);

    expect(opfsWrites.reduce((sum, n) => sum + n, 0)).toBe(5);
    expect(opfsClosed).toBe(true);
    expect(fileHandle.getFile).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("rethrows AbortError so a user cancel is not turned into a download", async () => {
    const picker = vi
      .fn()
      .mockRejectedValue(new DOMException("User cancelled", "AbortError"));
    win.showSaveFilePicker = picker;

    const { result } = renderHook(() => useExportRunner({ project: fakeProject() }));

    await expect(
      result.current.showSavePicker("My Movie.mp4", "mp4"),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("createDownloadWritable uses the browser save picker when available", async () => {
    const writable = fakeStream();
    const handle = {
      createWritable: vi.fn().mockResolvedValue(writable),
    };
    const picker = vi.fn().mockResolvedValue(handle);
    win.showSaveFilePicker = picker;

    await expect(
      createDownloadWritable("Motion Scene.mp4", "video/mp4"),
    ).resolves.toBe(writable);
    expect(picker).toHaveBeenCalledWith({
      suggestedName: "Motion Scene.mp4",
      types: [
        {
          description: "Media file",
          accept: { "video/mp4": [".mp4"] },
        },
      ],
    });
  });

  it("createDownloadWritable resolves the native ffmpeg output path on desktop", async () => {
    const showSaveDialog = vi
      .fn()
      .mockResolvedValue("/Users/me/Movies/Rubik.mp4");
    win.openreel = {
      platform: "desktop",
      fs: {
        showSaveDialog,
        openWrite: vi.fn().mockResolvedValue("handle-1"),
        writeChunk: vi.fn().mockResolvedValue(undefined),
        closeWrite: vi.fn().mockResolvedValue(undefined),
        abortWrite: vi.fn().mockResolvedValue(undefined),
      },
    };

    const writable = await createDownloadWritable("Rubik.mp4", "video/mp4");

    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(win.__openreelExportPath).toBe("/Users/me/Movies/Rubik.mp4");
    expect(writable).toBeDefined();
  });

  it("desktop stream writable forwards Uint8Array chunks without an ArrayBuffer copy", async () => {
    const writeChunk = vi.fn().mockResolvedValue(undefined);
    win.openreel = {
      platform: "desktop",
      fs: {
        showSaveDialog: vi.fn().mockResolvedValue("/Users/me/Movies/Rubik.mp4"),
        openWrite: vi.fn().mockResolvedValue("handle-1"),
        writeChunk,
        closeWrite: vi.fn().mockResolvedValue(undefined),
        abortWrite: vi.fn().mockResolvedValue(undefined),
      },
    };

    const { result } = renderHook(() => useExportRunner({ project: fakeProject() }));
    const writable = await result.current.showSavePicker(
      "Rubik.mp4",
      "mp4",
      { streamToFile: true },
    );
    const chunk = new Uint8Array([1, 2, 3]);

    await writable.write(chunk);

    expect(writeChunk).toHaveBeenCalledWith("handle-1", chunk, 0);
  });

  it("createDownloadWritable rethrows AbortError when the native save dialog is cancelled", async () => {
    win.openreel = {
      platform: "desktop",
      fs: {
        showSaveDialog: vi.fn().mockResolvedValue(null),
        openWrite: vi.fn(),
      },
    };

    await expect(
      createDownloadWritable("Rubik.mp4", "video/mp4"),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(win.__openreelExportPath).toBeUndefined();
  });
});
