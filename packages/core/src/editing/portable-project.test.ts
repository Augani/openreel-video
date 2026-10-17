import { describe, it, expect } from "vitest";
import { createPortableEdit, parsePortableEdit, materializePortableEdit, parseEditPreset } from "./portable-project";
import type { Project } from "../types/project";

function project(): Project {
  return { id: "project-1", name: "Shared edit", createdAt: 1, modifiedAt: 1, settings: { width: 640, height: 360, frameRate: 24, sampleRate: 48000, channels: 2 }, mediaLibrary: { items: [{ id: "media-1", name: "sample.mp4", type: "video", blob: new Blob(["sample"]), fileHandle: null, thumbnailUrl: null, waveformData: null, sourceFile: { name: "sample.mp4", size: 6, lastModified: 1 }, metadata: { duration: 4, width: 640, height: 360, frameRate: 24, sampleRate: 48000, channels: 2, fileSize: 6, codec: "avc" } }] }, timeline: { tracks: [{ id: "track-1", type: "video", name: "Video", locked: false, hidden: false, muted: false, solo: false, transitions: [], clips: [{ id: "clip-1", trackId: "track-1", mediaId: "media-1", startTime: 0, duration: 4, inPoint: 0, outPoint: 4, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, opacity: 1, rotation: 0 } }] }], subtitles: [], markers: [], duration: 4 } };
}
describe("portable edit boundary", () => {
  it("roundtrips stable IDs and relinks local files without serializing runtime handles or URLs", () => {
    const before = project(); const json = JSON.stringify(createPortableEdit(before));
    expect(json).not.toMatch(/blob|fileHandle|thumbnailUrl|originalUrl|apiKey/);
    const restored = materializePortableEdit(parsePortableEdit(json), before);
    expect(restored.missing).toEqual([]);
    expect(restored.project.timeline).toEqual(before.timeline);
    expect(restored.project.mediaLibrary.items[0].blob).toBe(before.mediaLibrary.items[0].blob);
  });
  it("retains standard track metadata and accepts media on a universal track", () => {
    const before = project();
    before.timeline.tracks[0] = { ...before.timeline.tracks[0], type: "audio", mode: "standard", role: "captions", groupId: "group-1" };
    const doc = parsePortableEdit(JSON.stringify(createPortableEdit(before)));
    expect(materializePortableEdit(doc, before).project.timeline).toEqual(before.timeline);
    expect(() => parsePortableEdit(JSON.stringify({ ...doc, project: { ...doc.project, timeline: { ...doc.project.timeline, tracks: [{ ...doc.project.timeline.tracks[0], mode: "unknown" }] } } }))).toThrow();
    before.timeline.tracks[0] = { ...before.timeline.tracks[0], mode: undefined };
    expect(() => createPortableEdit(before)).toThrow(/incompatible media/);
  });
  it("creates explicit missing-media placeholders and can match uniquely renamed IDs by file hint", () => {
    const before = project(); const doc = createPortableEdit(before);
    expect(materializePortableEdit(doc, { ...before, mediaLibrary: { items: [] } }).missing).toEqual(["media-1"]);
    const other = { ...before.mediaLibrary.items[0], id: "new-media-id" };
    expect(materializePortableEdit(doc, { ...before, mediaLibrary: { items: [other] } }).missing).toEqual([]);
  });
  it("migrates v1 asset references", () => {
    const doc = createPortableEdit(project()); const { media, ...rest } = doc.project;
    const migrated = parsePortableEdit(JSON.stringify({ ...doc, version: 1, project: { ...rest, assets: media } }));
    expect(migrated.version).toBe(2); expect(migrated.project.media).toEqual(media);
  });
  it("rejects source ranges that exceed the actual locally linked media", () => {
    const before = project(); const doc = createPortableEdit(before);
    const shortAsset = { ...before.mediaLibrary.items[0], metadata: { ...before.mediaLibrary.items[0].metadata, duration: 1 } };
    expect(() => materializePortableEdit(doc, { ...before, mediaLibrary: { items: [shortAsset] } })).toThrow(/source range/);
  });
  it.each(["instructions", "apiKey", "originalUrl", "script", "__proto__"])("rejects unknown or executable property %s", (property) => {
    const text = JSON.stringify(createPortableEdit(project())).replace('"name":"Shared edit"', `"name":"Shared edit","${property}":"untrusted"`);
    expect(() => parsePortableEdit(text)).toThrow();
  });
  it("rejects missing transforms, duplicate IDs, dangling references and source overflow", () => {
    for (const mutate of [(p: ReturnType<typeof createPortableEdit>) => { p.project.timeline.tracks[0].clips[0] = { ...p.project.timeline.tracks[0].clips[0], id: "track-1" }; }, (p: ReturnType<typeof createPortableEdit>) => { p.project.timeline.tracks[0].clips[0] = { ...p.project.timeline.tracks[0].clips[0], mediaId: "unknown" }; }, (p: ReturnType<typeof createPortableEdit>) => { p.project.timeline.tracks[0].clips[0] = { ...p.project.timeline.tracks[0].clips[0], outPoint: 999 }; }]) {
      const doc = createPortableEdit(project()); mutate(doc); expect(() => parsePortableEdit(JSON.stringify(doc))).toThrow();
    }
  });
  it("rejects unknown versions, oversized files and shader presets", () => {
    expect(() => parsePortableEdit(JSON.stringify({ ...createPortableEdit(project()), version: 99 }))).toThrow();
    expect(() => parsePortableEdit(" ".repeat(5_000_001))).toThrow(/5 MB/);
    expect(() => parseEditPreset(JSON.stringify({ format: "openreel-preset", version: 1, name: "Unsafe", effects: [{ id: "effect-1", type: "shader", enabled: true, params: { code: "bad" } }] }))).toThrow();
  });
});
