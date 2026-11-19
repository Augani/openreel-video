import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import { ActionHistory } from "./action-history";
import type { Project } from "../types/project";
import type { Clip, Track } from "../types/timeline";
import type { ClipChannelMap } from "../audio/channel-map";

const clip = (id: string, channelMap?: ClipChannelMap): Clip =>
  ({
    id, mediaId: "m", trackId: "t1", startTime: 0, duration: 2, inPoint: 0, outPoint: 2,
    effects: [], audioEffects: [], transform: {} as Clip["transform"], volume: 1, keyframes: [],
    ...(channelMap ? { channelMap } : {}),
  }) as Clip;

const makeProject = (): Project => ({
  id: "p", name: "Channels", createdAt: 1, modifiedAt: 1,
  settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items: [] },
  timeline: {
    tracks: [
      { id: "t1", type: "audio", name: "A1", clips: [clip("c1"), clip("c2", { format: "stereo", sources: [1, 0] })], transitions: [], locked: false, hidden: false, muted: false, solo: false } as Track,
    ],
    subtitles: [], markers: [], duration: 2,
  },
});
const left: ClipChannelMap = { format: "mono", sources: [0] };
const clips = (project: Project) => project.timeline.tracks[0].clips;

describe("audio/setChannelMap", () => {
  it("maps several clips in one undo step and restores each clip's own previous map", async () => {
    const project = makeProject();
    const history = new ActionHistory();
    const executor = new ActionExecutor(history);
    const result = await executor.execute({ type: "audio/setChannelMap", id: "a1", timestamp: 2, params: { clipIds: ["c1", "c2"], map: left } }, project);
    expect(result.success, JSON.stringify(result.error)).toBe(true);
    expect(clips(project).map((c) => c.channelMap)).toEqual([left, left]);
    expect(history.getUndoStackSize()).toBe(1);
    await executor.undo(project);
    expect(clips(project)[0].channelMap).toBeUndefined();
    expect(clips(project)[1].channelMap).toEqual({ format: "stereo", sources: [1, 0] });
    await executor.redo(project);
    expect(clips(project).map((c) => c.channelMap)).toEqual([left, left]);
  });

  it("clears the map with null and undoes that too", async () => {
    const project = makeProject();
    const executor = new ActionExecutor(new ActionHistory());
    await executor.execute({ type: "audio/setChannelMap", id: "a2", timestamp: 2, params: { clipIds: ["c2"], map: null } }, project);
    expect("channelMap" in clips(project)[1]).toBe(false);
    await executor.undo(project);
    expect(clips(project)[1].channelMap).toEqual({ format: "stereo", sources: [1, 0] });
  });

  it("rejects unknown clips and malformed maps", async () => {
    const project = makeProject();
    const executor = new ActionExecutor(new ActionHistory());
    const missing = await executor.execute({ type: "audio/setChannelMap", id: "a3", timestamp: 2, params: { clipIds: ["nope"], map: left } }, project);
    expect(missing.success).toBe(false);
    const bad = await executor.execute({ type: "audio/setChannelMap", id: "a4", timestamp: 2, params: { clipIds: ["c1"], map: { format: "quad", sources: [] } } }, project);
    expect(bad.success).toBe(false);
    expect(clips(project)[0].channelMap).toBeUndefined();
  });
});
