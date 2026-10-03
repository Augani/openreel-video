import { describe, expect, it } from "vitest";
import type { MediaItem, Track } from "@openreel/core";
import { createEmptyProject } from "./project-helpers";
import { cloneProjectForEdit } from "./clone-project-for-edit";

describe("project edit cloning", () => {
  it("isolates editable tracks while retaining immutable sources and file handles", () => {
    const project = createEmptyProject("Clone");
    const item = {
      id: "source", blob: new Blob(["original"]), waveformData: new Float32Array([0.2]),
      // A handle may have browser methods that cannot be cloned in a plain JS
      // implementation. Timeline edits should not need to serialize it at all.
      fileHandle: { getFile: async () => new File(["original"], "Source.mp4") },
    } as MediaItem;
    const track = { id: "track", name: "Video", type: "video", clips: [], transitions: [], muted: false, locked: false, hidden: false, solo: false } as Track;
    const original = { ...project, timeline: { ...project.timeline, tracks: [track] }, mediaLibrary: { ...project.mediaLibrary, items: [item] } };
    const edited = cloneProjectForEdit(original);
    expect(edited.mediaLibrary).not.toBe(original.mediaLibrary);
    expect(edited.mediaLibrary.items).not.toBe(original.mediaLibrary.items);
    expect(edited.mediaLibrary.items[0]).toBe(item);
    expect(edited.mediaLibrary.items[0].blob).toBe(item.blob);
    expect(edited.mediaLibrary.items[0].fileHandle).toBe(item.fileHandle);
    expect(edited.mediaLibrary.items[0].waveformData).toBe(item.waveformData);
    expect(edited.timeline).not.toBe(original.timeline);
    expect(edited.timeline.tracks).not.toBe(original.timeline.tracks);
    expect(edited.timeline.tracks[0]).not.toBe(original.timeline.tracks[0]);
    expect(edited.timeline.tracks[0].clips).not.toBe(original.timeline.tracks[0].clips);
  });
});
