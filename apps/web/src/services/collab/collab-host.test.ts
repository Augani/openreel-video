import { describe, it, expect } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { cloneProject, mergeLocalMedia, serializeProjectForWire, wireMediaItem } from "./collab-host";

const blob = new Blob(["abc"], { type: "video/mp4" });
const item = (over: Partial<MediaItem> = {}): MediaItem =>
  ({
    id: "m1",
    name: "a.mp4",
    type: "video",
    fileHandle: null,
    blob,
    metadata: { duration: 1 },
    thumbnailUrl: "blob:thumb",
    waveformData: new Float32Array([0.1, 0.2]),
    ...over,
  }) as unknown as MediaItem;
const project = (items: MediaItem[]): Project =>
  ({ id: "p", name: "P", settings: {}, timeline: { tracks: [{ id: "t1", clips: [{ id: "c1", startTime: 0 }] }], markers: [], duration: 1 }, mediaLibrary: { items } }) as unknown as Project;

describe("media over the wire", () => {
  it("sends metadata and a file hint but never the file, thumbnail or waveform", () => {
    const wire = wireMediaItem(item({ sourceFile: { name: "a.mp4", size: 3, lastModified: 7 } }));
    expect(wire).toMatchObject({ id: "m1", name: "a.mp4", isPlaceholder: true, blob: null, thumbnailUrl: null, waveformData: null, sourceFile: { name: "a.mp4", size: 3, lastModified: 7 } });
  });

  it("derives a file hint when the item has none", () => {
    const wire = wireMediaItem(item());
    expect(wire.sourceFile).toMatchObject({ name: "a.mp4", size: 3 });
  });

  it("serializes a whole project as plain JSON", () => {
    const json = JSON.stringify(serializeProjectForWire(project([item()])));
    expect(json).not.toContain("blob:thumb");
    expect(JSON.parse(json).mediaLibrary.items[0].isPlaceholder).toBe(true);
  });
});

describe("cloning and merging", () => {
  it("clones deeply but shares media runtime data", () => {
    const original = project([item()]);
    const copy = cloneProject(original);
    copy.timeline.tracks[0].clips[0] = { ...copy.timeline.tracks[0].clips[0], startTime: 9 };
    expect((original.timeline.tracks[0].clips[0] as { startTime: number }).startTime).toBe(0);
    expect(copy.mediaLibrary.items[0].blob).toBe(blob);
    expect(copy.mediaLibrary.items[0]).not.toBe(original.mediaLibrary.items[0]);
  });

  it("keeps locally relinked media when a rebuilt project replaces the live one", () => {
    const rebuilt = project([wireMediaItem(item())]);
    const live = project([item(), item({ id: "local-only", name: "b.mp4" })]);
    const merged = mergeLocalMedia(rebuilt, live);
    const m1 = merged.mediaLibrary.items.find((i) => i.id === "m1")!;
    expect(m1.blob).toBe(blob);
    expect(m1.isPlaceholder).toBe(false);
    expect(merged.mediaLibrary.items.map((i) => i.id)).toEqual(["m1", "local-only"]);
  });

  it("leaves a media item a placeholder when the local copy is one too", () => {
    const rebuilt = project([wireMediaItem(item())]);
    const live = project([wireMediaItem(item())]);
    expect(mergeLocalMedia(rebuilt, live).mediaLibrary.items[0].isPlaceholder).toBe(true);
  });

  it("takes shared edits to a media item (rename, bin) while keeping the local file", () => {
    const rebuilt = project([wireMediaItem(item({ name: "renamed.mp4", binId: "b1" }))]);
    const merged = mergeLocalMedia(rebuilt, project([item()]));
    expect(merged.mediaLibrary.items[0]).toMatchObject({ name: "renamed.mp4", binId: "b1", blob });
  });
});
