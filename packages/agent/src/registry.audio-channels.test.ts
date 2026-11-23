import { describe, expect, it } from "vitest";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { ActionExecutor } from "@openreel/core/actions/action-executor";
import type { Project } from "@openreel/core/types/project";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import type { TargetingBridge, TargetingState } from "./host";
import { getTool, toMcpTools } from "./registry";
import { makeEmptyProject } from "./test-fixtures";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const audioTrack = (id: string, clips: unknown[] = []) => ({ id, type: "audio", name: id.toUpperCase(), clips, transitions: [], locked: false, hidden: false, muted: false, solo: false });
const media = (id: string, name: string, type: "audio" | "video", metadata: object) => ({ id, name, type, blob: null, metadata: { duration: 20, width: type === "video" ? 1920 : 0, height: type === "video" ? 1080 : 0, frameRate: type === "video" ? 30 : 0, sampleRate: 48000, hasAudio: true, ...metadata } });

function project(): Project {
  const base = makeEmptyProject();
  return {
    ...base,
    mediaLibrary: {
      items: [
        media("quad", "quad.wav", "audio", { channels: 4 }),
        media("mixed", "mono-plus-stereo.mov", "video", { channels: 2, audioTrackCount: 2, audioStreamChannels: [1, 2] }),
        media("plain", "plain.wav", "audio", { channels: 2 }),
      ],
    },
    timeline: {
      ...base.timeline,
      tracks: [
        { id: "v1", type: "video", name: "Main", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false },
        audioTrack("a1"),
        audioTrack("a2"),
        audioTrack("a3", [{ id: "old", mediaId: "plain", trackId: "a3", startTime: 0, duration: 9, inPoint: 0, outPoint: 9, effects: [], audioEffects: [], keyframes: [], volume: 1, transform }]),
        audioTrack("a4"),
      ],
    },
  } as unknown as Project;
}

function setup(withTargeting = false) {
  const history = new ActionHistory();
  const host = new HeadlessHost(project(), { history }) as HeadlessHost & { targeting?: TargetingBridge };
  const state = { targetedTrackIds: [] as string[], sourcePatch: {} as { audio?: string; video?: string }, channelPatches: {} as Record<number, string>, disabledChannels: [] as number[] };
  if (withTargeting) {
    host.targeting = {
      getState: (): TargetingState => ({ targetedTrackIds: [...state.targetedTrackIds], sourcePatch: { ...state.sourcePatch }, channelPatches: { ...state.channelPatches }, disabledChannels: [...state.disabledChannels] }),
      setTrackTargeted: () => undefined,
      setSourcePatch: (kind, trackId) => { if (trackId) state.sourcePatch[kind] = trackId; else delete state.sourcePatch[kind]; },
      setChannelPatch: (channel, trackId) => { if (channel === 0) { if (trackId) state.sourcePatch.audio = trackId; else delete state.sourcePatch.audio; } else if (trackId) state.channelPatches[channel] = trackId; else delete state.channelPatches[channel]; },
      setChannelEnabled: (channel, enabled) => { state.disabledChannels = enabled ? state.disabledChannels.filter((c) => c !== channel) : [...new Set([...state.disabledChannels, channel])]; },
    };
  }
  const undo = () => new ActionExecutor(history).undo(host.getProject());
  return { host, history, undo };
}
const placed = (host: HeadlessHost, mediaId: string) => host.getProject().timeline.tracks.flatMap((t) => t.clips.filter((c) => c.mediaId === mediaId).map((c) => ({ ...c, trackId: t.id })));

describe("multichannel source patching: agent tools", () => {
  it("registers the channel tools with schemas and exposes them over MCP", () => {
    const mcp = new Set(toMcpTools().map((t) => t.name));
    for (const name of ["set_source_channel_layout", "get_source_channel_layout", "set_clip_channel_map", "set_source_channel_patch"]) {
      expect(getTool(name), name).toBeDefined();
      expect(mcp.has(name), name).toBe(true);
    }
  });

  it("get_source_channel_layout reports per-stream widths and the groups a file expands to", async () => {
    const { host } = setup();
    const result = await executeTool("get_source_channel_layout", { mediaId: "mixed" }, host);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ streams: 2, streamChannels: [1, 2], custom: false });
    expect((result.data as { groups: { patch: string; format: string }[] }).groups.map((g) => [g.patch, g.format])).toEqual([["A1", "mono"], ["A2", "stereo"]]);
  });

  it("set_source_channel_layout stores a preset or custom groups, in one undo step, and insert follows it", async () => {
    const { host, history, undo } = setup();
    const before = history.getUndoStackSize();
    const preset = await executeTool("set_source_channel_layout", { mediaId: "quad", layout: "stereo" }, host);
    expect(preset.ok, preset.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(host.getProject().mediaLibrary.items.find((m) => m.id === "quad")?.channelLayout?.map((g) => g.map.sources)).toEqual([[0, 1], [2, 3]]);
    const inserted = await executeTool("insert_from_source", { mediaId: "quad", at: 0 }, host);
    expect(inserted.ok, inserted.summary).toBe(true);
    // The first pair is channels 1 + 2, which is what a 4-channel file plays untouched, so it needs no map; the second pair does.
    expect(placed(host, "quad").map((c) => c.channelMap?.sources ?? null).sort()).toEqual([[2, 3], null].sort());
    await undo();
    await undo();
    // Custom groups: the second stream is left out, stream 0 channel 2 plays as mono.
    const custom = await executeTool("set_source_channel_layout", { mediaId: "mixed", groups: [{ stream: 0, format: "mono", sources: [0] }] }, host);
    expect(custom.ok, custom.summary).toBe(true);
    expect(host.getProject().mediaLibrary.items.find((m) => m.id === "mixed")?.channelLayout).toHaveLength(1);
    // "file" clears the stored layout again.
    expect((await executeTool("set_source_channel_layout", { mediaId: "mixed", layout: "file" }, host)).ok).toBe(true);
    expect(host.getProject().mediaLibrary.items.find((m) => m.id === "mixed")?.channelLayout).toBeUndefined();
  });

  it("rejects bad input without touching the project", async () => {
    const { host, history } = setup();
    const before = history.getUndoStackSize();
    expect((await executeTool("set_source_channel_layout", { mediaId: "quad" }, host)).ok).toBe(false);
    expect((await executeTool("set_source_channel_layout", { mediaId: "quad", layout: "7.1" }, host)).ok).toBe(false);
    expect((await executeTool("set_source_channel_layout", { mediaId: "nope", layout: "mono" }, host)).ok).toBe(false);
    expect((await executeTool("set_source_channel_layout", { mediaId: "quad", groups: [{ stream: 0, format: "quad", sources: [0] }] }, host)).ok).toBe(false);
    expect(history.getUndoStackSize()).toBe(before);
  });

  it("set_clip_channel_map sets and clears a clip's map, one undo step", async () => {
    const { host, history } = setup();
    const before = history.getUndoStackSize();
    const set = await executeTool("set_clip_channel_map", { clipId: "old", map: { format: "mono", sources: [1] } }, host);
    expect(set.ok, set.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(placed(host, "plain")[0].channelMap).toEqual({ format: "mono", sources: [1] });
    expect((await executeTool("set_clip_channel_map", { clipId: "old", clear: true }, host)).ok).toBe(true);
    expect(placed(host, "plain")[0].channelMap).toBeUndefined();
    expect((await executeTool("set_clip_channel_map", { clipId: "old" }, host)).ok).toBe(false);
    expect((await executeTool("set_clip_channel_map", { clipId: "missing", clear: true }, host)).ok).toBe(false);
  });

  it("insert_from_source places one audio clip per group of a multichannel file on cascading tracks, skipping the occupied one, in one undo step", async () => {
    const { host, history, undo } = setup();
    const before = history.getUndoStackSize();
    const result = await executeTool("insert_from_source", { mediaId: "quad", at: 1, sourceIn: 0, sourceOut: 3 }, host);
    expect(result.ok, result.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    const clips = placed(host, "quad");
    expect(clips.map((c) => [c.trackId, c.channelMap?.sources[0]])).toEqual(expect.arrayContaining([["a1", 0], ["a2", 1]]));
    expect(clips).toHaveLength(4);
    expect(new Set(clips.map((c) => c.trackId)).size).toBe(4);
    expect(clips.every((c) => c.startTime === 1 && c.duration === 3)).toBe(true);
    await undo();
    expect(placed(host, "quad")).toHaveLength(0);
  });

  it("a video file with a mono and a stereo stream places the picture plus one clip per stream, each played as it is", async () => {
    const { host } = setup();
    const result = await executeTool("overwrite_from_source", { mediaId: "mixed", at: 0, sourceIn: 0, sourceOut: 2 }, host);
    expect(result.ok, result.summary).toBe(true);
    const clips = placed(host, "mixed");
    const picture = clips.find((c) => c.trackId === "v1")!;
    expect(picture.volume).toBe(0);
    const sounds = clips.filter((c) => c.trackId !== "v1");
    expect(sounds.map((c) => c.audioTrackIndex ?? 0).sort()).toEqual([0, 1]);
    expect(sounds.every((c) => c.channelMap === undefined && c.metadata?.separatedFromClipId === picture.id)).toBe(true);
  });

  it("set_source_channel_patch routes and switches off groups for the next insert (live editor only)", async () => {
    const headless = setup();
    expect((await executeTool("set_source_channel_patch", { channel: 1, trackId: "a4" }, headless.host)).ok).toBe(false);

    const { host } = setup(true);
    expect((await executeTool("set_source_channel_patch", { channel: 2, trackId: "a4" }, host)).ok).toBe(true);
    expect((await executeTool("set_source_channel_patch", { channel: 4, enabled: false }, host)).ok).toBe(true);
    expect((await executeTool("set_source_channel_patch", { channel: 3, enabled: false }, host)).ok).toBe(true);
    expect((await executeTool("set_source_channel_patch", { channel: 1, trackId: "v1" }, host)).ok).toBe(false);
    const result = await executeTool("insert_from_source", { mediaId: "quad", at: 0, sourceIn: 0, sourceOut: 2 }, host);
    expect(result.ok, result.summary).toBe(true);
    const clips = placed(host, "quad");
    // A2 went to the patched a4; A3 and A4 are off, so only two clips exist.
    expect(clips.map((c) => [c.trackId, c.channelMap?.sources[0]]).sort()).toEqual([["a1", 0], ["a4", 1]]);
    // All four off: nothing to place.
    for (const channel of [1, 2]) await executeTool("set_source_channel_patch", { channel, enabled: false }, host);
    expect((await executeTool("insert_from_source", { mediaId: "quad", at: 5 }, host)).ok).toBe(false);
  });
});
