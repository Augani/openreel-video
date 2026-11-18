import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action, Clip, LiveDuckingConfig, Project, Track } from "../types";
import { resolveClipVolumeAutomation } from "./clip-audio-resolution";
import { applyLiveDuckingToLane, dialogueActivityFor, DEFAULT_LIVE_DUCKING, getLiveDucking, normalizeLiveDucking } from "./live-ducking";
import { createClipFragment } from "../editing/clip-fragments";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number, extra: Partial<Clip> = {}): Clip =>
  ({
    id,
    mediaId: `media-${id}`,
    trackId,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    volume: 1,
    effects: [],
    audioEffects: [],
    keyframes: [],
    transform,
    ...extra,
  }) as Clip;
const track = (id: string, role: Track["role"], clips: Clip[], extra: Partial<Track> = {}): Track =>
  ({ id, type: "audio", role, name: id, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;

const CONFIG: LiveDuckingConfig = { enabled: true, amountDb: 12, attackMs: 100, releaseMs: 200, holdMs: 100 };
const DB12 = Math.pow(10, -12 / 20);

function project(dialogue: Clip[], music: Clip): Project {
  return {
    id: "p",
    name: "p",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: {
      duration: 20,
      subtitles: [],
      markers: [],
      tracks: [track("dlg", "dialogue", dialogue), track("mus", "music", [music])],
    },
  } as unknown as Project;
}

const gainAt = (lane: { time: number; value: number }[], t: number) => {
  for (let i = 1; i < lane.length; i += 1) {
    if (t <= lane[i].time) {
      const a = lane[i - 1];
      const b = lane[i];
      return b.time === a.time ? b.value : a.value + ((b.value - a.value) * (t - a.time)) / (b.time - a.time);
    }
  }
  return lane[lane.length - 1].value;
};

describe("live ducking lane", () => {
  const music = clip("m", "mus", 0, 20, { metadata: { liveDucking: CONFIG } });

  it("is the base lane when no dialogue overlaps", () => {
    const tl = project([], music).timeline;
    expect(resolveClipVolumeAutomation(music, tl)).toEqual([]);
  });

  it("dips by the configured amount while dialogue plays, with attack and release ramps", () => {
    const tl = project([clip("d", "dlg", 5, 4)], music).timeline;
    const lane = resolveClipVolumeAutomation(music, tl);
    expect(gainAt(lane, 4)).toBeCloseTo(1, 6);
    expect(gainAt(lane, 4.9)).toBeCloseTo(1, 6);
    expect(gainAt(lane, 5)).toBeCloseTo(DB12, 6);
    expect(gainAt(lane, 7)).toBeCloseTo(DB12, 6);
    expect(gainAt(lane, 9)).toBeCloseTo(DB12, 6);
    expect(gainAt(lane, 9.2)).toBeCloseTo(1, 6);
    expect(gainAt(lane, 12)).toBeCloseTo(1, 6);
  });

  it("follows the dialogue clips when they move or trim (recomputed, never stored)", () => {
    const first = project([clip("d", "dlg", 5, 4)], music);
    const before = resolveClipVolumeAutomation(music, first.timeline);
    const moved = project([clip("d", "dlg", 12, 4)], music);
    const afterMove = resolveClipVolumeAutomation(music, moved.timeline);
    expect(gainAt(afterMove, 7)).toBeCloseTo(1, 6);
    expect(gainAt(afterMove, 13)).toBeCloseTo(DB12, 6);
    expect(gainAt(before, 7)).toBeCloseTo(DB12, 6);
    const trimmed = project([clip("d", "dlg", 5, 1)], music);
    const afterTrim = resolveClipVolumeAutomation(music, trimmed.timeline);
    expect(gainAt(afterTrim, 5.5)).toBeCloseTo(DB12, 6);
    expect(gainAt(afterTrim, 8)).toBeCloseTo(1, 6);
    // nothing about the duck was written to the clip
    expect(music.automation).toBeUndefined();
  });

  it("keeps the duck down across short gaps between dialogue clips and releases across long ones", () => {
    const short = project([clip("a", "dlg", 5, 2), clip("b", "dlg", 7.1, 2)], music).timeline;
    expect(gainAt(resolveClipVolumeAutomation(music, short), 7.05)).toBeCloseTo(DB12, 6);
    const long = project([clip("a", "dlg", 5, 2), clip("b", "dlg", 10, 2)], music).timeline;
    expect(gainAt(resolveClipVolumeAutomation(music, long), 8.5)).toBeCloseTo(1, 6);
    expect(gainAt(resolveClipVolumeAutomation(music, long), 11)).toBeCloseTo(DB12, 6);
  });

  it("ignores muted dialogue tracks, non-dialogue tracks and the clip itself", () => {
    const base = project([clip("d", "dlg", 5, 4)], music);
    const muted = { ...base.timeline, tracks: base.timeline.tracks.map((t) => (t.id === "dlg" ? { ...t, muted: true } : t)) };
    expect(resolveClipVolumeAutomation(music, muted)).toEqual([]);
    const sfx = { ...base.timeline, tracks: base.timeline.tracks.map((t) => (t.id === "dlg" ? { ...t, role: "effects" as const } : t)) };
    expect(resolveClipVolumeAutomation(music, sfx)).toEqual([]);
    expect(dialogueActivityFor(music, base.timeline, normalizeLiveDucking(CONFIG))).toHaveLength(1);
    const tagged = project([], music);
    const withTag = {
      ...tagged.timeline,
      tracks: [...tagged.timeline.tracks, track("other", "general", [clip("t", "other", 2, 1, { audioType: "dialogue" })])],
    };
    expect(gainAt(resolveClipVolumeAutomation(music, withTag), 2.5)).toBeCloseTo(DB12, 6);
  });

  it("multiplies the clip's own volume lane and base volume", () => {
    const own = clip("m", "mus", 0, 20, { volume: 0.5, metadata: { liveDucking: CONFIG } });
    const tl = project([clip("d", "dlg", 5, 4)], own).timeline;
    const lane = resolveClipVolumeAutomation(own, tl);
    expect(gainAt(lane, 1)).toBeCloseTo(0.5, 6);
    expect(gainAt(lane, 6)).toBeCloseTo(0.5 * DB12, 6);
    const withLane = clip("m", "mus", 0, 20, {
      volume: 1,
      automation: { volume: [{ time: 0, value: 1 }, { time: 20, value: 2 }] },
      metadata: { liveDucking: CONFIG },
    });
    const tl2 = project([clip("d", "dlg", 10, 2)], withLane).timeline;
    const lane2 = resolveClipVolumeAutomation(withLane, tl2);
    expect(gainAt(lane2, 5)).toBeCloseTo(1.25, 6);
    expect(gainAt(lane2, 11)).toBeCloseTo(1.55 * DB12, 3);
  });

  it("applyLiveDuckingToLane leaves clips without the config alone and normalises bad input", () => {
    const plain = clip("p", "mus", 0, 20);
    const tl = project([clip("d", "dlg", 5, 4)], plain).timeline;
    expect(applyLiveDuckingToLane(plain, tl, [])).toEqual([]);
    expect(getLiveDucking(plain)).toBeNull();
    expect(normalizeLiveDucking({ amountDb: 999, attackMs: -4 })).toMatchObject({ amountDb: 40, attackMs: 10 });
    expect(normalizeLiveDucking(null)).toEqual(DEFAULT_LIVE_DUCKING);
    expect(getLiveDucking({ metadata: { liveDucking: { ...CONFIG, enabled: false } } })).toBeNull();
  });

  it("is not baked into split fragments (no double ducking)", () => {
    const own = clip("m", "mus", 0, 20, { metadata: { liveDucking: CONFIG } });
    const p = project([clip("d", "dlg", 5, 4)], own);
    const fragment = createClipFragment(own, { fromTime: 5, startTime: 5, duration: 5 } as never, "frag", p);
    expect(fragment.automation?.volume).toBeUndefined();
    expect(fragment.metadata?.liveDucking).toEqual(CONFIG);
  });
});

describe("audio/setLiveDucking action", () => {
  const apply = (executor: ActionExecutor, p: Project, config: LiveDuckingConfig | null) =>
    executor.execute({ id: crypto.randomUUID(), timestamp: Date.now(), type: "audio/setLiveDucking", params: { clipId: "m", config } } as unknown as Action, p);

  it("turns the duck on and off, and undo/redo restore it exactly", async () => {
    const p = project([clip("d", "dlg", 5, 4)], clip("m", "mus", 0, 20));
    const executor = new ActionExecutor();
    const read = () => p.timeline.tracks[1].clips[0];
    expect((await apply(executor, p, CONFIG)).success).toBe(true);
    expect(read().metadata?.liveDucking).toEqual(CONFIG);
    expect(gainAt(resolveClipVolumeAutomation(read(), p.timeline), 6)).toBeCloseTo(DB12, 6);
    expect((await executor.undo(p)).success).toBe(true);
    expect(read().metadata).toBeUndefined();
    expect(resolveClipVolumeAutomation(read(), p.timeline)).toEqual([]);
    expect((await executor.redo(p)).success).toBe(true);
    expect(read().metadata?.liveDucking).toEqual(CONFIG);
    expect((await apply(executor, p, null)).success).toBe(true);
    expect(read().metadata).toBeUndefined();
    expect((await executor.undo(p)).success).toBe(true);
    expect(read().metadata?.liveDucking).toEqual(CONFIG);
  });

  it("rejects malformed config", async () => {
    const p = project([], clip("m", "mus", 0, 20));
    const bad = await apply(new ActionExecutor(), p, { enabled: true, amountDb: Number.NaN, attackMs: 1, releaseMs: 1, holdMs: 1 });
    expect(bad.success).toBe(false);
    expect(p.timeline.tracks[1].clips[0].metadata).toBeUndefined();
  });
});
