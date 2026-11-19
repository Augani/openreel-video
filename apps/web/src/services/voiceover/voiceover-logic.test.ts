import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_OVER_PREFS,
  audioTrackChoices,
  chooseTakeTrack,
  clampPreRoll,
  countdownSeconds,
  isVoiceOverMediaName,
  listVoiceOverTakes,
  nextTakeNumber,
  nextVoiceTrackName,
  parseTakeNumber,
  parseVoiceOverPrefs,
  peakLevel,
  planTimings,
  punchRange,
  resolveRecordPlan,
  selectVoiceOverMimeType,
  takeName,
  takeTimelineStart,
  type PlacementTrack,
} from "./voiceover-logic";

describe("resolveRecordPlan", () => {
  it("records from the playhead with a pre-roll lead-in", () => {
    const plan = resolveRecordPlan({ playhead: 10, preRoll: 3, punch: false, markIn: 0, markOut: 0 });
    expect(plan).toEqual({ punched: false, recordStart: 10, recordEnd: null, preRoll: 3, playFrom: 7, playDelay: 0 });
  });

  it("delays playback when the pre-roll reaches before the start of the timeline", () => {
    const plan = resolveRecordPlan({ playhead: 1, preRoll: 3, punch: false, markIn: 0, markOut: 0 });
    expect(plan.playFrom).toBe(0);
    expect(plan.playDelay).toBe(2);
    const atZero = resolveRecordPlan({ playhead: 0, preRoll: 2, punch: false, markIn: 0, markOut: 0 });
    expect(atZero.playFrom).toBe(0);
    expect(atZero.playDelay).toBe(2);
  });

  it("starts immediately with zero pre-roll", () => {
    const plan = resolveRecordPlan({ playhead: 4.5, preRoll: 0, punch: false, markIn: 0, markOut: 0 });
    expect(plan).toMatchObject({ recordStart: 4.5, playFrom: 4.5, playDelay: 0, preRoll: 0 });
    expect(planTimings(plan)).toEqual({ startAfterMs: 0, autoStopAfterMs: null });
  });

  it("punches between In and Out regardless of the playhead", () => {
    const plan = resolveRecordPlan({ playhead: 99, preRoll: 2, punch: true, markIn: 8, markOut: 14.5 });
    expect(plan).toEqual({ punched: true, recordStart: 8, recordEnd: 14.5, preRoll: 2, playFrom: 6, playDelay: 0 });
    expect(planTimings(plan)).toEqual({ startAfterMs: 2000, autoStopAfterMs: 6500 });
  });

  it("falls back to a normal take when punch is on but there is no valid In/Out range", () => {
    const plan = resolveRecordPlan({ playhead: 5, preRoll: 1, punch: true, markIn: 0, markOut: 0 });
    expect(plan.punched).toBe(false);
    expect(plan.recordStart).toBe(5);
    expect(plan.recordEnd).toBeNull();
    expect(punchRange(5, 4)).toBeNull();
    expect(punchRange(2, 2.01)).toBeNull();
  });

  it("clamps the pre-roll to 0..5 whole seconds", () => {
    expect(clampPreRoll(9)).toBe(5);
    expect(clampPreRoll(-2)).toBe(0);
    expect(clampPreRoll(2.6)).toBe(3);
    expect(clampPreRoll("x")).toBe(DEFAULT_VOICE_OVER_PREFS.preRoll);
    expect(resolveRecordPlan({ playhead: 20, preRoll: 12, punch: false, markIn: 0, markOut: 0 }).preRoll).toBe(5);
  });
});

describe("countdownSeconds", () => {
  it("counts whole seconds down to zero", () => {
    expect([3000, 2999, 1001, 1000, 1, 0, -5].map(countdownSeconds)).toEqual([3, 3, 2, 1, 1, 0, 0]);
  });
});

describe("takeTimelineStart", () => {
  it("moves the take earlier by the input latency, within bounds", () => {
    expect(takeTimelineStart(10, 0.04)).toBeCloseTo(9.96);
    expect(takeTimelineStart(10, 5)).toBe(9.75);
    expect(takeTimelineStart(0.01, 0.1)).toBe(0);
    expect(takeTimelineStart(10, undefined)).toBe(10);
    expect(takeTimelineStart(10, Number.NaN)).toBe(10);
    expect(takeTimelineStart(10, -1)).toBe(10);
  });
});

describe("take naming", () => {
  it("numbers takes after the highest existing one", () => {
    expect(nextTakeNumber([])).toBe(1);
    expect(nextTakeNumber(["Music.mp3", "Voice Over Take 1.webm", "Voice Over Take 4.webm", "Voice Over Take 2.webm"])).toBe(5);
    expect(takeName(3)).toBe("Voice Over Take 3");
    expect(parseTakeNumber("Voice Over Take 12.webm")).toBe(12);
    expect(parseTakeNumber("Voice Over Take 7")).toBe(7);
    expect(parseTakeNumber("My Voice Over Take 7")).toBeNull();
  });

  it("recognises older date-stamped voice-overs", () => {
    expect(isVoiceOverMediaName("Voice-over 2026-05-22T10-11-12-000Z.webm")).toBe(true);
    expect(isVoiceOverMediaName("Interview.webm")).toBe(false);
  });

  it("names new tracks Voice Over, Voice Over 2, ...", () => {
    expect(nextVoiceTrackName([{ name: "Audio 1" }])).toBe("Voice Over");
    expect(nextVoiceTrackName([{ name: "Voice Over" }])).toBe("Voice Over 2");
    expect(nextVoiceTrackName([{ name: "Voice Over" }, { name: "Voice Over 2" }])).toBe("Voice Over 3");
  });
});

const track = (id: string, patch: Partial<PlacementTrack> = {}): PlacementTrack => ({
  id,
  name: id,
  type: "audio",
  locked: false,
  clips: [],
  ...patch,
});

describe("chooseTakeTrack", () => {
  it("creates a new track when none is chosen", () => {
    expect(chooseTakeTrack([track("a1")], "", 0, 5)).toEqual({ kind: "new", trackName: "Voice Over", reason: "requested" });
  });

  it("uses the chosen track when the range is free", () => {
    const tracks = [track("a1", { clips: [{ startTime: 0, duration: 4 }] })];
    expect(chooseTakeTrack(tracks, "a1", 4, 9)).toEqual({ kind: "existing", trackId: "a1" });
  });

  it("stacks onto a new track when the range is occupied (a re-take never overlaps)", () => {
    const tracks = [track("a1", { name: "Voice Over", clips: [{ startTime: 2, duration: 6 }] })];
    expect(chooseTakeTrack(tracks, "a1", 5, 9)).toEqual({ kind: "new", trackName: "Voice Over 2", reason: "occupied" });
    expect(chooseTakeTrack(tracks, "a1", 0, 3)).toMatchObject({ kind: "new", reason: "occupied" });
  });

  it("treats touching clips as free", () => {
    const tracks = [track("a1", { clips: [{ startTime: 0, duration: 5 }] })];
    expect(chooseTakeTrack(tracks, "a1", 5, 8).kind).toBe("existing");
  });

  it("does not record onto a missing, locked or non-audio track", () => {
    expect(chooseTakeTrack([track("a1", { locked: true })], "a1", 0, 2)).toMatchObject({ kind: "new", reason: "unavailable" });
    expect(chooseTakeTrack([track("v1", { type: "video" })], "v1", 0, 2)).toMatchObject({ kind: "new", reason: "unavailable" });
    expect(chooseTakeTrack([], "gone", 0, 2)).toMatchObject({ kind: "new", reason: "unavailable" });
  });

  it("offers only unlocked audio tracks", () => {
    const tracks = [track("a1"), track("a2", { locked: true }), track("v1", { type: "video" })];
    expect(audioTrackChoices(tracks).map((t) => t.id)).toEqual(["a1"]);
  });
});

describe("listVoiceOverTakes", () => {
  it("lists older recordings first, then takes in recording order", () => {
    const names = new Map([
      ["m1", "Voice Over Take 2.webm"],
      ["m2", "Voice Over Take 1.webm"],
      ["m3", "Voice-over 2026-01-02T03-04-05-000Z.webm"],
      ["m4", "Music.mp3"],
    ]);
    const takes = listVoiceOverTakes(
      [
        { id: "t1", clips: [{ id: "c1", mediaId: "m1", startTime: 9, duration: 3 }, { id: "c4", mediaId: "m4", startTime: 0, duration: 30 }] },
        { id: "t2", clips: [{ id: "c2", mediaId: "m2", startTime: 2, duration: 4 }, { id: "c3", mediaId: "m3", startTime: 1, duration: 2 }] },
      ],
      names,
    );
    expect(takes.map((t) => t.clipId)).toEqual(["c3", "c2", "c1"]);
    expect(takes[1]).toMatchObject({ name: "Voice Over Take 1", number: 1, trackId: "t2", duration: 4 });
  });
});

describe("parseVoiceOverPrefs", () => {
  it("round-trips and falls back on bad input", () => {
    const saved = { deviceId: "mic-7", preRoll: 4, punch: true, muteDuringRecord: false, targetTrackId: "t9" };
    expect(parseVoiceOverPrefs(JSON.stringify(saved))).toEqual(saved);
    expect(parseVoiceOverPrefs(null)).toEqual(DEFAULT_VOICE_OVER_PREFS);
    expect(parseVoiceOverPrefs("{not json")).toEqual(DEFAULT_VOICE_OVER_PREFS);
    expect(parseVoiceOverPrefs('{"preRoll":99,"punch":"yes"}')).toMatchObject({ preRoll: 5, punch: false });
  });
});

describe("meter and format helpers", () => {
  it("peakLevel is 0 for silence and 1 at full scale", () => {
    expect(peakLevel([128, 128, 128])).toBe(0);
    expect(peakLevel([128, 0, 128])).toBe(1);
    expect(peakLevel([128, 192])).toBeCloseTo(0.5);
  });

  it("selects the first supported recording format", () => {
    expect(selectVoiceOverMimeType((t) => t === "audio/webm;codecs=opus")).toEqual({ mimeType: "audio/webm;codecs=opus", extension: "webm" });
    expect(selectVoiceOverMimeType((t) => t === "audio/mp4")).toEqual({ mimeType: "audio/mp4", extension: "m4a" });
    expect(selectVoiceOverMimeType(() => false)).toBeNull();
  });
});
