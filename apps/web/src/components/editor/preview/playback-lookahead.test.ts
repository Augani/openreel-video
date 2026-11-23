import { describe, expect, it } from "vitest";
import {
  isLookaheadStale,
  planLookahead,
  PLAYBACK_LOOKAHEAD_S,
  type LookaheadClip,
  type LookaheadTransition,
} from "./playback-lookahead";

const clip = (id: string, startTime: number, duration: number): LookaheadClip => ({ id, startTime, duration });
// The engine's rule: a centred transition straddles the cut.
const centred = (_t: LookaheadTransition, a: LookaheadClip) => ({ start: a.startTime + a.duration - 0.5, end: a.startTime + a.duration + 0.5 });
const decodable = () => true;

const v1 = [clip("a", 0, 12), clip("b", 12, 12), clip("c", 24, 12)];
const transitions: LookaheadTransition[] = [
  { id: "t1", type: "crossfade", clipAId: "a", clipBId: "b" },
  { id: "t2", type: "wipe", clipAId: "b", clipBId: "c" },
];

describe("planLookahead", () => {
  it("opens the incoming clip when the transition into it is within the horizon, not when its own start is", () => {
    // 11.0: the transition (11.5) is 0.5 s away, the cut (12) is 1 s away: both inside 2 s, but the need point is 11.5.
    const plan = planLookahead({ tracks: [{ clips: v1 }], transitionsByTrack: [transitions], time: 11, transitionWindow: centred, isDecodable: decodable });
    expect(plan.clips.map((c) => [c.clipId, c.needAt, c.reason])).toEqual([["b", 11.5, "transition"]]);
  });

  it("opens the incoming clip 2 s before the transition starts, 0.5 s earlier than a start-only schedule would", () => {
    const horizon = PLAYBACK_LOOKAHEAD_S;
    const early = planLookahead({ tracks: [{ clips: v1 }], transitionsByTrack: [transitions], time: 11.5 - horizon + 0.01, transitionWindow: centred, isDecodable: decodable });
    expect(early.clips.map((c) => c.clipId)).toEqual(["b"]);
    // A start-only schedule (no transitions) would not have scheduled it yet: 12 - 9.51 > 2.
    const startOnly = planLookahead({ tracks: [{ clips: v1 }], transitionsByTrack: [[]], time: 11.5 - horizon + 0.01, transitionWindow: centred, isDecodable: decodable });
    expect(startOnly.clips).toEqual([]);
  });

  it("schedules nothing before the horizon and nothing already needed", () => {
    const far = planLookahead({ tracks: [{ clips: v1 }], transitionsByTrack: [transitions], time: 5, transitionWindow: centred, isDecodable: decodable });
    expect(far.clips).toEqual([]);
    expect(far.transitions).toEqual([]);
    // Inside the transition window both clips are needed now: the frame loop opens them, not the look-ahead.
    const inside = planLookahead({ tracks: [{ clips: v1 }], transitionsByTrack: [transitions], time: 11.7, transitionWindow: centred, isDecodable: decodable });
    expect(inside.clips.map((c) => c.clipId)).not.toContain("b");
  });

  it("lists the transition to warm with the time its first frame is rendered", () => {
    const plan = planLookahead({ tracks: [{ clips: v1 }], transitionsByTrack: [transitions], time: 10, transitionWindow: centred, isDecodable: decodable });
    expect(plan.transitions).toEqual([{ transitionId: "t1", type: "crossfade", clipAId: "a", clipBId: "b", trackIndex: 0, needAt: 11.5 }]);
  });

  it("orders by urgency across tracks and keeps the earliest need point per clip", () => {
    const plan = planLookahead({
      tracks: [{ clips: v1 }, { clips: [clip("o", 12.4, 3)] }],
      transitionsByTrack: [transitions, []],
      time: 11,
      transitionWindow: centred,
      isDecodable: decodable,
    });
    expect(plan.clips.map((c) => c.clipId)).toEqual(["b", "o"]);
  });

  it("skips hidden tracks and clips without a decoder", () => {
    const hidden = planLookahead({ tracks: [{ hidden: true, clips: v1 }], transitionsByTrack: [transitions], time: 11, transitionWindow: centred, isDecodable: decodable });
    expect(hidden.clips).toEqual([]);
    const noDecoder = planLookahead({ tracks: [{ clips: v1 }], transitionsByTrack: [transitions], time: 11, transitionWindow: centred, isDecodable: (c) => c.id !== "b" });
    expect(noDecoder.clips).toEqual([]);
    expect(noDecoder.transitions).toEqual([]);
  });

  it("uses the transition's own window for end-aligned transitions", () => {
    const endAligned = (_t: LookaheadTransition, a: LookaheadClip) => ({ start: a.startTime + a.duration - 1, end: a.startTime + a.duration });
    const plan = planLookahead({ tracks: [{ clips: v1 }], transitionsByTrack: [transitions], time: 10.5, transitionWindow: endAligned, isDecodable: decodable });
    expect(plan.clips.map((c) => [c.clipId, c.needAt])).toEqual([["b", 11]]);
  });
});

describe("isLookaheadStale", () => {
  it("releases a decoder the playhead moved away from or past", () => {
    expect(isLookaheadStale({ needAt: 11.5, endTime: 24 }, 11)).toBe(false);
    expect(isLookaheadStale({ needAt: 11.5, endTime: 24 }, 2)).toBe(true);
    expect(isLookaheadStale({ needAt: 11.5, endTime: 24 }, 24)).toBe(true);
  });
});
