import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { MediaItem, Project } from "../types/project";
import type { Clip } from "../types/timeline";
import {
  MEDIA_LABELS,
  binDeletionImpact,
  binPath,
  binSubtreeIds,
  computeMediaUsage,
  createSubclipItem,
  filterMediaItems,
  formatMediaDuration,
  mediaTrimBounds,
  normalizeBins,
  parseMediaLabel,
  resolveClipLabel,
  sortMediaItems,
  uniqueBinName,
} from "./bins";
import { normalizeProjectBins, normalizeProjectSmartBins } from "../storage/project-serializer";
import { normalizeSmartBins, savableSmartBinSearch, smartBinCounts, smartBinItems, uniqueSmartBinName } from "./smart-bins";
import { createMediaClip } from "../editing/premiere-edits";
import { planSourceEdit } from "../editing/source-edit";
import { prepareTimelineToolEdit } from "../editing/timeline-tool-edit";

function media(id: string, over: Partial<MediaItem> & { duration?: number } = {}): MediaItem {
  const { duration = 10, ...rest } = over;
  return {
    id,
    name: `${id}.mp4`,
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: {
      duration,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      sampleRate: 48000,
      channels: 2,
      fileSize: 1000,
    },
    thumbnailUrl: null,
    waveformData: null,
    ...rest,
  };
}

function clip(id: string, mediaId: string, over: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaId,
    trackId: "t1",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      anchor: { x: 0.5, y: 0.5 },
      rotation: 0,
      opacity: 1,
      fitMode: "contain",
    },
    volume: 1,
    keyframes: [],
    ...over,
  } as Clip;
}

function project(items: MediaItem[], clips: Clip[] = []): Project {
  return {
    id: "p",
    name: "P",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items },
    timeline: {
      duration: 5,
      tracks: [
        { id: "t1", type: "video", name: "V1", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false },
      ],
      subtitles: [],
      markers: [],
    },
  } as unknown as Project;
}

const act = (type: string, params: Record<string, unknown>): Action => ({
  type,
  id: `a-${Math.random()}`,
  timestamp: Date.now(),
  params,
});

describe("labels", () => {
  it("ships at least 8 distinct label colours", () => {
    expect(MEDIA_LABELS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(MEDIA_LABELS.map((l) => l.color)).size).toBe(MEDIA_LABELS.length);
  });
  it("parses ids, names and none", () => {
    expect(parseMediaLabel("Mango")).toBe("mango");
    expect(parseMediaLabel("none")).toBeNull();
    expect(parseMediaLabel("chartreuse")).toBeUndefined();
  });
  it("clip label defaults to the media label; null means none", () => {
    const m = media("a", { label: "rose" });
    expect(resolveClipLabel({}, m)).toBe("rose");
    expect(resolveClipLabel({ label: "blue" }, m)).toBe("blue");
    expect(resolveClipLabel({ label: null }, m)).toBeNull();
  });
});

describe("bin tree", () => {
  const bins = [
    { id: "a", name: "A" },
    { id: "b", name: "B", parentId: "a" },
    { id: "c", name: "C", parentId: "b" },
    { id: "d", name: "D" },
  ];
  it("computes paths, subtrees and unique names", () => {
    expect(binPath(bins, "c").map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect([...binSubtreeIds(bins, "a")].sort()).toEqual(["a", "b", "c"]);
    expect(uniqueBinName(bins, undefined, "A")).toBe("A 2");
  });
  it("repairs orphans, duplicates and cycles", () => {
    const fixed = normalizeBins([
      { id: "x", name: "X", parentId: "ghost" },
      { id: "y", name: "Y", parentId: "z" },
      { id: "z", name: "Z", parentId: "y" },
      { id: "x", name: "dup" },
    ])!;
    expect(fixed.map((b) => b.id)).toEqual(["x", "y", "z"]);
    expect(fixed.find((b) => b.id === "x")!.parentId).toBeUndefined();
    // the loop is broken: at least one of y / z is a root
    expect(fixed.filter((b) => b.id !== "x" && !b.parentId).length).toBeGreaterThanOrEqual(1);
  });
  it("old projects stay untouched; dangling binIds hoist to root", () => {
    const old = project([media("m")]);
    expect(normalizeProjectBins(old)).toBe(old);
    const dangling = { ...project([media("m", { binId: "nope" })]), bins: [{ id: "a", name: "A" }] } as Project;
    const fixed = normalizeProjectBins(dangling);
    expect(fixed.mediaLibrary.items[0].binId).toBeUndefined();
    expect(fixed.bins).toHaveLength(1);
  });
});

describe("table: sort, filter, usage", () => {
  const items = [
    media("long", { duration: 100, label: "blue", comment: "hero shot" }),
    media("short", { duration: 2 }),
    media("mid", { duration: 30, label: "rose", type: "audio" }),
  ];
  const p = project(items, [clip("c1", "short"), clip("c2", "short"), clip("c3", "mid")]);
  const ctx = { usage: computeMediaUsage(p) };

  it("counts usage per media", () => {
    expect(ctx.usage.get("short")).toBe(2);
    expect(ctx.usage.get("mid")).toBe(1);
    expect(ctx.usage.get("long")).toBeUndefined();
  });
  it("sorts numerically by duration, both directions", () => {
    expect(sortMediaItems(items, "duration", "asc", ctx).map((i) => i.id)).toEqual(["short", "mid", "long"]);
    expect(sortMediaItems(items, "duration", "desc", ctx).map((i) => i.id)).toEqual(["long", "mid", "short"]);
  });
  it("sorts by usage and keeps unlabelled last", () => {
    expect(sortMediaItems(items, "usage", "desc", ctx)[0].id).toBe("short");
    expect(sortMediaItems(items, "label", "asc", ctx).map((i) => i.id)).toEqual(["mid", "long", "short"]);
    expect(sortMediaItems(items, "label", "desc", ctx).at(-1)!.id).toBe("short");
  });
  it("filters on any column or a chosen one", () => {
    expect(filterMediaItems(items, "hero", "all", ctx).map((i) => i.id)).toEqual(["long"]);
    expect(filterMediaItems(items, "hero", "name", ctx)).toHaveLength(0);
    expect(filterMediaItems(items, "rose", "label", ctx).map((i) => i.id)).toEqual(["mid"]);
    expect(filterMediaItems(items, "audio", "type", ctx).map((i) => i.id)).toEqual(["mid"]);
    expect(filterMediaItems(items, "1920 x 1080 blue", "all", ctx).map((i) => i.id)).toEqual(["long"]);
  });
  it("formats timecode", () => {
    expect(formatMediaDuration(61.5, 30)).toBe("00:01:01:15");
    expect(formatMediaDuration(0, 30)).toBe("");
  });
});

describe("subclips", () => {
  const parent = media("src", { duration: 20, binId: "bin1" });
  it("creates a window over the parent sharing its file", () => {
    const sub = createSubclipItem([parent], parent, { id: "s1", inPoint: 4, outPoint: 9, restrictTrims: true });
    expect(sub.subclip).toEqual({ parentId: "src", inPoint: 4, outPoint: 9, restrictTrims: true });
    expect(sub.metadata.duration).toBe(20);
    expect(sub.binId).toBe("bin1");
    expect(sub.name).not.toBe(parent.name);
  });
  it("re-subclipping a subclip refers to the root parent", () => {
    const sub = createSubclipItem([parent], parent, { id: "s1", inPoint: 4, outPoint: 9 });
    const sub2 = createSubclipItem([parent, sub], sub, { id: "s2", inPoint: 5, outPoint: 6 });
    expect(sub2.subclip!.parentId).toBe("src");
  });
  it("rejects empty ranges and stills", () => {
    expect(() => createSubclipItem([parent], parent, { id: "s", inPoint: 5, outPoint: 5 })).toThrow();
    const still = media("img", { type: "image" });
    expect(() => createSubclipItem([still], still, { id: "s", inPoint: 0, outPoint: 1 })).toThrow();
  });
  it("places its own window by default and from Source marks fallbacks", () => {
    const sub = createSubclipItem([parent], parent, { id: "s1", inPoint: 4, outPoint: 9 });
    const c = createMediaClip(sub, "t1", "c");
    expect([c.inPoint, c.outPoint, c.duration]).toEqual([4, 9, 5]);
    const p = project([parent, sub]);
    const planned = planSourceEdit(p, {
      mode: "insert",
      media: sub,
      trackId: "t1",
      clipId: "ins",
      operationId: "op",
      playhead: 0,
    });
    expect([planned.resolved.sourceIn, planned.resolved.sourceOut]).toEqual([4, 9]);
  });
  it("restricted subclips clamp Source marks to the window", () => {
    const sub = createSubclipItem([parent], parent, { id: "s1", inPoint: 4, outPoint: 9, restrictTrims: true });
    const planned = planSourceEdit(project([parent, sub]), {
      mode: "overwrite",
      media: sub,
      trackId: "t1",
      clipId: "ins",
      operationId: "op",
      sourceIn: 1,
      sourceOut: 15,
      playhead: 0,
    });
    expect([planned.resolved.sourceIn, planned.resolved.sourceOut]).toEqual([4, 9]);
  });
  it("exposes trim bounds only when restricted", () => {
    const open = createSubclipItem([parent], parent, { id: "s1", inPoint: 4, outPoint: 9 });
    const locked = createSubclipItem([parent], parent, { id: "s2", inPoint: 4, outPoint: 9, restrictTrims: true });
    expect(mediaTrimBounds(open)).toBeNull();
    expect(mediaTrimBounds(locked)).toEqual({ min: 4, max: 9 });
  });
  it("restricted subclips cap slip / ripple handles at the window edges", () => {
    const sub = createSubclipItem([parent], parent, { id: "s1", inPoint: 4, outPoint: 9, restrictTrims: true });
    const free = createSubclipItem([parent], parent, { id: "s2", inPoint: 4, outPoint: 9 });
    const c = clip("c", "s1", { inPoint: 4, outPoint: 9, duration: 5 });
    const cFree = clip("cf", "s2", { inPoint: 4, outPoint: 9, duration: 5 });
    const p = project([parent, sub, free], [c, cFree]);
    // Requested 2s extension: granted into the parent file when unrestricted,
    // clamped to zero handles when restricted. The plan reports the applied delta.
    const extendRight = (id: string) =>
      prepareTimelineToolEdit(p, { mode: "ripple", itemId: id, edge: "right" }).plan(2).delta;
    expect(extendRight("cf")).toBeCloseTo(2, 5);
    expect(extendRight("c")).toBeCloseTo(0, 5);
    const slip = (id: string, delta: number) =>
      prepareTimelineToolEdit(p, { mode: "slip", itemId: id }).plan(delta).delta;
    expect(slip("c", -1)).toBeCloseTo(0, 5);
    expect(slip("cf", -1)).toBeCloseTo(-1, 5);
  });
});

describe("media/organize action", () => {
  const items = [media("a"), media("b"), media("c")];

  function setup() {
    const p = project(items.map((i) => ({ ...i })), [clip("c1", "a"), clip("c2", "b")]);
    const executor = new ActionExecutor();
    return { p, executor };
  }

  it("creates bins, moves items and undoes each as one step", async () => {
    const { p, executor } = setup();
    expect(p.bins).toBeUndefined();
    let r = await executor.execute(
      act("media/organize", { label: "New bin", bins: [{ id: "b1", name: "Interviews" }] }),
      p,
    );
    expect(r.success).toBe(true);
    r = await executor.execute(
      act("media/organize", { label: "Move", itemPatches: { a: { binId: "b1" }, b: { binId: "b1" } } }),
      p,
    );
    expect(r.success).toBe(true);
    expect(p.mediaLibrary.items.filter((i) => i.binId === "b1").map((i) => i.id)).toEqual(["a", "b"]);
    await executor.undo(p);
    expect(p.mediaLibrary.items.every((i) => i.binId === undefined)).toBe(true);
    expect(p.bins).toHaveLength(1);
    await executor.undo(p);
    expect(p.bins).toBeUndefined();
    await executor.redo(p);
    expect(p.bins).toHaveLength(1);
  });

  it("rejects unknown bins, cycles and bad labels", async () => {
    const { p, executor } = setup();
    expect((await executor.execute(act("media/organize", { itemPatches: { a: { binId: "ghost" } } }), p)).success).toBe(false);
    expect(
      (await executor.execute(act("media/organize", { bins: [{ id: "x", name: "X", parentId: "y" }, { id: "y", name: "Y", parentId: "x" }] }), p)).success,
    ).toBe(false);
    expect((await executor.execute(act("media/organize", { itemPatches: { a: { label: "chartreuse" } } }), p)).success).toBe(false);
  });

  it("labels media and clips, then restores prior values on undo", async () => {
    const { p, executor } = setup();
    await executor.execute(
      act("media/organize", { itemPatches: { a: { label: "rose", comment: "keep" } }, clipLabels: { c1: "blue" } }),
      p,
    );
    expect(p.mediaLibrary.items[0].label).toBe("rose");
    expect(p.mediaLibrary.items[0].comment).toBe("keep");
    expect(p.timeline.tracks[0].clips[0].label).toBe("blue");
    await executor.undo(p);
    expect(p.mediaLibrary.items[0].label).toBeUndefined();
    expect(p.mediaLibrary.items[0].comment).toBeUndefined();
    expect(p.timeline.tracks[0].clips[0].label).toBeUndefined();
  });

  it("refuses to delete clips that sit on a locked track", async () => {
    const { p, executor } = setup();
    await executor.execute(act("media/organize", { bins: [{ id: "b1", name: "B" }], itemPatches: { a: { binId: "b1" } } }), p);
    (p.timeline.tracks[0] as { locked: boolean }).locked = true;
    const r = await executor.execute(
      act("media/organize", { bins: [], removeItemIds: ["a"], removeClips: true }),
      p,
    );
    expect(r.success).toBe(false);
    expect(p.mediaLibrary.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(p.timeline.tracks[0].clips).toHaveLength(2);
  });

  it("a subclip made from a root-level subclip does not inherit the root's bin", () => {
    const root = { ...media("a"), binId: "b1" };
    const first = { ...createSubclipItem([root], root, { id: "s1", inPoint: 1, outPoint: 4 }), binId: undefined } as MediaItem;
    delete (first as { binId?: string }).binId;
    const second = createSubclipItem([root, first], first, { id: "s2", inPoint: 2, outPoint: 3 });
    expect(second.binId).toBeUndefined();
  });

  it("adds a subclip and removes it on undo in one step", async () => {
    const { p, executor } = setup();
    const sub = createSubclipItem(p.mediaLibrary.items, p.mediaLibrary.items[0], { id: "sub1", inPoint: 1, outPoint: 3 });
    await executor.execute(act("media/organize", { label: "Make subclip", addItems: [sub] }), p);
    expect(p.mediaLibrary.items.map((i) => i.id)).toContain("sub1");
    await executor.undo(p);
    expect(p.mediaLibrary.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("deleting a bin with contents removes items and their clips; undo restores order", async () => {
    const { p, executor } = setup();
    await executor.execute(act("media/organize", { bins: [{ id: "b1", name: "B" }], itemPatches: { a: { binId: "b1" }, c: { binId: "b1" } } }), p);
    const impact = binDeletionImpact(p, "b1");
    expect(impact.mediaIds).toEqual(["a", "c"]);
    expect(impact.clipCount).toBe(1);
    const r = await executor.execute(
      act("media/organize", { label: "Delete bin", bins: [], removeItemIds: impact.mediaIds, removeClips: true }),
      p,
    );
    expect(r.success).toBe(true);
    expect(p.mediaLibrary.items.map((i) => i.id)).toEqual(["b"]);
    expect(p.timeline.tracks[0].clips.map((c) => c.id)).toEqual(["c2"]);
    await executor.undo(p);
    expect(p.mediaLibrary.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(p.timeline.tracks[0].clips.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(p.bins).toHaveLength(1);
    expect(p.mediaLibrary.items[0].binId).toBe("b1");
  });

  it("adding a clip of a subclip uses the window; restricted trims are validated", async () => {
    const { p, executor } = setup();
    const sub = createSubclipItem(p.mediaLibrary.items, p.mediaLibrary.items[0], { id: "sub1", inPoint: 2, outPoint: 6, restrictTrims: true });
    await executor.execute(act("media/organize", { addItems: [sub] }), p);
    await executor.execute(act("clip/add", { clipId: "n1", trackId: "t1", mediaId: "sub1", startTime: 20 }), p);
    const added = p.timeline.tracks[0].clips.find((c) => c.id === "n1")!;
    expect([added.inPoint, added.outPoint, added.duration]).toEqual([2, 6, 4]);
    const bad = await executor.execute(act("clip/trim", { clipId: "n1", inPoint: 1, outPoint: 6 }), p);
    expect(bad.success).toBe(false);
    const good = await executor.execute(act("clip/trim", { clipId: "n1", inPoint: 3, outPoint: 6 }), p);
    expect(good.success).toBe(true);
  });
});

describe("large libraries", () => {
  it("sorts and filters 2,000 items well inside a frame budget", () => {
    const items = Array.from({ length: 2000 }, (_, i) =>
      media(`m${i}`, { duration: 1 + ((i * 37) % 600) / 3, comment: i % 10 === 0 ? `take ${i}` : undefined }),
    );
    const ctx = { usage: new Map<string, number>() };
    const t0 = performance.now();
    const sorted = sortMediaItems(items, "duration", "desc", ctx);
    const t1 = performance.now();
    const filtered = filterMediaItems(items, "take 19", "all", ctx);
    const t2 = performance.now();
    expect(sorted[0].metadata.duration).toBeGreaterThanOrEqual(sorted[1999].metadata.duration);
    expect(filtered.length).toBeGreaterThan(0);
    expect(t1 - t0).toBeLessThan(250);
    expect(t2 - t1).toBeLessThan(250);
  });
});

describe("logging metadata and smart bins", () => {
  const library = () => [
    media("a", { scene: "12", shot: "A", take: "1", description: "Wide, rain" }),
    media("b", { scene: "12", shot: "B", take: "3", goodTake: true, description: "Close on hands" }),
    media("c", { scene: "14", shot: "A", take: "2", goodTake: true }),
    media("d"),
  ];
  const ctx = { usage: new Map<string, number>() };

  it("searches scene / shot / take / good take / log note across all columns", () => {
    const items = library();
    expect(filterMediaItems(items, "rain", "all", ctx).map((i) => i.id)).toEqual(["a"]);
    expect(filterMediaItems(items, "14", "all", ctx).map((i) => i.id)).toEqual(["c"]);
    expect(filterMediaItems(items, "good", "all", ctx).map((i) => i.id)).toEqual(["b", "c"]);
    expect(filterMediaItems(items, "x", "scene", ctx)).toEqual([]);
    expect(filterMediaItems(items, "scene:12 good:yes", "all", ctx).map((i) => i.id)).toEqual(["b"]);
    expect(filterMediaItems(items, "scene:12 good:no", "all", ctx).map((i) => i.id)).toEqual(["a"]);
    // A prefix that is not a column name is plain text.
    expect(filterMediaItems(items, "nope:1", "all", ctx)).toEqual([]);
  });

  it("sorts by the new columns", () => {
    const items = library();
    expect(sortMediaItems(items, "take", "asc", ctx).map((i) => i.id)).toEqual(["d", "a", "c", "b"]);
    expect(sortMediaItems(items, "goodTake", "desc", ctx).map((i) => i.id).slice(0, 2)).toEqual(["b", "c"]);
  });

  it("patches scene/shot/take/goodTake as one undoable step; '' and false clear the field", async () => {
    const p = project(library(), []);
    const executor = new ActionExecutor();
    const r = await executor.execute(
      act("media/organize", {
        label: "Edit log",
        itemPatches: { a: { scene: "20", goodTake: true }, b: { take: "", goodTake: false }, d: { shot: "Z" } },
      }),
      p,
    );
    expect(r.success).toBe(true);
    const byId = (id: string) => p.mediaLibrary.items.find((i) => i.id === id)!;
    expect(byId("a")).toMatchObject({ scene: "20", goodTake: true });
    expect(byId("b").take).toBeUndefined();
    expect(byId("b").goodTake).toBeUndefined();
    expect(byId("d").shot).toBe("Z");
    await executor.undo(p);
    expect(byId("a")).toMatchObject({ scene: "12" });
    expect(byId("a").goodTake).toBeUndefined();
    expect(byId("b")).toMatchObject({ take: "3", goodTake: true });
    expect(byId("d").shot).toBeUndefined();
  });

  it("smart bins are live: contents and counts follow metadata changes; undo restores the list", async () => {
    const p = project(library(), []);
    const executor = new ActionExecutor();
    expect(p.smartBins).toBeUndefined();
    const bin = { id: "s1", name: "Good takes, scene 12", query: "scene:12 good:yes", column: "all" };
    expect((await executor.execute(act("media/organize", { label: "New smart bin", smartBins: [bin] }), p)).success).toBe(true);
    expect(smartBinItems(p.mediaLibrary.items, bin, ctx).map((i) => i.id)).toEqual(["b"]);
    await executor.execute(act("media/organize", { itemPatches: { a: { goodTake: true } } }), p);
    expect(smartBinItems(p.mediaLibrary.items, bin, ctx).map((i) => i.id)).toEqual(["a", "b"]);
    expect(smartBinCounts(p.mediaLibrary.items, p.smartBins ?? [], ctx).get("s1")).toBe(2);
    await executor.undo(p);
    expect(smartBinItems(p.mediaLibrary.items, bin, ctx).map((i) => i.id)).toEqual(["b"]);
    await executor.undo(p);
    expect(p.smartBins).toBeUndefined();
    await executor.redo(p);
    expect(p.smartBins).toHaveLength(1);
  });

  it("validates smart bins", async () => {
    const p = project(library(), []);
    const executor = new ActionExecutor();
    const run = (smartBins: unknown) => executor.execute(act("media/organize", { smartBins }), p);
    expect((await run([{ id: "x", name: "X", query: "", column: "all" }])).success).toBe(false);
    expect((await run([{ id: "x", name: "X", query: "a", column: "bogus" }])).success).toBe(false);
    expect((await run([{ id: "x", name: "X", query: "a", column: "all" }, { id: "x", name: "Y", query: "b", column: "all" }])).success).toBe(false);
    expect(p.smartBins).toBeUndefined();
  });

  it("saving a search typed inside a smart bin saves the narrowed search, or nothing when it cannot be exact", () => {
    const active = { query: "scene:12", column: "all" };
    expect(savableSmartBinSearch(null, " rain ", "description")).toEqual({ query: "rain", column: "description" });
    expect(savableSmartBinSearch(active, "good:yes", "all")).toEqual({ query: "scene:12 good:yes", column: "all" });
    expect(savableSmartBinSearch(active, "good:yes", "scene")).toBeNull();
    expect(savableSmartBinSearch(active, "  ", "all")).toBeNull();
    const saved = savableSmartBinSearch(active, "good:yes", "all")!;
    // The saved bin matches exactly what the narrowed view showed.
    expect(smartBinItems(library(), saved, ctx).map((i) => i.id)).toEqual(
      filterMediaItems(smartBinItems(library(), active, ctx), "good:yes", "all", ctx).map((i) => i.id),
    );
  });

  it("an empty query matches nothing; names are made unique; old projects load unchanged", () => {
    expect(smartBinItems(library(), { query: "  ", column: "all" }, ctx)).toEqual([]);
    expect(uniqueSmartBinName([{ id: "1", name: "Smart bin", query: "a", column: "all" }])).toBe("Smart bin 2");
    const old = project(library(), []);
    expect(normalizeProjectSmartBins(old)).toBe(old);
    expect(normalizeSmartBins([{ id: "1", name: " A ", query: "q", column: "nope" }, { id: "1", name: "dup", query: "q" }, null])).toEqual([
      { id: "1", name: "A", query: "q", column: "all" },
    ]);
  });
});
