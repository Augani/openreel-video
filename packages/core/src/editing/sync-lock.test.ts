import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ActionExecutor } from "../actions/action-executor";
import type { Clip, Project, Track } from "../types";
import {
  planAddEdit,
  planExtract,
  planInsert,
  planLift,
  createMediaClip,
} from "./premiere-edits";
import { planCloseGap, planRippleDelete } from "./ripple-delete";
import {
  isSyncLocked,
  SyncLockBlockedError,
  syncFollowerTrackIds,
} from "./sync-lock";
import {
  chooseTrackForMedia,
  resolveSourceTracks,
} from "./track-targeting";
import { planSourceEdit } from "./source-edit";
import {
  applyTimelineToolEdits,
  invertTimelineToolEdits,
  prepareTimelineToolEdit,
  validateTimelineToolEdits,
  type TimelineToolPlan,
} from "./timeline-tool-edit";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  rotation: 0,
  opacity: 1,
};
const clip = (
  id: string,
  trackId: string,
  startTime: number,
  duration: number,
  inPoint = 0,
): Clip => ({
  id,
  mediaId: "media",
  trackId,
  startTime,
  duration,
  inPoint,
  outPoint: inPoint + duration,
  effects: [],
  audioEffects: [],
  transform,
  volume: 1,
  keyframes: [],
});
const track = (
  id: string,
  type: Track["type"],
  clips: Clip[],
  extra: Partial<Track> = {},
): Track => ({
  id,
  name: id.toUpperCase(),
  type,
  clips,
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...extra,
});

function project(tracks: Track[], extra: Partial<Project> = {}): Project {
  return {
    id: "p",
    name: "p",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: {
      items: [
        {
          id: "media",
          name: "Media.mp4",
          type: "video",
          fileHandle: null,
          blob: null,
          thumbnailUrl: null,
          waveformData: null,
          metadata: {
            duration: 60,
            width: 640,
            height: 360,
            frameRate: 30,
            sampleRate: 48000,
            channels: 2,
            codec: "h264",
            fileSize: 1,
            hasAudio: true,
          },
        },
      ],
    },
    timeline: { duration: 40, markers: [], subtitles: [], tracks },
    ...extra,
  } as unknown as Project;
}

/** V1 + linked A1 (camera) + A2 (music) + a locked track. */
function layout(): Project {
  return project([
    track("v1", "video", [clip("v-a", "v1", 0, 4), clip("v-b", "v1", 4, 4, 10)]),
    track("a1", "audio", [clip("a-a", "a1", 0, 4), clip("a-b", "a1", 4, 4, 10)]),
    track("a2", "audio", [clip("m-1", "a2", 6, 4)]),
    track("lk", "audio", [clip("l-1", "lk", 0, 12)], { locked: true }),
  ]);
}

const run = (p: Project, plan: TimelineToolPlan) => {
  validateTimelineToolEdits(p, plan.edits);
  return applyTimelineToolEdits(p, plan.edits);
};
const spans = (p: Project, trackId: string) =>
  [...p.timeline.tracks.find((t) => t.id === trackId)!.clips]
    .sort((a, b) => a.startTime - b.startTime)
    .map((c) => [+c.startTime.toFixed(6), +(c.startTime + c.duration).toFixed(6)]);
const normal = (p: Project) =>
  JSON.stringify(
    p.timeline.tracks.map((t) => ({
      id: t.id,
      clips: [...t.clips].sort((a, b) => a.id.localeCompare(b.id)),
      transitions: t.transitions,
    })),
  );
function undoOf(p: Project, plan: TimelineToolPlan) {
  const after = run(p, plan);
  const back = invertTimelineToolEdits(plan.edits);
  validateTimelineToolEdits(after, back);
  return applyTimelineToolEdits(after, back);
}

describe("isSyncLocked / syncFollowerTrackIds", () => {
  it("treats a missing flag as on and only an explicit false as off", () => {
    expect(isSyncLocked({})).toBe(true);
    expect(isSyncLocked({ syncLock: true })).toBe(true);
    expect(isSyncLocked({ syncLock: false })).toBe(false);
  });

  it("followers are unlocked, sync-locked and not edit tracks", () => {
    const p = layout();
    p.timeline.tracks[2] = { ...p.timeline.tracks[2], syncLock: false };
    expect(syncFollowerTrackIds(p, ["v1"])).toEqual(["a1"]);
    expect(syncFollowerTrackIds(p, [])).toEqual(["v1", "a1"]);
  });
});

describe("planRippleDelete", () => {
  it("ripples markers with the edit: later ones shift, range markers shorten, covered ones go; undo restores", () => {
    const base = project([
      track("v1", "video", [clip("v-a", "v1", 0, 4), clip("v-b", "v1", 4, 4)]),
    ]);
    const p = {
      ...base,
      timeline: {
        ...base.timeline,
        markers: [
          { id: "inside", time: 1, label: "", color: "red" },
          { id: "later", time: 6, label: "", color: "red" },
          { id: "range", time: 3, label: "", color: "red", duration: 4 },
          { id: "covered", time: 1, label: "", color: "red", duration: 2 },
        ],
      },
    } as unknown as Project;
    const plan = planRippleDelete(p, ["v-a"], "op");
    const next = run(p, plan);
    expect(next.timeline.markers.map((m) => [m.id, m.time, m.duration])).toEqual([
      ["later", 2, undefined],
      ["range", 0, 3],
    ]);
    expect(undoOf(p, plan).timeline.markers).toEqual(p.timeline.markers);
  });

  it("closes the edit track and shifts sync-locked tracks that are empty in the range", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 4), clip("v-b", "v1", 4, 4)]),
      track("a2", "audio", [clip("m-1", "a2", 5, 3)]),
    ]);
    const next = run(p, planRippleDelete(p, ["v-a"], "op"));
    expect(spans(next, "v1")).toEqual([[0, 4]]);
    expect(spans(next, "a2")).toEqual([[1, 4]]);
  });

  it("shifts a linked A/V pair deleted together exactly once for the followers", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 4), clip("v-b", "v1", 4, 4)]),
      track("a1", "audio", [clip("a-a", "a1", 0, 4), clip("a-b", "a1", 4, 4)]),
      track("a2", "audio", [clip("m-1", "a2", 6, 4)]),
    ]);
    const next = run(p, planRippleDelete(p, ["v-a", "a-a"], "op"));
    expect(spans(next, "v1")).toEqual([[0, 4]]);
    expect(spans(next, "a1")).toEqual([[0, 4]]);
    expect(spans(next, "a2")).toEqual([[2, 6]]);
  });

  it("blocks and names the first sync-locked track with content in the range", () => {
    const p = layout();
    let error: unknown;
    try {
      planRippleDelete(p, ["v-a", "a-a"], "op");
    } catch (caught) {
      error = caught;
    }
    // A2's music starts at 6, outside [0,4): not blocked. Move it inside.
    expect(error).toBeUndefined();
    const q = project([
      track("v1", "video", [clip("v-a", "v1", 0, 8)]),
      track("a1", "audio", [clip("a-a", "a1", 0, 8)]),
      track("a2", "audio", [clip("m-1", "a2", 2, 8)]),
    ]);
    try {
      planRippleDelete(q, ["v-a", "a-a"], "op");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SyncLockBlockedError);
    expect((error as SyncLockBlockedError).trackId).toBe("a2");
    expect((error as Error).message).toContain('"A2"');
  });

  it("leaves a track with Sync Lock off exactly in place, even if it overlaps", () => {
    const q = project([
      track("v1", "video", [clip("v-a", "v1", 0, 4), clip("v-b", "v1", 4, 4)]),
      track("a2", "audio", [clip("m-1", "a2", 2, 8)], { syncLock: false }),
    ]);
    const next = run(q, planRippleDelete(q, ["v-a"], "op"));
    expect(spans(next, "a2")).toEqual([[2, 10]]);
    expect(spans(next, "v1")).toEqual([[0, 4]]);
  });

  it("never changes a locked track", () => {
    const p = layout();
    const next = run(p, planRippleDelete(p, ["v-a", "a-a"], "op"));
    expect(spans(next, "lk")).toEqual([[0, 12]]);
  });

  it("refuses to delete from a locked edit track", () => {
    const p = layout();
    p.timeline.tracks[0] = { ...p.timeline.tracks[0], locked: true };
    expect(() => planRippleDelete(p, ["v-a"], "op")).toThrow(/Unlock/);
  });

  it("is one plan and undo restores the project exactly", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 4), clip("v-b", "v1", 4, 4)]),
      track("a2", "audio", [clip("m-1", "a2", 5, 3)]),
    ]);
    const plan = planRippleDelete(p, ["v-a"], "op");
    expect(normal(undoOf(p, plan))).toBe(normal(p));
  });

  it("also blocks on overlay items (text lanes) that sit in the range", () => {
    const q = project(
      [
        track("v1", "video", [clip("v-a", "v1", 0, 4), clip("v-b", "v1", 4, 4)]),
        track("t1", "text", []),
      ],
      { textClips: [{ id: "cap", trackId: "t1", startTime: 1, duration: 2 }] } as never,
    );
    expect(() => planRippleDelete(q, ["v-a"], "op")).toThrow(/"T1"/);
  });
});

describe("planInsert with sync lock", () => {
  const media = project([]).mediaLibrary.items[0];
  const placement = (trackId: string, length: number) => ({
    trackId,
    clip: createMediaClip(media as never, trackId, `new-${trackId}`, {
      inPoint: 0,
      outPoint: length,
    }),
  });

  it("splits and shifts sync-locked tracks, leaves sync-off and locked tracks", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 8)]),
      track("a1", "audio", [clip("a-a", "a1", 0, 8)]),
      track("a2", "audio", [clip("m-1", "a2", 0, 8)], { syncLock: false }),
      track("lk", "audio", [clip("l-1", "lk", 0, 8)], { locked: true }),
    ]);
    const next = run(p, planInsert(p, 3, [placement("v1", 2)], "op"));
    expect(spans(next, "v1")).toEqual([[0, 3], [3, 5], [5, 10]]);
    expect(spans(next, "a1")).toEqual([[0, 3], [5, 10]]);
    expect(spans(next, "a2")).toEqual([[0, 8]]);
    expect(spans(next, "lk")).toEqual([[0, 8]]);
    expect(normal(undoOf(p, planInsert(p, 3, [placement("v1", 2)], "op")))).toBe(normal(p));
  });

  it("ripples the destination track even when its own Sync Lock is off", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 8)], { syncLock: false }),
    ]);
    const next = run(p, planInsert(p, 3, [placement("v1", 2)], "op"));
    expect(spans(next, "v1")).toEqual([[0, 3], [3, 5], [5, 10]]);
  });

  it("keeps copied spacing for placement offsets and ripples by the full span", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 8)]),
      track("a1", "audio", [clip("a-a", "a1", 4, 4)]),
    ]);
    const plan = planInsert(
      p,
      2,
      [
        { ...placement("v1", 2), offset: 0 },
        { ...placement("a1", 2), offset: 2 },
      ],
      "op",
    );
    const next = run(p, plan);
    expect(spans(next, "a1")).toEqual([[4, 6], [8, 12]]);
    expect(spans(next, "v1")).toEqual([[0, 2], [2, 4], [6, 12]]);
  });
});

describe("planExtract / planLift with sync lock", () => {
  it("without explicit tracks cuts through sync-locked tracks only", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 10)]),
      track("a1", "audio", [clip("a-a", "a1", 0, 10)]),
      track("a2", "audio", [clip("m-1", "a2", 0, 10)], { syncLock: false }),
    ]);
    const next = run(p, planExtract(p, { start: 2, end: 4 }, "op"));
    expect(spans(next, "v1")).toEqual([[0, 2], [2, 8]]);
    expect(spans(next, "a1")).toEqual([[0, 2], [2, 8]]);
    expect(spans(next, "a2")).toEqual([[0, 10]]);
  });

  it("with targeted tracks, other sync-locked tracks must be empty in the range and shift", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 10)]),
      track("a2", "audio", [clip("m-1", "a2", 6, 4)]),
    ]);
    const next = run(p, planExtract(p, { start: 2, end: 4 }, "op", ["v1"]));
    expect(spans(next, "v1")).toEqual([[0, 2], [2, 8]]);
    expect(spans(next, "a2")).toEqual([[4, 8]]);
  });

  it("blocks naming the follower track and changes nothing", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 10)]),
      track("a2", "audio", [clip("m-1", "a2", 3, 4)]),
    ]);
    expect(() => planExtract(p, { start: 2, end: 4 }, "op", ["v1"])).toThrow(/"A2"/);
    // Sync off for A2: allowed, and A2 stays put.
    p.timeline.tracks[1] = { ...p.timeline.tracks[1], syncLock: false };
    const next = run(p, planExtract(p, { start: 2, end: 4 }, "op", ["v1"]));
    expect(spans(next, "a2")).toEqual([[3, 7]]);
  });

  it("Lift never ripples anything", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 10)]),
      track("a2", "audio", [clip("m-1", "a2", 6, 4)]),
    ]);
    const next = run(p, planLift(p, { start: 2, end: 4 }, "op", ["v1"]));
    expect(spans(next, "a2")).toEqual([[6, 10]]);
  });
});

describe("planCloseGap", () => {
  it("closes a gap on the track and its sync-locked followers", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 2), clip("v-b", "v1", 5, 3)]),
      track("a1", "audio", [clip("a-a", "a1", 0, 2), clip("a-b", "a1", 5, 3)]),
      track("a2", "audio", [clip("m-1", "a2", 6, 2)], { syncLock: false }),
    ]);
    const plan = planCloseGap(p, "v1", { start: 2, end: 5 }, "op");
    const next = run(p, plan);
    expect(spans(next, "v1")).toEqual([[0, 2], [2, 5]]);
    expect(spans(next, "a1")).toEqual([[0, 2], [2, 5]]);
    expect(spans(next, "a2")).toEqual([[6, 8]]);
    expect(normal(undoOf(p, plan))).toBe(normal(p));
  });

  it("is blocked when a follower has content inside the gap", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 2), clip("v-b", "v1", 5, 3)]),
      track("a2", "audio", [clip("m-1", "a2", 1, 4)]),
    ]);
    expect(() => planCloseGap(p, "v1", { start: 2, end: 5 }, "op")).toThrow(/"A2"/);
  });
});

describe("ripple trim follows sync-locked tracks", () => {
  const trim = (p: Project, delta: number, edge: "left" | "right" = "right") =>
    prepareTimelineToolEdit(p, {
      mode: "ripple",
      itemId: "v-a",
      linkedIds: [],
      edge,
    }).plan(delta);

  it("extending opens a gap at the cut on followers (splitting what straddles it)", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 4), clip("v-b", "v1", 4, 4)]),
      track("a2", "audio", [clip("m-1", "a2", 2, 6)]),
    ]);
    const next = run(p, trim(p, 1));
    expect(spans(next, "v1")).toEqual([[0, 5], [5, 9]]);
    expect(spans(next, "a2")).toEqual([[2, 4], [5, 9]]);
  });

  it("shrinking removes an empty range on followers and is blocked otherwise", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 4), clip("v-b", "v1", 4, 4)]),
      track("a2", "audio", [clip("m-1", "a2", 5, 2)]),
    ]);
    const next = run(p, trim(p, -1));
    expect(spans(next, "v1")).toEqual([[0, 3], [3, 7]]);
    expect(spans(next, "a2")).toEqual([[4, 6]]);
    const q = project([
      track("v1", "video", [clip("v-a", "v1", 0, 4), clip("v-b", "v1", 4, 4)]),
      track("a2", "audio", [clip("m-1", "a2", 1, 5)]),
    ]);
    expect(() => trim(q, -1)).toThrow(/"A2"/);
    q.timeline.tracks[1] = { ...q.timeline.tracks[1], syncLock: false };
    expect(spans(run(q, trim(q, -1)), "a2")).toEqual([[1, 6]]);
  });

  it("undo restores exactly", () => {
    const p = project([
      track("v1", "video", [clip("v-a", "v1", 0, 4), clip("v-b", "v1", 4, 4)]),
      track("a2", "audio", [clip("m-1", "a2", 2, 6)]),
    ]);
    const plan = trim(p, 1);
    expect(normal(undoOf(p, plan))).toBe(normal(p));
  });
});

describe("targeting and source patch", () => {
  const p = project([
    track("v1", "video", []),
    track("v2", "video", []),
    track("a1", "audio", []),
    track("a2", "audio", []),
    track("a3", "audio", [], { locked: true }),
  ]);

  it("patch beats targeted beats selected beats main", () => {
    const choose = (extra: object) =>
      chooseTrackForMedia(p, { mediaKind: "audio", ...extra });
    const id = (choice: ReturnType<typeof choose>) =>
      choice.kind === "existing" ? choice.track.id : "create";
    expect(id(choose({}))).toBe("a1");
    expect(id(choose({ targetedTrackIds: ["a2"] }))).toBe("a2");
    expect(id(choose({ targetedTrackIds: ["a2"], targetTrackId: "a1" }))).toBe("a1");
    expect(id(choose({ targetedTrackIds: ["v1"], selectedTrackId: "a2" }))).toBe("a2");
    expect(id(choose({ targetedTrackIds: ["a3"] }))).toBe("a1");
  });

  it("splits a video source across patched video and audio tracks", () => {
    const resolved = resolveSourceTracks(p, {
      mediaType: "video",
      hasAudio: true,
      patch: { video: "v2", audio: "a2" },
    });
    expect(resolved.primary).toMatchObject({ kind: "existing", track: { id: "v2" } });
    expect(resolved.audio).toMatchObject({ kind: "existing", track: { id: "a2" } });
  });

  it("does not split without a usable audio patch or for silent/audio-only sources", () => {
    expect(
      resolveSourceTracks(p, { mediaType: "video", patch: { video: "v2" } }).audio,
    ).toBeUndefined();
    expect(
      resolveSourceTracks(p, { mediaType: "video", patch: { audio: "a3" } }).audio,
    ).toBeUndefined();
    expect(
      resolveSourceTracks(p, { mediaType: "video", hasAudio: false, patch: { audio: "a2" } })
        .audio,
    ).toBeUndefined();
    const audioOnly = resolveSourceTracks(p, {
      mediaType: "audio",
      patch: { video: "v2", audio: "a2" },
    });
    expect(audioOnly.audio).toBeUndefined();
    expect(audioOnly.primary).toMatchObject({ track: { id: "a2" } });
  });

  it("planSourceEdit places linked picture and sound clips on the patched tracks in one plan", () => {
    const base = project([
      track("v1", "video", [clip("v-a", "v1", 0, 8)]),
      track("v2", "video", []),
      track("a1", "audio", [clip("a-a", "a1", 0, 8)]),
      track("a2", "audio", []),
    ]);
    const media = base.mediaLibrary.items[0];
    const { plan } = planSourceEdit(base, {
      mode: "insert",
      media: media as never,
      trackId: "v2",
      clipId: "pic",
      operationId: "op",
      sourceIn: 1,
      sourceOut: 4,
      playhead: 2,
      audioPatch: { trackId: "a2", clipId: "snd" },
    });
    const next = run(base, plan);
    const pic = next.timeline.tracks[1].clips[0];
    const snd = next.timeline.tracks[3].clips[0];
    expect([pic.id, pic.startTime, pic.duration, pic.volume]).toEqual(["pic", 2, 3, 0]);
    expect([snd.id, snd.startTime, snd.duration]).toEqual(["snd", 2, 3]);
    expect(snd.metadata?.separatedFromClipId).toBe("pic");
    expect(snd.transform.opacity).toBe(0);
    // Insert rippled the sync-locked V1/A1 by the same length.
    expect(spans(next, "v1")).toEqual([[0, 2], [5, 11]]);
    expect(spans(next, "a1")).toEqual([[0, 2], [5, 11]]);
    expect(normal(undoOf(base, plan))).toBe(normal(base));
  });

  it("planAddEdit cuts only the given tracks", () => {
    const base = project([
      track("v1", "video", [clip("v-a", "v1", 0, 8)]),
      track("a1", "audio", [clip("a-a", "a1", 0, 8)]),
    ]);
    const next = run(base, planAddEdit(base, 3, "op", ["a1"]));
    expect(spans(next, "v1")).toEqual([[0, 8]]);
    expect(spans(next, "a1")).toEqual([[0, 3], [3, 8]]);
    expect(spans(run(base, planAddEdit(base, 3, "op")), "v1")).toEqual([[0, 3], [3, 8]]);
  });
});

// ---- property-based: sync-locked tracks stay aligned across the edit point ----

interface Layout {
  tracks: { syncLock: boolean; clips: [number, number][] }[];
}
const layoutArb = fc.record({
  tracks: fc.array(
    fc.record({
      syncLock: fc.boolean(),
      // Each entry is (gap, length) in whole seconds, laid out left to right.
      clips: fc
        .array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 4 })), {
          maxLength: 5,
        })
        .map((pairs) => {
          let t = 0;
          return pairs.map(([gap, length]): [number, number] => {
            t += gap;
            const range: [number, number] = [t, length];
            t += length;
            return range;
          });
        }),
    }),
    { minLength: 2, maxLength: 4 },
  ),
});

function build(layout: Layout): Project {
  return project(
    layout.tracks.map((t, i) =>
      track(
        `t${i}`,
        i === 0 ? "video" : "audio",
        t.clips.map(([start, length], j) => clip(`c${i}-${j}`, `t${i}`, start, length)),
        { syncLock: t.syncLock },
      ),
    ),
  );
}
/** Is anything on the track at the middle of unit slot `slot`? */
function occupied(p: Project, trackId: string, slot: number): boolean {
  const at = slot + 0.5;
  return p.timeline.tracks
    .find((t) => t.id === trackId)!
    .clips.some((c) => c.startTime <= at && at < c.startTime + c.duration);
}
const SLOTS = 40;

describe("property: sync-locked tracks stay aligned across any ripple edit", () => {
  it("Insert: followers keep their picture before the point and shift by the length after it", () => {
    const media = project([]).mediaLibrary.items[0];
    fc.assert(
      fc.property(layoutArb, fc.integer({ min: 0, max: 12 }), fc.integer({ min: 1, max: 5 }), (layout, at, length) => {
        const p = build(layout);
        const dest = "t0";
        const plan = planInsert(
          p,
          at,
          [
            {
              trackId: dest,
              clip: createMediaClip(media as never, dest, "new", { inPoint: 0, outPoint: length }),
            },
          ],
          "op",
        );
        const next = run(p, plan);
        layout.tracks.forEach((t, i) => {
          const id = `t${i}`;
          for (let slot = 0; slot < SLOTS; slot++) {
            if (id === dest || t.syncLock) {
              if (slot < at) expect(occupied(next, id, slot)).toBe(occupied(p, id, slot));
              else if (slot >= at + length && id !== dest)
                expect(occupied(next, id, slot)).toBe(occupied(p, id, slot - length));
              else if (slot >= at && slot < at + length && id !== dest)
                expect(occupied(next, id, slot)).toBe(false);
            } else {
              expect(occupied(next, id, slot)).toBe(occupied(p, id, slot));
            }
          }
        });
        expect(normal(undoOf(p, plan))).toBe(normal(p));
      }),
      { numRuns: 150 },
    );
  });

  it("Ripple delete: either blocked on a non-empty sync-locked follower or every locked track shifts by the clip length", () => {
    fc.assert(
      fc.property(layoutArb, fc.nat(), (layout, pick) => {
        const p = build(layout);
        const victims = p.timeline.tracks[0].clips;
        if (!victims.length) return;
        const victim = victims[pick % victims.length];
        const L = victim.duration;
        const s = victim.startTime;
        const followers = layout.tracks
          .map((t, i) => ({ t, id: `t${i}` }))
          .filter(({ t, id }) => id !== "t0" && t.syncLock);
        const blocked = followers.some(({ id }) => {
          for (let slot = s; slot < s + L; slot++) if (occupied(p, id, slot)) return true;
          return false;
        });
        if (blocked) {
          expect(() => planRippleDelete(p, [victim.id], "op")).toThrow(SyncLockBlockedError);
          return;
        }
        const plan = planRippleDelete(p, [victim.id], "op");
        const next = run(p, plan);
        layout.tracks.forEach((t, i) => {
          const id = `t${i}`;
          const shifts = id === "t0" || t.syncLock;
          for (let slot = 0; slot < SLOTS; slot++) {
            const expected = !shifts || slot < s
              ? occupied(p, id, slot)
              : occupied(p, id, slot + L);
            expect(occupied(next, id, slot)).toBe(expected);
          }
        });
        expect(normal(undoOf(p, plan))).toBe(normal(p));
      }),
      { numRuns: 200 },
    );
  });

  it("Extract on targeted tracks: followers remove the same range when empty, else the edit is blocked", () => {
    fc.assert(
      fc.property(
        layoutArb,
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 1, max: 5 }),
        (layout, start, length) => {
          const p = build(layout);
          const end = start + length;
          const followers = layout.tracks
            .map((t, i) => ({ t, id: `t${i}` }))
            .filter(({ t, id }) => id !== "t0" && t.syncLock);
          const blocked = followers.some(({ id }) => {
            for (let slot = start; slot < end; slot++) if (occupied(p, id, slot)) return true;
            return false;
          });
          if (blocked) {
            expect(() => planExtract(p, { start, end }, "op", ["t0"])).toThrow(SyncLockBlockedError);
            return;
          }
          const plan = planExtract(p, { start, end }, "op", ["t0"]);
          const next = run(p, plan);
          layout.tracks.forEach((t, i) => {
            const id = `t${i}`;
            const shifts = id === "t0" || t.syncLock;
            for (let slot = 0; slot < SLOTS; slot++) {
              const expected = !shifts || slot < start
                ? occupied(p, id, slot)
                : occupied(p, id, slot + length);
              expect(occupied(next, id, slot)).toBe(expected);
            }
          });
          expect(normal(undoOf(p, plan))).toBe(normal(p));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("relative offsets between clips on sync-locked tracks are identical on each side of the edit point", () => {
    fc.assert(
      fc.property(layoutArb, fc.integer({ min: 0, max: 12 }), fc.integer({ min: 1, max: 5 }), (layout, at, length) => {
        const p = build(layout);
        const media = p.mediaLibrary.items[0];
        const next = run(
          p,
          planInsert(
            p,
            at,
            [{ trackId: "t0", clip: createMediaClip(media as never, "t0", "new", { inPoint: 0, outPoint: length }) }],
            "op",
          ),
        );
        // Every original clip starting at/after the point on a shifted track
        // moved by exactly the inserted length; earlier clips did not move.
        for (const t of p.timeline.tracks) {
          const shifts = t.id === "t0" || isSyncLocked(t);
          const nextTrack = next.timeline.tracks.find((x) => x.id === t.id)!;
          for (const c of t.clips) {
            const moved = nextTrack.clips.find((x) => x.id === c.id);
            if (!moved) continue;
            const expected = shifts && c.startTime >= at ? c.startTime + length : c.startTime;
            expect(moved.startTime).toBeCloseTo(expected, 6);
          }
        }
      }),
      { numRuns: 120 },
    );
  });
});

describe("track/setSyncLock action", () => {
  it("toggles the flag as one undoable action and rejects bad params", async () => {
    const p = layout();
    const executor = new ActionExecutor();
    const set = (syncLock: unknown) =>
      executor.execute(
        { type: "track/setSyncLock", id: "s", timestamp: 1, params: { trackId: "a2", syncLock } } as never,
        p,
      );
    expect((await set(false)).success).toBe(true);
    expect(p.timeline.tracks[2].syncLock).toBe(false);
    expect((await executor.undo(p)).success).toBe(true);
    expect(isSyncLocked(p.timeline.tracks[2])).toBe(true);
    expect((await executor.redo(p)).success).toBe(true);
    expect(p.timeline.tracks[2].syncLock).toBe(false);
    expect((await set("no")).success).toBe(false);
    const missing = await executor.execute(
      { type: "track/setSyncLock", id: "m", timestamp: 1, params: { trackId: "nope", syncLock: true } } as never,
      p,
    );
    expect(missing.success).toBe(false);
  });
});
