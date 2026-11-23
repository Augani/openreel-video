import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import { buildSourceGroups, resolveSourceChannelGroups, sourceAudioShape } from "../audio/source-channels";
import { resolveMultichannelSourceTracks } from "./track-targeting";
import { planSourceEdit, type AudioChannelPlacement } from "./source-edit";
import {
  applyTimelineToolEdits,
  invertTimelineToolEdits,
  validateTimelineToolEdits,
  type TimelineToolPlan,
} from "./timeline-tool-edit";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id, mediaId: "poly", trackId, startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
}) as unknown as Clip;
const track = (id: string, type: Track["type"], clips: Clip[] = [], extra: Partial<Track> = {}): Track => ({
  id, name: id.toUpperCase(), type, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra,
}) as Track;

const poly = {
  id: "poly", name: "poly8.wav", type: "audio", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration: 20, width: 0, height: 0, frameRate: 0, sampleRate: 48000, channels: 8, codec: "pcm", fileSize: 1, hasAudio: true },
};
const mov = {
  id: "mov", name: "two-stereo.mov", type: "video", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration: 20, width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2, audioTrackCount: 2, codec: "h264", fileSize: 1, hasAudio: true, hasVideo: true },
};

function project(tracks: Track[]): Project {
  return {
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [poly, mov] },
    timeline: { duration: 40, markers: [], subtitles: [], tracks },
  } as unknown as Project;
}
const run = (p: Project, plan: TimelineToolPlan) => {
  validateTimelineToolEdits(p, plan.edits);
  return applyTimelineToolEdits(p, plan.edits);
};
const trackOf = (p: Project, id: string) => p.timeline.tracks.find((t) => t.id === id)!;
const ids = (choices: ReturnType<typeof resolveMultichannelSourceTracks>["audio"]) =>
  choices.map((c) => (c.choice.kind === "existing" ? c.choice.track.id : "new"));

describe("resolveMultichannelSourceTracks", () => {
  const p = project([track("v1", "video"), track("a1", "audio"), track("a2", "audio"), track("a3", "audio", [], { locked: true }), track("a4", "audio"), track("a5", "audio")]);

  it("cascades unpatched channels down the free audio tracks, skipping locked ones, then creates tracks", () => {
    const r = resolveMultichannelSourceTracks(p, { mediaType: "audio", groupCount: 6 });
    expect(ids(r.audio)).toEqual(["a1", "a2", "a4", "a5", "new", "new"]);
    expect(r.primary).toBeUndefined();
  });

  it("honours explicit patches, never reuses a track, and cascades the rest around them", () => {
    const r = resolveMultichannelSourceTracks(p, {
      mediaType: "audio", groupCount: 4,
      patch: { channels: ["a4", "a4", null, "a1"] },
    });
    // channel 0 -> a4; channel 1 wanted a4 too (taken) so it takes the next free track below it; channel 2 wraps to the first free one; channel 3 -> a1.
    expect(r.audio.map((a) => [a.channel, a.choice.kind === "existing" ? a.choice.track.id : "new"])).toEqual([
      [0, "a4"], [1, "a5"], [2, "a2"], [3, "a1"],
    ]);
  });

  it("the legacy audio patch is channel 0", () => {
    const r = resolveMultichannelSourceTracks(p, { mediaType: "audio", groupCount: 2, patch: { audio: "a2" } });
    expect(ids(r.audio)).toEqual(["a2", "a4"]);
  });

  it("disabled channels place nothing and leave their track free", () => {
    const r = resolveMultichannelSourceTracks(p, { mediaType: "audio", groupCount: 4, patch: { disabledChannels: [false, true, false, true] } });
    expect(r.audio.map((a) => a.channel)).toEqual([0, 2]);
    expect(ids(r.audio)).toEqual(["a1", "a2"]);
  });

  it("targeting drives channel 0 and the video component gets its own track", () => {
    const r = resolveMultichannelSourceTracks(p, { mediaType: "video", groupCount: 2, targetedTrackIds: ["a4"], patch: { video: "v1" } });
    expect(r.primary).toMatchObject({ kind: "existing", track: { id: "v1" } });
    expect(ids(r.audio)).toEqual(["a4", "a5"]);
    expect(resolveMultichannelSourceTracks(p, { mediaType: "video", component: "video", groupCount: 2 }).audio).toEqual([]);
    expect(resolveMultichannelSourceTracks(p, { mediaType: "video", component: "audio", groupCount: 2 }).primary).toBeUndefined();
  });
});

function placements(_project: Project, media: typeof poly | typeof mov, tracks: string[]): AudioChannelPlacement[] {
  return resolveSourceChannelGroups(media as never).slice(0, tracks.length).map((group, channel) => ({
    trackId: tracks[channel], clipId: `snd-${channel}`, channel, group,
  }));
}

describe("planSourceEdit with audio channels", () => {
  it("an 8-mono source places one mono clip per enabled channel, linked, in one plan with sync lock respected", () => {
    const base = project([
      track("a1", "audio", [clip("x1", "a1", 0, 6)]),
      track("a2", "audio"), track("a3", "audio"), track("a4", "audio"),
      track("a5", "audio", [clip("lock-follow", "a5", 3, 4)]),
      track("a6", "audio", [clip("free", "a6", 3, 4)], { syncLock: false }),
    ]);
    const all = placements(base, poly, ["a1", "a2", "a3", "a4"]);
    const { plan, resolved } = planSourceEdit(base, {
      mode: "insert", media: poly as never, trackId: "a1", clipId: "snd-0", operationId: "op",
      sourceIn: 2, sourceOut: 5, playhead: 3, audioChannels: all,
    });
    const next = run(base, plan);
    expect(resolved).toMatchObject({ at: 3, duration: 3 });
    for (let c = 0; c < 4; c++) {
      const placed = trackOf(next, `a${c + 1}`).clips.find((k) => k.id === `snd-${c}`)!;
      expect([placed.startTime, placed.duration, placed.inPoint]).toEqual([3, 3, 2]);
      expect(placed.channelMap).toEqual({ format: "mono", sources: [c] });
      expect(placed.metadata?.sourceChannelGroup).toBe(c);
      expect(placed.metadata?.separatedFromClipId).toBe(c === 0 ? undefined : "snd-0");
      expect(placed.transform.opacity).toBe(1);
    }
    // Insert rippled the sync-locked A5 after the edit point; Sync Lock off on A6 stays; A1's old clip split at 3.
    expect(trackOf(next, "a5").clips[0].startTime).toBe(6);
    expect(trackOf(next, "a6").clips[0].startTime).toBe(3);
    expect(trackOf(next, "a1").clips.filter((k) => !k.id.startsWith("snd-")).map((k) => [k.startTime, k.duration])).toEqual([[0, 3], [6, 3]]);
    // One plan = one undo step, and it undoes exactly.
    const back = invertTimelineToolEdits(plan.edits);
    validateTimelineToolEdits(next, back);
    const undone = applyTimelineToolEdits(next, back);
    expect(trackOf(undone, "a5").clips[0].startTime).toBe(3);
    expect(undone.timeline.tracks.flatMap((t) => t.clips).some((k) => k.id.startsWith("snd-"))).toBe(false);
  });

  it("a disabled channel is simply not placed", () => {
    const base = project([track("a1", "audio"), track("a2", "audio"), track("a3", "audio")]);
    const all = placements(base, poly, ["a1", "a3"]).map((p, i) => (i === 1 ? { ...p, channel: 2, group: buildSourceGroups("mono", sourceAudioShape(poly as never))[2] } : p));
    const { plan } = planSourceEdit(base, { mode: "overwrite", media: poly as never, trackId: "a1", clipId: "snd-0", operationId: "op", playhead: 0, audioChannels: all });
    const next = run(base, plan);
    expect(trackOf(next, "a2").clips).toEqual([]);
    expect(trackOf(next, "a3").clips[0].channelMap).toEqual({ format: "mono", sources: [2] });
  });

  it("a video with two stereo audio streams places the picture muted plus one linked sound clip per stream", () => {
    const base = project([track("v1", "video"), track("a1", "audio"), track("a2", "audio")]);
    const { plan, clip: first } = planSourceEdit(base, {
      mode: "overwrite", media: mov as never, trackId: "v1", clipId: "pic", operationId: "op", playhead: 1,
      audioChannels: placements(base, mov, ["a1", "a2"]),
    });
    const next = run(base, plan);
    const pic = trackOf(next, "v1").clips[0];
    expect([pic.id, pic.volume, pic.transform.opacity]).toEqual(["pic", 0, 1]);
    expect(first.id).toBe("pic");
    const s0 = trackOf(next, "a1").clips[0];
    const s1 = trackOf(next, "a2").clips[0];
    expect([s0.audioTrackIndex, s0.channelMap]).toEqual([undefined, undefined]);
    expect([s1.audioTrackIndex, s1.channelMap]).toEqual([1, undefined]);
    expect(s0.metadata?.separatedFromClipId).toBe("pic");
    expect(s1.metadata?.separatedFromClipId).toBe("pic");
    expect([s0.transform.opacity, s1.transform.opacity]).toEqual([0, 0]);
  });

  it("component video places only the picture and is unaffected by audio channels", () => {
    const base = project([track("v1", "video"), track("a1", "audio")]);
    const { plan } = planSourceEdit(base, {
      mode: "overwrite", media: mov as never, trackId: "v1", clipId: "pic", operationId: "op", playhead: 0, component: "video",
      audioChannels: placements(base, mov, ["a1", "a1"].slice(0, 1)),
    });
    const next = run(base, plan);
    expect(trackOf(next, "v1").clips).toHaveLength(1);
    expect(trackOf(next, "a1").clips).toHaveLength(0);
  });

  it("refuses a locked destination track", () => {
    const base = project([track("a1", "audio"), track("a2", "audio", [], { locked: true })]);
    expect(() =>
      planSourceEdit(base, { mode: "overwrite", media: poly as never, trackId: "a1", clipId: "s0", operationId: "op", playhead: 0, audioChannels: placements(base, poly, ["a1", "a2"]) }),
    ).toThrow();
  });
});
