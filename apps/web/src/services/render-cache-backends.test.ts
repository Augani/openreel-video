import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeferredChunkStore,
  DesktopDiskChunkStore,
  backendKeyPrefix,
  openRenderCacheBackend,
  projectKeyOf,
} from "./render-cache-backends";
import { MemoryChunkStore } from "@openreel/core";
import {
  MAX_WEB_CAP_BYTES,
  MIN_WEB_CAP_BYTES,
  maxWidthFor,
  readRenderCachePrefs,
  writeRenderCachePrefs,
} from "./render-cache-prefs";
import type { OpenReelRenderCacheBridge } from "../types/global";

function fakeBridge() {
  const files = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const bridge: OpenReelRenderCacheBridge = {
    getSettings: async () => ({ scratchDir: "/scratch", isDefault: true, capBytes: 1, freeBytes: null }),
    pickScratch: async () => ({ changed: false, error: null, settings: { scratchDir: "/scratch", isDefault: true, capBytes: 1, freeBytes: null } }),
    resetScratch: async () => ({ scratchDir: "/scratch", isDefault: true, capBytes: 1, freeBytes: null }),
    setCap: async () => ({ scratchDir: "/scratch", isDefault: true, capBytes: 1, freeBytes: null }),
    open: async (project) => (calls.push(`open:${project}`), true),
    put: async (project, key, data) => (files.set(`${project}/${key}`, new Uint8Array(data.slice(0))), true),
    get: async (project, key) => files.get(`${project}/${key}`),
    delete: async (project, keys) => (keys.forEach((k) => files.delete(`${project}/${k}`)), true),
    list: async (project) => Array.from(files).filter(([k]) => k.startsWith(`${project}/`)).map(([k, v]) => ({ key: k.split("/")[1], bytes: v.byteLength })),
    clearProject: async (project) => (Array.from(files.keys()).filter((k) => k.startsWith(`${project}/`)).forEach((k) => files.delete(k)), true),
    clearAll: async () => (files.clear(), true),
    stat: async (paths) => paths.map(() => ({ size: 1, mtimeMs: 1 })),
    usage: async () => ({ bytes: 0, projects: [] }),
  };
  return { bridge, files, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete (window as unknown as { openreel?: unknown }).openreel;
});

describe("projectKeyOf", () => {
  it("is stable, filesystem-safe and distinct per project", () => {
    expect(projectKeyOf("a")).toBe(projectKeyOf("a"));
    expect(projectKeyOf("a")).not.toBe(projectKeyOf("b"));
    expect(projectKeyOf("../../etc/passwd weird id")).toMatch(/^[A-Za-z0-9_-]{1,80}$/);
  });
});

describe("DesktopDiskChunkStore", () => {
  it("maps ChunkStore calls onto the scratch-disk bridge", async () => {
    const { bridge } = fakeBridge();
    const store = new DesktopDiskChunkStore(bridge, "pX");
    await store.put("f1", new Uint8Array([9, 8, 7]).buffer as ArrayBuffer);
    await store.put("__index__", new Uint8Array([1]).buffer as ArrayBuffer);
    expect(new Uint8Array((await store.get("f1")) as ArrayBuffer)).toEqual(new Uint8Array([9, 8, 7]));
    expect(await store.get("f2")).toBeUndefined();
    expect((await store.list()).map((e) => e.key).sort()).toEqual(["__index__", "f1"]);
    await store.delete(["f1"]);
    expect(await store.get("f1")).toBeUndefined();
    await store.clear();
    expect(await store.list()).toEqual([]);
  });
});

describe("DeferredChunkStore", () => {
  it("holds calls until the backend resolves", async () => {
    let open!: (store: MemoryChunkStore) => void;
    const deferred = new DeferredChunkStore(new Promise((resolve) => (open = resolve)));
    const put = deferred.put("f1", new ArrayBuffer(4));
    const store = new MemoryChunkStore();
    open(store);
    await put;
    expect(await store.size()).toBe(4);
    expect((await deferred.list()).length).toBe(1);
  });
});

describe("openRenderCacheBackend", () => {
  it("uses the scratch disk on desktop and tells the main process which project is open", async () => {
    const { bridge, calls } = fakeBridge();
    (window as unknown as { openreel: unknown }).openreel = { platform: "desktop", renderCache: bridge };
    const backend = await openRenderCacheBackend("pX", true);
    expect(backend).toMatchObject({ kind: "desktop-disk", keyPrefix: "", persistent: true });
    expect(calls).toEqual(["open:pX"]);
    expect(backendKeyPrefix("pX")).toBe("");
  });

  it("falls back to an ephemeral memory store when this tab does not own the project", async () => {
    const backend = await openRenderCacheBackend("pX", false);
    expect(backend).toMatchObject({ kind: "memory", persistent: false });
  });
});

describe("render cache preferences", () => {
  it("defaults to capped previews in a browser and full resolution on desktop", () => {
    expect(readRenderCachePrefs().resolution).toBe("1080p");
    (window as unknown as { openreel: unknown }).openreel = { platform: "desktop" };
    expect(readRenderCachePrefs().resolution).toBe("full");
  });

  it("renders in the background by default on desktop only, and honours an explicit choice", () => {
    expect(readRenderCachePrefs().idleRender).toBe(false);
    (window as unknown as { openreel: unknown }).openreel = { platform: "desktop" };
    expect(readRenderCachePrefs().idleRender).toBe(true);
    expect(writeRenderCachePrefs({ idleRender: false }).idleRender).toBe(false);
    expect(readRenderCachePrefs().idleRender).toBe(false);
  });

  it("round-trips, clamps the cap and maps resolution to a width", () => {
    expect(writeRenderCachePrefs({ resolution: "full", webCapBytes: 1 })).toEqual({ resolution: "full", webCapBytes: MIN_WEB_CAP_BYTES, idleRender: false });
    expect(readRenderCachePrefs().resolution).toBe("full");
    expect(writeRenderCachePrefs({ webCapBytes: 1e15 }).webCapBytes).toBe(MAX_WEB_CAP_BYTES);
    expect(maxWidthFor("full")).toBe(Number.POSITIVE_INFINITY);
    expect(maxWidthFor("1080p")).toBe(1920);
    localStorage.setItem("openreel-render-cache-prefs", "{broken");
    expect(readRenderCachePrefs().resolution).toBe("1080p");
  });
});
