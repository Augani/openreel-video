import { describe, expect, it, vi } from "vitest";
import { ActionExecutor, snapshotProjectForInverse } from "./action-executor";
import { buildBenchProject } from "../perf/bench-project";

describe("edit snapshot cost", () => {
  it("shares immutable media payloads instead of copying them", () => {
    const project = buildBenchProject({ clips: 16, tracks: 2, textItems: 2, waveformSamples: 1000 });
    const snapshot = snapshotProjectForInverse(project);
    expect(snapshot.timeline).not.toBe(project.timeline);
    expect(snapshot.timeline).toEqual(project.timeline);
    expect(snapshot.mediaLibrary.items[0].waveformData).toBe(project.mediaLibrary.items[0].waveformData);
    expect(snapshot.mediaLibrary.items[0].filmstripThumbnails).toBe(project.mediaLibrary.items[0].filmstripThumbnails);
  });

  it("never serializes waveforms for generic edits and keeps exact undo/redo", async () => {
    const project = buildBenchProject({ clips: 16, tracks: 2, textItems: 2, waveformSamples: 1000 });
    const toJSON = vi.fn(() => []);
    Object.defineProperty(project.mediaLibrary.items[0].waveformData, "toJSON", { value: toJSON });
    const stringify = vi.spyOn(JSON, "stringify");
    const executor = new ActionExecutor();
    const before = structuredClone(project.timeline);

    expect((await executor.execute({ id: "move", type: "clip/move", timestamp: 1, params: { clipId: "clip-1", startTime: 40 } }, project)).success).toBe(true);
    expect((await executor.execute({ id: "remove", type: "clip/remove", timestamp: 2, params: { clipId: "clip-2" } }, project)).success).toBe(true);
    expect(toJSON).not.toHaveBeenCalled();
    stringify.mockRestore();

    await executor.undo(project);
    await executor.undo(project);
    const byId = (clips: { id: string }[]) => [...clips].sort((a, b) => a.id.localeCompare(b.id));
    expect(project.timeline.tracks.map((t) => byId(t.clips))).toEqual(before.tracks.map((t: { clips: { id: string }[] }) => byId(t.clips)));
    await executor.redo(project);
    await executor.redo(project);
    expect(project.timeline.tracks.flatMap((t) => t.clips).some((c) => c.id === "clip-2")).toBe(false);
  });

  it("falls back to a JSON copy when the project holds non-cloneable values", () => {
    const project = buildBenchProject({ clips: 4, tracks: 1, textItems: 0, waveformSamples: 10 });
    (project.timeline.tracks[0].clips[0] as unknown as Record<string, unknown>).callback = () => 1;
    const snapshot = snapshotProjectForInverse(project);
    expect(snapshot.timeline.tracks[0].clips).toHaveLength(project.timeline.tracks[0].clips.length);
    expect(snapshot.timeline).not.toBe(project.timeline);
  });
});
