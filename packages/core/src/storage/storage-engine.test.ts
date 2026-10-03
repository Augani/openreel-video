import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageEngine } from "./storage-engine";
import type { MediaRecord } from "./types";

const media: MediaRecord = {
  id: "media-1",
  projectId: "project-1",
  blob: new Blob(["video"]),
  metadata: {
    duration: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    codec: "h264",
    sampleRate: 48_000,
    channels: 2,
    fileSize: 5,
  },
};

function transactionFixture() {
  const request = {
    result: media.id,
    error: null as DOMException | null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };
  const tx = {
    error: null as DOMException | null,
    oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null,
    onerror: null as (() => void) | null,
    objectStore: () => ({ put: () => request }),
  };
  const engine = new StorageEngine();
  (engine as unknown as { db: unknown }).db = { transaction: () => tx };
  return { engine, request, tx };
}

describe("StorageEngine persistence", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("waits for a committed media write before resolving", async () => {
    const { engine, request, tx } = transactionFixture();
    const completed = vi.fn();
    const saving = engine.saveMedia(media).then(completed);
    await Promise.resolve();
    request.onsuccess?.();
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();

    tx.oncomplete!();
    await saving;
    expect(completed).toHaveBeenCalledOnce();
  });

  it("rejects an aborted media transaction and identifies quota exhaustion", async () => {
    const { engine, request, tx } = transactionFixture();
    const saving = engine.saveMedia(media);
    await Promise.resolve();
    request.onsuccess?.();
    tx.error = new DOMException("Storage is full", "QuotaExceededError");
    tx.onabort!();

    await expect(saving).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      message: expect.stringContaining("Storage is full"),
    });
  });

  it("retries database initialization after an unsuccessful open", async () => {
    const tx = {
      oncomplete: null as (() => void) | null,
      onabort: null,
      onerror: null,
      objectStore: () => ({ get: () => ({ result: media, error: null }) }),
    };
    const db = {
      onversionchange: null,
      close: vi.fn(),
      transaction: () => {
        queueMicrotask(() => tx.oncomplete!());
        return tx;
      },
    };
    const open = vi.fn(() => {
      const request = {
        result: db,
        error: new DOMException("Temporarily unavailable", "UnknownError"),
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null,
      };
      const attempt = open.mock.calls.length;
      queueMicrotask(() => {
        if (attempt === 1) request.onerror!();
        else request.onsuccess!();
      });
      return request;
    });
    vi.stubGlobal("indexedDB", { open });
    const engine = new StorageEngine();

    await expect(engine.loadMedia(media.id)).rejects.toMatchObject({ code: "DATABASE_ERROR" });
    await expect(engine.loadMedia(media.id)).resolves.toBe(media);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
