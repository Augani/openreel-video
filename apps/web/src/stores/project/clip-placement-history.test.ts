import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionExecutor, type Action, type MediaItem } from "@openreel/core";
import { useProjectStore } from "../project-store";
import { useUIStore } from "../ui-store";
import { useTimelineStore } from "../timeline-store";
import { createEmptyProject } from "./project-helpers";
const state = () => useProjectStore.getState();
const item = (id: string): MediaItem => ({ id, name: `${id}.png`, type: "image", blob: new Blob([id]), fileHandle: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration: 0, width: 1920, height: 1080, frameRate: 0, codec: "png", sampleRate: 0, channels: 0, fileSize: id.length } });
function load() {
  const project = createEmptyProject("Background placement");
  state().loadProject({ ...project, mediaLibrary: { items: [item("first"), item("second")] } });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function holdTrack() {
  const started = deferred<void>(), gate = deferred<void>(); const execute = ActionExecutor.prototype.execute; let held = false;
  vi.spyOn(ActionExecutor.prototype, "execute").mockImplementation(async function(this: ActionExecutor, action: Action, project) {
    const result = await execute.call(this, action, project);
    if (!held && action.type === "track/add") { held = true; started.resolve(); await gate.promise; }
    return result;
  });
  return { started: started.promise, release: () => gate.resolve() };
}
beforeEach(() => { load(); useUIStore.setState({ exportState: { isExporting: false, progress: 0, phase: "idle" } }); useTimelineStore.setState({ playbackLockedReason: null }); });
afterEach(() => { vi.restoreAllMocks(); });

describe("new-track clip placement", () => {
  it("publishes once and restores the exact clip and track with one Undo/Redo", async () => {
    const before = state().project; const trackIds = before.timeline.tracks.map(t => t.id);
    const published = vi.fn(); const stop = useProjectStore.subscribe((next, previous) => { if (next.project !== previous.project) published(); });
    expect((await state().addClipToNewTrack("first", 2)).success).toBe(true); stop();
    const track = state().project.timeline.tracks.at(-1)!; const clip = track.clips[0];
    expect(clip).toMatchObject({ mediaId: "first", startTime: 2, duration: 5 });
    expect(state().project.mediaLibrary.items[0].blob).toBe(before.mediaLibrary.items[0].blob);
    expect(published).toHaveBeenCalledTimes(1);
    await state().undo();
    expect(state().project.timeline.tracks.map(t => t.id)).toEqual(trackIds);
    expect(state().canUndo()).toBe(false);
    await state().redo();
    expect(state().project.timeline.tracks.at(-1)).toEqual(track);
  });
  it("does not leave a track or history when clip placement is invalid", async () => {
    const before = state().project;
    expect((await state().addClipToNewTrack("first", -1)).success).toBe(false);
    expect(state().project).toBe(before); expect(state().canUndo()).toBe(false);
  });
  it.each([false, true])("does not replace a new editing session (same id: %s)", async sameId => {
    const held = holdTrack(); const pending = state().addClipToNewTrack("first"); await held.started;
    if (sameId) state().loadProject({ ...state().project }); else load();
    const replacement = state().project; const owner = state().actionExecutor;
    held.release(); expect((await pending).success).toBe(false);
    expect(state().project).toBe(replacement); expect(state().actionExecutor).toBe(owner); expect(state().canUndo()).toBe(false);
  });
  it("retains an intervening rename and keeps it outside the placement Undo", async () => {
    const held = holdTrack(); const beforeTracks = state().project.timeline.tracks.map(t => t.id);
    const pending = state().addClipToNewTrack("first"); await held.started;
    expect((await state().renameProject("Keep this name")).success).toBe(true);
    held.release(); expect((await pending).success).toBe(true);
    expect(state().project.name).toBe("Keep this name");
    await state().undo(); expect(state().project.name).toBe("Keep this name");
    expect(state().project.timeline.tracks.map(t => t.id)).toEqual(beforeTracks);
    await state().undo(); expect(state().project.name).toBe("Background placement");
  });
  it("retains two concurrent insertions and their separate Undo/Redo commands", async () => {
    const beforeTracks = state().project.timeline.tracks.length;
    const results = await Promise.all([state().addClipToNewTrack("first", 1), state().addClipToNewTrack("second", 3)]);
    expect(results.every(result => result.success)).toBe(true);
    const added = state().project.timeline.tracks.slice(beforeTracks);
    expect(added.map(t => t.name)).toEqual(["Image 1", "Image 2"]);
    expect(added.map(t => t.clips[0].mediaId)).toEqual(["first", "second"]);
    await state().undo(); expect(state().project.timeline.tracks.length).toBe(beforeTracks + 1);
    await state().undo(); expect(state().project.timeline.tracks.length).toBe(beforeTracks);
    await state().redo(); await state().redo(); expect(state().project.timeline.tracks.slice(beforeTracks)).toEqual(added);
  });
  it("keeps a later explicit history group open and separate from the pending insertion", async () => {
    const held = holdTrack(); const pending = state().addClipToNewTrack("first"); await held.started;
    const history = state().actionExecutor.getHistory(); const later = history.beginGroup("Another command");
    try {
      await state().renameProject("Later command"); held.release(); expect((await pending).success).toBe(true);
      expect(history.getCurrentGroupId()).toBe(later);
      expect(history.getHistoryEntries().at(-1)?.groupId).not.toBe(later);
    } finally { history.endGroup(); }
  });
  it("keeps a newly relinked source when its duration changes during preparation", async () => {
    const project = state().project;
    state().loadProject({ ...project, mediaLibrary: { items: [{ ...item("first"), type: "video", metadata: { ...item("first").metadata, duration: 5 } }] } });
    const held = holdTrack(); const pending = state().addClipToNewTrack("first"); await held.started;
    const current = state().project; const relinked = { ...current, mediaLibrary: { items: current.mediaLibrary.items.map(source => ({ ...source, metadata: { ...source.metadata, duration: 3 } })) } };
    useProjectStore.setState({ project: relinked });
    held.release(); expect((await pending).success).toBe(false);
    expect(state().project).toBe(relinked); expect(state().canUndo()).toBe(false);
  });
  it("does not publish a prepared track when the clip action fails", async () => {
    const before = state().project; const execute = ActionExecutor.prototype.execute;
    vi.spyOn(ActionExecutor.prototype, "execute").mockImplementation(function(this: ActionExecutor, action, project) {
      return action.type === "clip/add" ? Promise.resolve({ success: false, error: { code: "INVALID_PARAMS", message: "Clip could not be prepared" } }) : execute.call(this, action, project);
    });
    expect((await state().addClipToNewTrack("first")).success).toBe(false);
    expect(state().project).toBe(before); expect(state().canUndo()).toBe(false);
  });
  it("blocks placement if export starts while the new track is being prepared", async () => {
    const held = holdTrack(); const before = state().project;
    const pending = state().addClipToNewTrack("first"); await held.started;
    useUIStore.getState().setExportState({ isExporting: true, progress: 1, phase: "encoding" });
    held.release(); expect((await pending).success).toBe(false);
    expect(state().project).toBe(before); expect(state().canUndo()).toBe(false);
  });
});
