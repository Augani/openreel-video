import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import { inputSpaceForItem } from "../color/source-color";
import type { Action } from "../types/actions";
import type { MediaItem, Project } from "../types/project";
import {
  createMediaImageBitmap,
  decodeDng,
  defaultRawSettings,
  inspectDngRaw,
  mediaImageVersion,
  resetRawCachesForTests,
  setRawDeveloper,
  writeDng,
  type RawStillInfo,
} from "./index";

function dngBytes(): Uint8Array<ArrayBuffer> {
  const w = 16;
  const h = 16;
  const samples = new Uint16Array(w * h).map((_, i) => 4000 + (i % 16) * 300);
  return writeDng({
    width: w,
    height: h,
    samples,
    bitsPerSample: 14,
    colorMatrix1: [0.6722, -0.0635, -0.0963, -0.4287, 1.246, 0.2028, -0.0908, 0.2162, 0.5668],
    illuminant1: 21,
    asShotNeutral: [0.5, 1, 0.7],
  });
}

function rawItem(): MediaItem {
  const info: RawStillInfo = inspectDngRaw(decodeDng(dngBytes())).info;
  return {
    id: "raw1",
    name: "IMG_1.dng",
    type: "image",
    fileHandle: null,
    blob: new Blob([dngBytes()]),
    metadata: { duration: 0, width: 16, height: 16, frameRate: 0, codec: "dng", sampleRate: 0, channels: 0, fileSize: 1, hasVideo: false, hasAudio: false },
    thumbnailUrl: null,
    waveformData: null,
    raw: info,
  } as unknown as MediaItem;
}

const project = (): Project =>
  ({
    id: "p",
    name: "P",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [rawItem(), { id: "plain", name: "a.png", type: "image", blob: new Blob([]), metadata: {} } as unknown as MediaItem] },
    timeline: { duration: 0, tracks: [], subtitles: [], markers: [] },
  }) as unknown as Project;

const act = (params: Record<string, unknown>): Action => ({ type: "media/organize", id: `a-${Math.random()}`, timestamp: 0, params });

describe("RAW Source Settings are one undoable step", () => {
  it("applies, clamps, undoes and redoes a whole settings change as a single history entry", async () => {
    const p = project();
    const before = p.mediaLibrary.items[0].raw!.settings!;
    const executor = new ActionExecutor();
    const patch = { temperature: 7200, tint: 12, exposure: 1.5, highlightRecovery: 0.5, demosaic: "high", outputColorSpace: "display-p3" };
    expect((await executor.execute(act({ label: "RAW Source Settings", itemPatches: { raw1: { rawSettings: patch } } }), p)).success).toBe(true);
    expect(p.mediaLibrary.items[0].raw!.settings).toEqual(patch);
    await executor.undo(p);
    expect(p.mediaLibrary.items[0].raw!.settings).toEqual(before);
    await executor.redo(p);
    expect(p.mediaLibrary.items[0].raw!.settings).toEqual(patch);
    await executor.undo(p);
    // Everything came back with ONE undo: nothing else is left to undo.
    expect(p.mediaLibrary.items[0].raw!.settings).toEqual(before);
    expect(await executor.undo(p)).toMatchObject({ success: false });
  });

  it("clamps out-of-range values and rejects items without developable RAW", async () => {
    const p = project();
    const executor = new ActionExecutor();
    await executor.execute(act({ itemPatches: { raw1: { rawSettings: { exposure: 99, temperature: 1 } } } }), p);
    expect(p.mediaLibrary.items[0].raw!.settings).toMatchObject({ exposure: 5, temperature: 2000 });
    const bad = await executor.execute(act({ itemPatches: { plain: { rawSettings: { exposure: 1 } } } }), p);
    expect(bad.success).toBe(false);
  });

  it("the output colour space drives the input transform, so preview and export agree", () => {
    const item = rawItem();
    expect(inputSpaceForItem(item)).toBeNull();
    const p3 = { ...item, raw: { ...item.raw!, settings: { ...item.raw!.settings!, outputColorSpace: "display-p3" as const } } };
    expect(inputSpaceForItem(p3)).toMatchObject({ primaries: "p3", transfer: "srgb" });
    const rec = { ...item, raw: { ...item.raw!, settings: { ...item.raw!.settings!, outputColorSpace: "rec2020" as const } } };
    expect(inputSpaceForItem(rec)).toMatchObject({ primaries: "bt2020", transfer: "srgb" });
  });
});

describe("createMediaImageBitmap", () => {
  const created: Array<{ source: unknown }> = [];
  beforeEach(() => {
    resetRawCachesForTests();
    created.length = 0;
    vi.stubGlobal(
      "ImageData",
      class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );
    vi.stubGlobal("createImageBitmap", async (source: unknown) => {
      created.push({ source });
      return { close() {}, width: (source as { width?: number }).width ?? 0, height: (source as { height?: number }).height ?? 0, source };
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setRawDeveloper(null);
  });

  it("decodes ordinary images directly and develops RAW stills from their settings, once per settings", async () => {
    const plain = { id: "plain", blob: new Blob([new Uint8Array([1])]) };
    await createMediaImageBitmap(plain);
    expect(created[0].source).toBe(plain.blob);

    const item = rawItem();
    const develop = vi.fn(async ({ blob, settings }: { blob: Blob; settings: unknown }) => {
      void blob;
      void settings;
      return { width: 2, height: 2, rgba: new Uint8ClampedArray(16) };
    });
    setRawDeveloper({ develop, inspect: vi.fn() });
    const a = await createMediaImageBitmap(item);
    const b = await createMediaImageBitmap(item);
    expect(develop).toHaveBeenCalledTimes(1);
    expect(a).not.toBe(b);
    const changed = { ...item, raw: { ...item.raw!, settings: { ...defaultRawSettings(decodeDng(dngBytes())), exposure: 1 } } };
    expect(mediaImageVersion(changed)).not.toBe(mediaImageVersion(item));
    await createMediaImageBitmap(changed);
    expect(develop).toHaveBeenCalledTimes(2);
  });

  it("develops with the real in-thread developer and its pixels depend on the settings", async () => {
    const item = rawItem();
    await createMediaImageBitmap(item);
    const dark = created.find((c) => (c.source as { data?: unknown }).data)!.source as { data: Uint8ClampedArray };
    created.length = 0;
    const brighter = { ...item, raw: { ...item.raw!, settings: { ...item.raw!.settings!, exposure: 1 } } };
    await createMediaImageBitmap(brighter);
    const bright = created.find((c) => (c.source as { data?: unknown }).data)!.source as { data: Uint8ClampedArray };
    const mean = (d: Uint8ClampedArray) => d.reduce((s, v) => s + v, 0) / d.length;
    expect(mean(bright.data)).toBeGreaterThan(mean(dark.data));
  });
});
