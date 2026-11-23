import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import { ActionHistory } from "./action-history";
import type { Project } from "../types/project";
import { buildSourceGroups, sourceAudioShape } from "../audio/source-channels";

const item = (id: string, channels: number, extra: object = {}) => ({
  id, name: `${id}.wav`, type: "audio", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration: 5, width: 0, height: 0, frameRate: 0, sampleRate: 48000, channels, codec: "pcm", fileSize: 1, hasAudio: true },
  ...extra,
});
const makeProject = (): Project =>
  ({
    id: "p", name: "p", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [item("a", 8), item("b", 4, { channelLayout: [{ stream: 0, map: { format: "stereo", sources: [1, 0] } }] }), { ...item("img", 0), type: "image" }] },
    timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
  }) as unknown as Project;
const layoutOf = (p: Project, id: string) => (p.mediaLibrary.items.find((i) => i.id === id) as { channelLayout?: unknown }).channelLayout;

describe("media/organize channelLayout", () => {
  it("sets the layout of many items in one undo step and restores each item's own previous layout", async () => {
    const project = makeProject();
    const history = new ActionHistory();
    const executor = new ActionExecutor(history);
    const stereoPairs = (channels: number) => buildSourceGroups("stereo", sourceAudioShape({ metadata: { channels } }));
    const result = await executor.execute(
      { type: "media/organize", id: "o1", timestamp: 2, params: { label: "Audio channels", itemPatches: { a: { channelLayout: stereoPairs(8) }, b: { channelLayout: stereoPairs(4) } } } },
      project,
    );
    expect(result.success, JSON.stringify(result.error)).toBe(true);
    expect((layoutOf(project, "a") as unknown[]).length).toBe(4);
    expect((layoutOf(project, "b") as unknown[]).length).toBe(2);
    expect(history.getUndoStackSize()).toBe(1);
    await executor.undo(project);
    expect(layoutOf(project, "a")).toBeUndefined();
    expect(layoutOf(project, "b")).toEqual([{ stream: 0, map: { format: "stereo", sources: [1, 0] } }]);
    await executor.redo(project);
    expect((layoutOf(project, "a") as unknown[]).length).toBe(4);
  });

  it("null goes back to Use file; invalid layouts and images are rejected", async () => {
    const project = makeProject();
    const executor = new ActionExecutor(new ActionHistory());
    const cleared = await executor.execute({ type: "media/organize", id: "o2", timestamp: 2, params: { itemPatches: { b: { channelLayout: null } } } }, project);
    expect(cleared.success).toBe(true);
    expect("channelLayout" in (project.mediaLibrary.items[1] as object)).toBe(false);
    const bad = await executor.execute({ type: "media/organize", id: "o3", timestamp: 2, params: { itemPatches: { a: { channelLayout: [{ stream: 0, map: { format: "quad" } }] } } } }, project);
    expect(bad.success).toBe(false);
    const image = await executor.execute({ type: "media/organize", id: "o4", timestamp: 2, params: { itemPatches: { img: { channelLayout: [{ stream: 0, map: { format: "mono", sources: [0] } }] } } } }, project);
    expect(image.success).toBe(false);
  });
});
