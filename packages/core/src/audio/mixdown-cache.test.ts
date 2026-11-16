import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import type { Clip, Track } from "../types/timeline";
import {
  MixdownCache,
  audioRangeFingerprint,
  renderMixdownCached,
  type MixChunk,
} from "./mixdown-cache";

const clip = (id: string, startTime: number, duration: number, over: Partial<Clip> = {}): Clip => ({
  id, mediaId: "m1", trackId: "a1", startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  volume: 1, keyframes: [], ...over,
});

const track = (id: string, clips: Clip[], over: Partial<Track> = {}): Track => ({
  id, type: "audio", name: id, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false, ...over,
});

const project = (tracks: Track[], over: Partial<Project["timeline"]> = {}): Project => ({
  id: "p", name: "P", createdAt: 0, modifiedAt: 0,
  settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
  timeline: { duration: 60, markers: [], subtitles: [], tracks, ...over },
  mediaLibrary: { items: [{ id: "m1", name: "a.wav", type: "audio", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { duration: 60 } }] },
} as unknown as Project);

const base = () => project([track("a1", [clip("c1", 0, 10), clip("c2", 30, 10)])]);
const fp = (p: Project, start = 0, dur = 15) => audioRangeFingerprint(p, start, dur);
const withClip = (p: Project, id: string, patch: Partial<Clip>): Project => ({
  ...p,
  timeline: {
    ...p.timeline,
    tracks: p.timeline.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
  },
});

describe("audioRangeFingerprint exact invalidation", () => {
  it("is stable for an unchanged project", () => {
    expect(fp(base())).toBe(fp(base()));
  });

  it("sees in-place edits (the action system mutates the project object)", () => {
    const p = base();
    const before = fp(p);
    (p.timeline.tracks[0].clips[0] as { volume: number }).volume = 0.25;
    expect(fp(p)).not.toBe(before);
    (p.timeline.tracks[0].clips[0] as { volume: number }).volume = 1;
    expect(fp(p)).toBe(before);
  });

  it("changes when clip volume, fade, automation, speed or in point change", () => {
    const p = base();
    const f = fp(p);
    expect(fp(withClip(p, "c1", { volume: 0.5 }))).not.toBe(f);
    expect(fp(withClip(p, "c1", { fade: { fadeIn: 1, fadeOut: 0 } as Clip["fade"] }))).not.toBe(f);
    expect(fp(withClip(p, "c1", { automation: { volume: [{ time: 0, value: 0.2 }] } as unknown as Clip["automation"] }))).not.toBe(f);
    expect(fp(withClip(p, "c1", { speed: 2 }))).not.toBe(f);
    expect(fp(withClip(p, "c1", { inPoint: 1 }))).not.toBe(f);
  });

  it("changes when a clip moves into, out of, or within the window", () => {
    const p = base();
    expect(fp(withClip(p, "c1", { startTime: 2 }))).not.toBe(fp(p));
    expect(fp(withClip(p, "c2", { startTime: 5 }))).not.toBe(fp(p));
  });

  it("does not change a window a distant clip edit cannot reach (no processing)", () => {
    const p = base();
    expect(fp(withClip(p, "c2", { volume: 0.1 }), 0, 15)).toBe(fp(p, 0, 15));
    expect(fp(withClip(p, "c2", { volume: 0.1 }), 30, 10)).not.toBe(fp(p, 30, 10));
  });

  it("ignores visual-only edits", () => {
    const p = base();
    const moved = withClip(p, "c1", {
      transform: { position: { x: 50, y: 20 }, scale: { x: 2, y: 2 }, rotation: 9, anchor: { x: 0, y: 0 }, opacity: 0.4 },
      blendMode: "multiply" as Clip["blendMode"],
    });
    expect(fp(moved)).toBe(fp(p));
  });

  it("changes with clip audio effects, mute, solo and track racks", () => {
    const p = base();
    const f = fp(p);
    const fx = withClip(p, "c1", { audioEffects: [{ id: "e", type: "eq", params: { bands: [] }, enabled: true }] });
    expect(fp(fx)).not.toBe(f);
    const muted = { ...p, timeline: { ...p.timeline, tracks: [{ ...p.timeline.tracks[0], muted: true }] } };
    expect(fp(muted)).not.toBe(f);
    const solo = { ...p, timeline: { ...p.timeline, tracks: [{ ...p.timeline.tracks[0], solo: true }] } };
    expect(fp(solo)).not.toBe(f);
    const rack = { ...p, timeline: { ...p.timeline, tracks: [{ ...p.timeline.tracks[0], audioRack: { effects: [], volume: 0.5 } }] } };
    expect(fp(rack as Project)).not.toBe(f);
  });

  it("changes with the 5.1 layout and with every surround position (clip and track)", () => {
    const p = base();
    const f = fp(p);
    const surround = { ...p, settings: { ...p.settings, channelLayout: "5.1" as const, channels: 6 } };
    const fs = fp(surround);
    expect(fs).not.toBe(f);
    const pan = { x: -1, y: 1, divergence: 0, lfeSend: 0 };
    expect(fp(withClip(surround, "c1", { surroundPan: pan }))).not.toBe(fs);
    expect(fp(withClip(surround, "c1", { surroundPan: { ...pan, lfeSend: 0.5 } }))).not.toBe(fp(withClip(surround, "c1", { surroundPan: pan })));
    const trackPanned = { ...surround, timeline: { ...surround.timeline, tracks: surround.timeline.tracks.map((t) => ({ ...t, surroundPan: pan })) } };
    expect(fp(trackPanned)).not.toBe(fs);
  });

  it("changes with the master rack and the project sample rate", () => {
    const p = base();
    const master = { ...p, timeline: { ...p.timeline, masterAudioRack: { effects: [], volume: 0.7 } } } as Project;
    expect(fp(master)).not.toBe(fp(p));
    const sr = { ...p, settings: { ...p.settings, sampleRate: 44100 } } as Project;
    expect(fp(sr)).not.toBe(fp(p));
  });

  it("with tail-capable effects, an earlier clip edit re-keys later windows", () => {
    const p = withClip(base(), "c1", { audioEffects: [{ id: "e", type: "reverb", params: { wetLevel: 0.5, roomSize: 0.9 }, enabled: true }] });
    const edited = withClip(p, "c1", { volume: 0.2 });
    expect(fp(edited, 30, 10)).not.toBe(fp(p, 30, 10));
    // later edits still cannot reach earlier windows
    expect(fp(withClip(p, "c2", { volume: 0.2 }), 0, 15)).toBe(fp(p, 0, 15));
  });

  it("changes when the source media is relinked to another blob", () => {
    const p = base();
    const a = { ...p, mediaLibrary: { items: [{ ...p.mediaLibrary.items[0], blob: new Blob(["aaa"]) }] } } as Project;
    const b = { ...p, mediaLibrary: { items: [{ ...p.mediaLibrary.items[0], blob: new Blob(["aaa"]) }] } } as Project;
    expect(fp(a)).not.toBe(fp(b));
    expect(fp(a)).toBe(fp(a));
  });

  it("includes a linked clip on a hidden track (it supplies audio effects)", () => {
    const p = project([
      track("a1", [clip("c1", 0, 10)]),
      track("v1", [clip("v", 0, 10, { trackId: "v1" })], { type: "video", hidden: true }),
    ]);
    const edited = withClip(p, "v", { audioEffects: [{ id: "e", type: "eq", params: {}, enabled: true }] });
    expect(fp(edited)).not.toBe(fp(p));
  });
});

describe("MixdownCache", () => {
  const chunk = (n: number): MixChunk => ({ sampleRate: 48000, channels: [new Float32Array(n), new Float32Array(n)] });

  it("evicts least-recently-used entries over budget and counts hits", () => {
    const cache = new MixdownCache(1000);
    cache.set("a", chunk(60)); // 480 B
    cache.set("b", chunk(60));
    expect(cache.get("a")).toBeDefined(); // a is now most recent
    cache.set("c", chunk(60)); // evicts b
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.getStats()).toMatchObject({ hits: 2, misses: 1, entries: 2 });
  });

  it("renderMixdownCached renders once per fingerprint and returns an isolated copy", async () => {
    const cache = new MixdownCache();
    const p = base();
    let renders = 0;
    const make = (): { numberOfChannels: number; sampleRate: number; getChannelData(c: number): Float32Array } => {
      renders++;
      const data = new Float32Array([0.5, 0.25]);
      return { numberOfChannels: 1, sampleRate: 48000, getChannelData: () => data };
    };
    const from = (c: MixChunk) => ({ numberOfChannels: c.channels.length, sampleRate: c.sampleRate, getChannelData: (i: number) => new Float32Array(c.channels[i]) });
    const first = await renderMixdownCached(p, 0, 15, async () => make(), from, cache);
    first.getChannelData(0)[0] = 9;
    const second = await renderMixdownCached(p, 0, 15, async () => make(), from, cache);
    expect(renders).toBe(1);
    expect(Array.from(second.getChannelData(0))).toEqual([0.5, 0.25]);
    await renderMixdownCached(withClip(p, "c1", { volume: 0.3 }), 0, 15, async () => make(), from, cache);
    expect(renders).toBe(2);
  });
});
