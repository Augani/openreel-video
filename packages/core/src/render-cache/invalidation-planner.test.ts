import { describe, expect, it } from "vitest";
import type { Project, MediaItem } from "../types/project";
import type { Clip, Track, Effect, Transition } from "../types/timeline";
import { planInvalidation } from "./invalidation-planner";
import { rangesContain, type TimeRange } from "./time-ranges";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

function media(id: string, type: MediaItem["type"] = "video"): MediaItem {
  return {
    id,
    name: id,
    type,
    fileHandle: null,
    blob: new Blob([id]),
    metadata: {
      duration: 30,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      sampleRate: 48000,
      channels: 2,
      fileSize: 1,
    },
    thumbnailUrl: null,
    waveformData: null,
  };
}

function clip(id: string, trackId: string, mediaId: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaId,
    trackId,
    startTime: start,
    duration,
    inPoint: 0,
    outPoint: duration,
    effects: [],
    audioEffects: [],
    transform,
    volume: 1,
    keyframes: [],
    ...extra,
  };
}

function track(id: string, clips: Clip[], extra: Partial<Track> = {}): Track {
  return {
    id,
    type: "video",
    name: id,
    clips,
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    ...extra,
  };
}

function fx(type: string, params: Record<string, unknown> = {}): Effect {
  return { id: `fx-${type}`, type, params, enabled: true };
}

function baseProject(): Project {
  return {
    id: "p1",
    name: "Test",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media("m1"), media("m2"), media("a1", "audio")] },
    timeline: {
      tracks: [
        track("v1", [clip("c1", "v1", "m1", 0, 4), clip("c2", "v1", "m2", 4, 4), clip("c3", "v1", "m1", 10, 2)]),
        track("v2", [clip("o1", "v2", "m2", 2, 3)]),
        track("a", [clip("au1", "a", "a1", 0, 12)], { type: "audio" }),
      ],
      subtitles: [],
      markers: [],
      duration: 12,
    },
  };
}

function withTracks(project: Project, tracks: Track[]): Project {
  return { ...project, timeline: { ...project.timeline, tracks } };
}

function mapClip(project: Project, id: string, fn: (c: Clip) => Clip): Project {
  return withTracks(
    project,
    project.timeline.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === id ? fn(c) : c)) })),
  );
}

const plan = (a: Project, b: Project) => planInvalidation(a, b);
const spans = (ranges: readonly TimeRange[]) => ranges.map((r) => [r.start, r.end]);

describe("planInvalidation", () => {
  it("returns nothing for the same or an equal-by-value project", () => {
    const p = baseProject();
    expect(plan(p, p)).toEqual({ all: false, ranges: [] });
    expect(plan(p, { ...p, modifiedAt: 99, name: "Renamed" })).toEqual({ all: false, ranges: [] });
  });

  it("changing the HDR working space or graphics white invalidates every cached frame, and defaults keep their keys", () => {
    const a = baseProject();
    const rec2020 = { ...a, settings: { ...a.settings, workingColorSpace: "rec2020" as const } };
    expect(plan(a, rec2020).all).toBe(true);
    const white = { ...rec2020, settings: { ...rec2020.settings, graphicsWhiteNits: 300 } };
    expect(plan(rec2020, white).all).toBe(true);
    // Back to the default (the key absent or explicitly undefined) is the same project as before.
    const cleared = { ...white, settings: { ...white.settings, graphicsWhiteNits: undefined } };
    expect(plan(rec2020, cleared)).toEqual({ all: false, ranges: [] });
  });

  it("a LUT colour space change invalidates only that clip's span", () => {
    const lut = (space: "srgb" | "pq") => ({ lut: { data: [0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 255], size: 2, intensity: 1, space } });
    const a = mapClip(baseProject(), "c2", (c) => ({ ...c, colorGrading: lut("srgb") } as Clip));
    const b = mapClip(a, "c2", (c) => ({ ...c, colorGrading: lut("pq") } as Clip));
    const result = plan(a, b);
    expect(result.all).toBe(false);
    expect(spans(result.ranges)).toEqual([[4, 8]]);
  });

  it("an effect param change invalidates only that clip's span", () => {
    const a = mapClip(baseProject(), "c2", (c) => ({ ...c, effects: [fx("glow", { radius: 4 })] }));
    const b = mapClip(a, "c2", (c) => ({ ...c, effects: [fx("glow", { radius: 12 })] }));
    const result = plan(a, b);
    expect(result.all).toBe(false);
    expect(spans(result.ranges)).toEqual([[4, 8]]);
  });

  it("adding, disabling and reordering effects each invalidate just the clip", () => {
    const a = baseProject();
    const added = mapClip(a, "c1", (c) => ({ ...c, effects: [fx("blur", { radius: 3 })] }));
    expect(spans(plan(a, added).ranges)).toEqual([[0, 4]]);
    const disabled = mapClip(added, "c1", (c) => ({ ...c, effects: c.effects.map((e) => ({ ...e, enabled: false })) }));
    expect(spans(plan(added, disabled).ranges)).toEqual([[0, 4]]);
    const two = mapClip(a, "c1", (c) => ({ ...c, effects: [fx("blur"), fx("glow")] }));
    const swapped = mapClip(a, "c1", (c) => ({ ...c, effects: [fx("glow"), fx("blur")] }));
    expect(spans(plan(two, swapped).ranges)).toEqual([[0, 4]]);
  });

  it("effect ids and effect metadata do not matter", () => {
    const a = mapClip(baseProject(), "c1", (c) => ({ ...c, effects: [fx("glow")] }));
    const b = mapClip(a, "c1", (c) => ({
      ...c,
      effects: c.effects.map((e) => ({ ...e, id: "other", metadata: { filterPreset: { presetId: "x", applicationId: "y", index: 0 } } })),
    }));
    expect(plan(a, b).ranges).toEqual([]);
  });

  it("colour grading and LUT changes invalidate the clip only", () => {
    const a = baseProject();
    const b = mapClip(a, "c3", (c) => ({ ...c, colorGrading: { temperature: 20 } }));
    expect(spans(plan(a, b).ranges)).toEqual([[10, 12]]);
    const lutA = mapClip(a, "c3", (c) => ({ ...c, colorGrading: { lut: { data: [0, 0.5, 1], size: 1, intensity: 1 } } }));
    const lutB = mapClip(a, "c3", (c) => ({ ...c, colorGrading: { lut: { data: [0, 0.5, 1], size: 1, intensity: 0.5 } } }));
    expect(spans(plan(lutA, lutB).ranges)).toEqual([[10, 12]]);
  });

  it("moving a clip invalidates its old and new spans, nothing else", () => {
    const a = baseProject();
    const b = mapClip(a, "c3", (c) => ({ ...c, startTime: 6 }));
    expect(spans(plan(a, b).ranges)).toEqual([[6, 8], [10, 12]]);
  });

  it("trimming the tail invalidates the union of old and new extents", () => {
    const a = baseProject();
    const b = mapClip(a, "c1", (c) => ({ ...c, duration: 3, outPoint: 3 }));
    expect(spans(plan(a, b).ranges)).toEqual([[0, 4]]);
  });

  it("moving a clip between tracks invalidates its span (compositing order changes)", () => {
    const a = baseProject();
    const moved = withTracks(a, [
      { ...a.timeline.tracks[0], clips: a.timeline.tracks[0].clips.filter((c) => c.id !== "c3") },
      { ...a.timeline.tracks[1], clips: [...a.timeline.tracks[1].clips, { ...a.timeline.tracks[0].clips[2], trackId: "v2" }] },
      a.timeline.tracks[2],
    ]);
    expect(spans(plan(a, moved).ranges)).toEqual([[10, 12]]);
  });

  it("audio-only edits never invalidate", () => {
    const a = baseProject();
    expect(plan(a, mapClip(a, "c1", (c) => ({ ...c, volume: 0.2, fade: { fadeIn: 1, fadeOut: 1 } }))).ranges).toEqual([]);
    expect(plan(a, mapClip(a, "c1", (c) => ({ ...c, audioEffects: [fx("eq")] }))).ranges).toEqual([]);
    expect(plan(a, mapClip(a, "au1", (c) => ({ ...c, startTime: 5, duration: 3 }))).ranges).toEqual([]);
    expect(plan(a, mapClip(a, "au1", (c) => ({ ...c, effects: [fx("anything")] }))).ranges).toEqual([]);
    const muted = withTracks(a, a.timeline.tracks.map((t) => ({ ...t, muted: true, solo: true })));
    expect(plan(a, muted).ranges).toEqual([]);
    // buses, track outputs and sends are audio routing only
    const routed = withTracks(
      { ...a, timeline: { ...a.timeline, audioBuses: [{ id: "b", name: "Bus", muted: false, solo: false }] } },
      a.timeline.tracks.map((t) => ({ ...t, output: "b", sends: [{ id: "s", busId: "b", level: 0.5, preFader: false }] })),
    );
    expect(plan(a, routed).ranges).toEqual([]);
    expect(plan(a, { ...a, timeline: { ...a.timeline, markers: [{ id: "m", time: 1, label: "x", color: "red" }] } }).ranges).toEqual([]);
  });

  it("track visibility toggles invalidate that track's clip spans only", () => {
    const a = baseProject();
    const hidden = withTracks(a, a.timeline.tracks.map((t) => (t.id === "v2" ? { ...t, hidden: true } : t)));
    expect(spans(plan(a, hidden).ranges)).toEqual([[2, 5]]);
    expect(spans(plan(hidden, a).ranges)).toEqual([[2, 5]]);
  });

  it("editing a clip on a hidden track invalidates nothing", () => {
    const hidden = withTracks(baseProject(), baseProject().timeline.tracks.map((t) => (t.id === "v2" ? { ...t, hidden: true } : t)));
    const edited = mapClip(hidden, "o1", (c) => ({ ...c, effects: [fx("glow")], startTime: 7 }));
    expect(plan(hidden, edited).ranges).toEqual([]);
  });

  it("reordering visible tracks invalidates the clips of the tracks whose stacking changed", () => {
    const a = baseProject();
    const [v1, v2, au] = a.timeline.tracks;
    const swapped = withTracks(a, [v2, v1, au]);
    expect(spans(plan(a, swapped).ranges)).toEqual([[0, 8], [10, 12]]);
  });

  it("transition edits invalidate the transition window, not the whole clips", () => {
    const base = baseProject();
    const transition: Transition = { id: "t1", clipAId: "c1", clipBId: "c2", type: "crossfade", duration: 1, params: {} };
    const a = withTracks(base, base.timeline.tracks.map((t) => (t.id === "v1" ? { ...t, transitions: [transition] } : t)));
    const b = withTracks(a, a.timeline.tracks.map((t) => (t.id === "v1" ? { ...t, transitions: [{ ...transition, duration: 0.5 }] } : t)));
    const result = plan(a, b);
    expect(spans(result.ranges)).toEqual([[3, 5]]);
    const removed = withTracks(a, a.timeline.tracks.map((t) => (t.id === "v1" ? { ...t, transitions: [] } : t)));
    expect(spans(plan(a, removed).ranges)).toEqual([[3, 5]]);
  });

  it("text, shape and subtitle items invalidate their own span", () => {
    const a: Project = {
      ...baseProject(),
      textClips: [{ id: "t1", trackId: "v2", startTime: 6, duration: 2, text: "Hello" }] as unknown as Project["textClips"],
    };
    const b: Project = { ...a, textClips: [{ ...(a.textClips![0] as object), text: "Bye" }] as unknown as Project["textClips"] };
    expect(spans(plan(a, b).ranges)).toEqual([[6, 8]]);
    const subs = { ...b, timeline: { ...b.timeline, subtitles: [{ id: "s", text: "hi", startTime: 1, endTime: 2 }] } };
    expect(spans(plan(b, subs).ranges)).toEqual([[1, 2]]);
  });

  it("adjustment layers invalidate their span", () => {
    const a = baseProject();
    const layer = { id: "adj", trackId: "v2", name: "adj", startTime: 1, duration: 6, effects: [fx("glow")], opacity: 1, blendMode: "normal", enabled: true, affectedTracks: "all", transform };
    const b: Project = { ...a, adjustmentLayers: [layer] as unknown as Project["adjustmentLayers"] };
    expect(spans(plan(a, b).ranges)).toEqual([[1, 7]]);
  });

  it("changing the canvas size, frame rate or background fill invalidates everything", () => {
    const a = baseProject();
    expect(plan(a, { ...a, settings: { ...a.settings, width: 1280 } }).all).toBe(true);
    expect(plan(a, { ...a, settings: { ...a.settings, frameRate: 24 } }).all).toBe(true);
    expect(plan(a, { ...a, timeline: { ...a.timeline, backgroundFillMode: "blur" } }).all).toBe(true);
    expect(plan(a, { ...a, settings: { ...a.settings, sampleRate: 44100 } }).all).toBe(false);
    expect(plan(a, { ...a, id: "other" }).all).toBe(true);
  });

  it("replacing a media blob invalidates every clip that uses it", () => {
    const a = baseProject();
    const b: Project = {
      ...a,
      mediaLibrary: { items: a.mediaLibrary.items.map((m) => (m.id === "m1" ? { ...m, blob: new Blob(["new"]) } : m)) },
    };
    expect(spans(plan(a, b).ranges)).toEqual([[0, 4], [10, 12]]);
  });

  it("clip masks invalidate the masked clip", () => {
    const a = baseProject();
    const mask = { id: "mk", clipId: "c2", type: "shape", feathering: 0, inverted: false, expansion: 0, opacity: 1, keyframes: [], path: { points: [], closed: true } };
    const withMask: Project = { ...a, masks: [mask] as unknown as Project["masks"] };
    expect(spans(plan(a, withMask).ranges)).toEqual([[4, 8]]);
    const edited: Project = { ...a, masks: [{ ...mask, feathering: 10 }] as unknown as Project["masks"] };
    expect(spans(plan(withMask, edited).ranges)).toEqual([[4, 8]]);
  });

  it("keyframe edits invalidate the clip", () => {
    const a = baseProject();
    const b = mapClip(a, "c2", (c) => ({
      ...c,
      keyframes: [{ id: "k", time: 1, property: "opacity", value: 0.5, easing: "linear" }],
    }));
    expect(spans(plan(a, b).ranges)).toEqual([[4, 8]]);
  });

  it("an unrelated far-away edit leaves other ranges untouched", () => {
    const a = baseProject();
    const b = mapClip(a, "c3", (c) => ({ ...c, transform: { ...c.transform, opacity: 0.5 } }));
    const ranges = plan(a, b).ranges;
    expect(rangesContain(ranges, 1)).toBe(false);
    expect(rangesContain(ranges, 4.5)).toBe(false);
    expect(rangesContain(ranges, 11)).toBe(true);
  });
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent oracle: everything that can reach a pixel at time t, in compositing order. */
function frameDescriptor(project: Project, t: number): string {
  const strip = (c: Clip) => {
    const { volume: _v, audioEffects: _a, fade: _f, automation: _au, pitchCorrection: _p, audioTrackIndex: _i, metadata: _m, ...rest } = c;
    return { ...rest, effects: c.effects.map((e) => [e.type, e.params, e.enabled]) };
  };
  const layers: unknown[] = [];
  let visible = 0;
  for (const tr of project.timeline.tracks) {
    if (tr.hidden) continue;
    const idx = visible++;
    for (const c of tr.clips) {
      const m = project.mediaLibrary.items.find((x) => x.id === c.mediaId);
      if (m?.type === "audio") continue;
      if (t >= c.startTime && t < c.startTime + c.duration) {
        layers.push([idx, strip(c), m?.blob ? "blob" : "none", m?.metadata.duration]);
      }
    }
    for (const tx of tr.transitions) {
      const a = tr.clips.find((c) => c.id === tx.clipAId);
      const b = tx.clipBId ? tr.clips.find((c) => c.id === tx.clipBId) : undefined;
      const mid = b ? b.startTime : a ? a.startTime + a.duration : 0;
      if (Math.abs(t - mid) <= tx.duration) layers.push(["tx", idx, tx.type, tx.duration, tx.params, a?.startTime, a?.duration, b?.startTime]);
    }
  }
  for (const text of project.textClips ?? []) {
    const item = text as unknown as { startTime: number; duration: number; trackId: string };
    if (project.timeline.tracks.find((x) => x.id === item.trackId)?.hidden) continue;
    if (t >= item.startTime && t < item.startTime + item.duration) layers.push(["text", text]);
  }
  return JSON.stringify([project.settings.width, project.settings.height, project.settings.frameRate, layers]);
}

describe("planInvalidation properties (seeded random edit sequences)", () => {
  const mutations: Array<(p: Project, rnd: () => number) => Project> = [
    (p, rnd) => {
      const clips = p.timeline.tracks.flatMap((t) => t.clips).filter((c) => c.trackId !== "a");
      const target = clips[Math.floor(rnd() * clips.length)];
      return mapClip(p, target.id, (c) => ({ ...c, startTime: Math.round(rnd() * 20 * 30) / 30 }));
    },
    (p, rnd) => {
      const clips = p.timeline.tracks.flatMap((t) => t.clips).filter((c) => c.trackId !== "a");
      const target = clips[Math.floor(rnd() * clips.length)];
      const duration = Math.max(1 / 30, Math.round(rnd() * 8 * 30) / 30);
      return mapClip(p, target.id, (c) => ({ ...c, duration, outPoint: c.inPoint + duration }));
    },
    (p, rnd) => {
      const clips = p.timeline.tracks.flatMap((t) => t.clips).filter((c) => c.trackId !== "a");
      const target = clips[Math.floor(rnd() * clips.length)];
      const radius = Math.floor(rnd() * 30);
      return mapClip(p, target.id, (c) => ({ ...c, effects: [fx("glow", { radius })] }));
    },
    (p, rnd) => {
      const clips = p.timeline.tracks.flatMap((t) => t.clips).filter((c) => c.trackId !== "a");
      const target = clips[Math.floor(rnd() * clips.length)];
      return mapClip(p, target.id, (c) => ({ ...c, transform: { ...c.transform, opacity: rnd() } }));
    },
    (p, rnd) => {
      const clips = p.timeline.tracks.flatMap((t) => t.clips);
      const target = clips[Math.floor(rnd() * clips.length)];
      return mapClip(p, target.id, (c) => ({ ...c, volume: rnd() }));
    },
    (p, rnd) => {
      const index = Math.floor(rnd() * 2);
      return withTracks(p, p.timeline.tracks.map((t, i) => (i === index ? { ...t, hidden: !t.hidden } : t)));
    },
    (p, rnd) => {
      const tracks = p.timeline.tracks.slice();
      const i = Math.floor(rnd() * 2);
      [tracks[0], tracks[1]] = i === 0 ? [tracks[1], tracks[0]] : [tracks[0], tracks[1]];
      return withTracks(p, tracks);
    },
    (p, rnd) => ({
      ...p,
      textClips: [{ id: "tt", trackId: "v1", startTime: Math.round(rnd() * 10), duration: 1 + Math.round(rnd() * 3), text: String(rnd()) }] as unknown as Project["textClips"],
    }),
  ];

  it("never leaves a changed frame outside the planned ranges (no stale frames)", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rnd = mulberry32(seed);
      let current = baseProject();
      for (let step = 0; step < 6; step++) {
        const pick = mutations[Math.floor(rnd() * mutations.length)];
        const next = pick(current, rnd);
        const result = plan(current, next);
        if (!result.all) {
          for (let f = 0; f < 30 * 24; f++) {
            const t = f / 30;
            if (rangesContain(result.ranges, t)) continue;
            expect(frameDescriptor(next, t), `seed ${seed} step ${step} frame ${f}`).toBe(frameDescriptor(current, t));
          }
        }
        current = next;
      }
    }
  });

  it("is tight: a single-clip edit never touches frames beyond that clip's old/new extents", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rnd = mulberry32(seed * 7919);
      const a = baseProject();
      const target = ["c1", "c2", "c3", "o1"][Math.floor(rnd() * 4)];
      const original = a.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === target)!;
      const moved = Math.round(rnd() * 20 * 30) / 30;
      const b = mapClip(a, target, (c) => ({ ...c, startTime: moved, effects: [fx("blur", { radius: seed })] }));
      const result = plan(a, b);
      for (const range of result.ranges) {
        const lo = Math.min(original.startTime, moved);
        const hi = Math.max(original.startTime + original.duration, moved + original.duration);
        expect(range.start).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(range.end).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });

  it("planning is symmetric (undo invalidates what the edit did)", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = mulberry32(seed * 31);
      const a = baseProject();
      const b = mutations[Math.floor(rnd() * mutations.length)](a, rnd);
      expect(plan(b, a)).toEqual(plan(a, b));
    }
  });
});

describe("camera RAW stills", () => {
  const rawSettings = { temperature: 5000, tint: 0, exposure: 0, highlightRecovery: 0, demosaic: "standard", outputColorSpace: "srgb" } as const;
  function withRawStill(): Project {
    const p = baseProject();
    const still: MediaItem = { ...media("raw1", "image"), raw: { format: "dng", developedBy: "openreel", settings: rawSettings } };
    return withTracks(
      { ...p, mediaLibrary: { items: [...p.mediaLibrary.items, still] } },
      [...p.timeline.tracks, track("v3", [clip("r1", "v3", "raw1", 5, 2)])],
    );
  }
  const withSettings = (p: Project, settings: typeof rawSettings | { exposure: number } | Record<string, unknown>): Project => ({
    ...p,
    mediaLibrary: {
      items: p.mediaLibrary.items.map((m) =>
        m.id === "raw1" && m.raw ? { ...m, raw: { ...m.raw, settings: { ...m.raw.settings!, ...settings } as typeof rawSettings } } : m,
      ),
    },
  });

  it("a RAW Source Settings change invalidates the clips that show the still, and only those", () => {
    const a = withRawStill();
    const result = plan(a, withSettings(a, { exposure: 1.5 }));
    expect(result.all).toBe(false);
    expect(spans(result.ranges)).toEqual([[5, 7]]);
    expect(plan(a, withSettings(a, { exposure: 0 }))).toEqual({ all: false, ranges: [] });
  });
});
