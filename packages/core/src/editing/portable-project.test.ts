import { describe, it, expect } from "vitest";
import { createPortableEdit, parsePortableEdit, materializePortableEdit, createEditPreset, parseEditPreset } from "./portable-project";
import type { Project } from "../types/project";
import { FILTER_PRESETS } from "../video/filter-presets";
import { toRuntimeVideoEffectParams } from "../video/effect-parameter-units";

function project(): Project {
  return { id: "project-1", name: "Shared edit", createdAt: 1, modifiedAt: 1, settings: { width: 640, height: 360, frameRate: 24, sampleRate: 48000, channels: 2 }, mediaLibrary: { items: [{ id: "media-1", name: "sample.mp4", type: "video", blob: new Blob(["sample"]), fileHandle: null, thumbnailUrl: null, waveformData: null, sourceFile: { name: "sample.mp4", size: 6, lastModified: 1 }, metadata: { duration: 4, width: 640, height: 360, frameRate: 24, sampleRate: 48000, channels: 2, fileSize: 6, codec: "avc" } }] }, timeline: { tracks: [{ id: "track-1", type: "video", name: "Video", locked: false, hidden: false, muted: false, solo: false, transitions: [], clips: [{ id: "clip-1", trackId: "track-1", mediaId: "media-1", startTime: 0, duration: 4, inPoint: 0, outPoint: 4, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, opacity: 1, rotation: 0 } }] }], subtitles: [], markers: [], duration: 4 } };
}
describe("portable edit boundary", () => {
  it("round-trips Reduce Reverb and the Enhance Speech Speech / Background balance in a clip's audio effects, and rejects out-of-range values", () => {
    const before = project();
    before.timeline.tracks[0].clips[0] = {
      ...before.timeline.tracks[0].clips[0],
      audioEffects: [
        { id: "es", type: "enhanceSpeech", enabled: true, params: { mix: 80, balance: 35 } },
        { id: "rr", type: "reduceReverb", enabled: true, params: { amount: 60, sensitivity: 50 } },
        { id: "old", type: "enhanceSpeech", enabled: true, params: { mix: 100 } },
      ],
    };
    const doc = createPortableEdit(before);
    const parsed = parsePortableEdit(JSON.stringify(doc));
    expect(materializePortableEdit(parsed, before).project.timeline.tracks[0].clips[0].audioEffects).toEqual(before.timeline.tracks[0].clips[0].audioEffects);
    for (const [type, params] of [["reduceReverb", { amount: 101, sensitivity: 50 }], ["reduceReverb", { amount: 10, sensitivity: -1 }], ["enhanceSpeech", { mix: 100, balance: 120 }]] as const) {
      (doc.project.timeline.tracks[0].clips[0] as { audioEffects: unknown }).audioEffects = [{ id: "x", type, enabled: true, params }];
      expect(() => parsePortableEdit(JSON.stringify(doc)), `${type} ${JSON.stringify(params)}`).toThrow();
    }
  });
  it("keeps range marker duration, comment and kind, and rejects a bad marker", () => {
    const before = project();
    const marker = { id: "m1", time: 1, label: "Scene", color: "#fff", duration: 2, comment: "note", kind: "chapter" as const };
    (before.timeline as { markers: unknown }).markers = [marker, { id: "m2", time: 3, label: "Point", color: "#000" }];
    const doc = createPortableEdit(before);
    const parsed = parsePortableEdit(JSON.stringify(doc));
    expect(materializePortableEdit(parsed, before).project.timeline.markers).toEqual(before.timeline.markers);
    (doc.project.timeline as { markers: unknown }).markers = [{ ...marker, duration: -1 }];
    expect(() => parsePortableEdit(JSON.stringify(doc))).toThrow();
    (doc.project.timeline as { markers: unknown }).markers = [{ ...marker, kind: "nope" }];
    expect(() => parsePortableEdit(JSON.stringify(doc))).toThrow();
  });
  it.each([-2, 20])("preserves saved playback rate %s in version 4 and rejects zero", speed => {
    const before = project();
    before.timeline.tracks[0].clips[0] = { ...before.timeline.tracks[0].clips[0], speed, duration: 4 / Math.abs(speed) };
    const doc = createPortableEdit(before);
    expect(doc.version).toBe(4);
    expect(materializePortableEdit(parsePortableEdit(JSON.stringify(doc)), before).project.timeline.tracks[0].clips[0].speed).toBe(speed);
    expect(() => parsePortableEdit(JSON.stringify({ ...doc, version: 3 }))).toThrow();
    doc.project.timeline.tracks[0].clips[0] = { ...doc.project.timeline.tracks[0].clips[0], speed: 0 };
    expect(() => parsePortableEdit(JSON.stringify(doc))).toThrow(/playback speed/);
  });
  it("keeps a clip's Time Interpolation mode and quality, and rejects an unknown mode", () => {
    const before = project();
    before.timeline.tracks[0].clips[0] = { ...before.timeline.tracks[0].clips[0], speed: 0.25, duration: 16, timeInterpolation: "opticalFlow", interpolationQuality: "high" };
    const doc = createPortableEdit(before);
    const clip = materializePortableEdit(parsePortableEdit(JSON.stringify(doc)), before).project.timeline.tracks[0].clips[0];
    expect(clip.timeInterpolation).toBe("opticalFlow");
    expect(clip.interpolationQuality).toBe("high");
    doc.project.timeline.tracks[0].clips[0] = { ...doc.project.timeline.tracks[0].clips[0], timeInterpolation: "magic" } as never;
    expect(() => parsePortableEdit(JSON.stringify(doc))).toThrow();
  });
  it("roundtrips retained fragment clocks, eased negative keys and automation through version 4", () => {
    const before = project(), clip = before.timeline.tracks[0].clips[0];
    before.timeline.tracks[0].clips[0] = { ...clip, duration: 2, inPoint: 2,
      fade: { fadeIn: 3, fadeOut: 2, origin: { offset: 1, duration: 4, out: { offset: 0, duration: 2 } } },
      keyframes: [{ id: "before-cut", time: -2, property: "opacity", value: 0, easing: "bezier", roving: true, bezierHandles: { in: { x: .2, y: .3 }, out: { x: .7, y: .8 } } }, { id: "after-cut", time: 2, property: "opacity", value: 1, easing: "linear" }],
      automation: { volume: [{ time: 0, value: .2 }, { time: 2, value: .8 }], pan: [{ time: 0, value: -.5 }, { time: 2, value: .5 }] },
    };
    const doc = createPortableEdit(before), parsed = parsePortableEdit(JSON.stringify(doc));
    expect(parsed.version).toBe(4);
    expect(materializePortableEdit(parsed, before).project.timeline.tracks[0].clips[0]).toEqual(before.timeline.tracks[0].clips[0]);
    expect(() => parsePortableEdit(JSON.stringify({ ...doc, version: 3 }))).toThrow();
    expect(createPortableEdit(project()).version).toBe(3);
  });
  it("keeps UI provenance local while preserving the closed portable version-3 metadata", () => {
    const before = project();
    before.mediaLibrary.items[0] = { ...before.mediaLibrary.items[0], metadata: { ...before.mediaLibrary.items[0].metadata, soundLibraryId: "music-cinematic-bed" } };
    const edit = parsePortableEdit(JSON.stringify(createPortableEdit(before)));
    expect(edit.version).toBe(3);
    expect(edit.project.media[0].metadata.soundLibraryId).toBeUndefined();
    expect(materializePortableEdit(edit, before).project.mediaLibrary.items[0].metadata.soundLibraryId).toBe("music-cinematic-bed");
    expect(materializePortableEdit(edit, { ...before, mediaLibrary: { items: [] } }).project.mediaLibrary.items[0].metadata.soundLibraryId).toBeUndefined();
  });
  it("preserves typed filter identity in shared edits and presets while rejecting unknown metadata", () => {
    const before = project();
    const metadata = { filterPreset: { presetId: "cinematic-noir", applicationId: "filter-application", index: 0 } };
    before.timeline.tracks[0].clips[0] = { ...before.timeline.tracks[0].clips[0], effects: [{ id: "grain", type: "grain", enabled: false, params: { amount: 0 }, metadata }] };
    const edit = parsePortableEdit(JSON.stringify(createPortableEdit(before)));
    expect(materializePortableEdit(edit, before).project.timeline).toEqual(before.timeline);
    const preset = createEditPreset({ name: "Filter", effects: before.timeline.tracks[0].clips[0].effects });
    expect(parseEditPreset(JSON.stringify(preset)).effects[0].metadata).toEqual(metadata);
    for (const filterPreset of [{ ...metadata.filterPreset, index: -1 }, { ...metadata.filterPreset, script: "run" }, { ...metadata.filterPreset, applicationId: "https://remote.example" }]) {
      const invalid = { ...preset, effects: [{ ...preset.effects[0], metadata: { filterPreset } }] };
      expect(() => parseEditPreset(JSON.stringify(invalid))).toThrow();
    }
  });
  it("can share every built-in filter preset, including pixel-valued sharpen thresholds", () => {
    for (const filter of FILTER_PRESETS) {
      const runtime = filter.effects.map((effect, index) => ({ id: `effect-${index}`, type: effect.type, enabled: true, params: toRuntimeVideoEffectParams(effect.type, { ...effect.params }) }));
      const preset = createEditPreset({ name: filter.name, effects: runtime });
      expect(parseEditPreset(JSON.stringify(preset)).effects.map(({ type, params }) => ({ type, params })), filter.name).toEqual(filter.effects);
    }
    expect(() => parseEditPreset(JSON.stringify({ format: "openreel-preset", version: 2, name: "Invalid threshold", effects: [{ id: "effect", type: "sharpen", enabled: true, params: { amount: 0.3, threshold: 256 } }] }))).toThrow(/supported range/);
  });
  it.each([
    ["brightness", { value: 20 }, { value: 0.2 }],
    ["sharpen", { amount: 50, radius: 2 }, { amount: 0.5, radius: 2 }],
    ["vignette", { amount: 30, midpoint: 0.5 }, { amount: 0.3, midpoint: 0.5 }],
  ])("roundtrips runtime %s through normalized portable edits", (type, runtime, normalized) => {
    const before = project();
    before.timeline.tracks[0].clips[0] = { ...before.timeline.tracks[0].clips[0], effects: [{ id: "effect", type, enabled: true, params: runtime }] };
    const doc = createPortableEdit(before);
    expect(doc.project.timeline.tracks[0].clips[0].effects[0].params).toEqual(normalized);
    expect(materializePortableEdit(parsePortableEdit(JSON.stringify(doc)), before).project.timeline).toEqual(before.timeline);
  });

  it.each([18, 0.18])("retains the actual strength of a legacy preset with raw grain %s", amount => {
    const legacy = { format: "openreel-preset", version: 1, name: "Old look", effects: [{ id: "grain", type: "grain", enabled: false, params: { amount, colored: false } }] };
    const parsed = parseEditPreset(JSON.stringify(legacy));
    expect(parsed.version).toBe(2);
    expect(parsed.effects[0]).toMatchObject({ enabled: false, params: { amount: amount === 18 ? 0.18 : 0.0018, colored: false } });
    expect(legacy.effects[0].params.amount).toBe(amount);
  });

  it("exports normalized preset v2 and validates effect-specific keys before use", () => {
    const effects = [{ id: "grain", type: "grain", enabled: true, params: { amount: 18, colored: false } }];
    const preset = createEditPreset({ name: "Grain", effects });
    expect(preset.version).toBe(2);
    expect(preset.effects[0].params).toEqual({ amount: 0.18, colored: false });
    expect(parseEditPreset(JSON.stringify(preset))).toEqual(preset);
    expect(effects[0].params.amount).toBe(18);
    expect(() => parseEditPreset(JSON.stringify({ ...preset, effects: [{ ...preset.effects[0], type: "vignette" }] }))).toThrow(/colored/);
    expect(() => parseEditPreset(JSON.stringify({ ...preset, script: "execute" }))).toThrow(/unsupported property/);
  });
  it.each([18, 0.18, 0.29])("roundtrips saved grain amount %s without guessing its units", (amount) => {
    const before = project();
    before.timeline.tracks[0].clips[0] = { ...before.timeline.tracks[0].clips[0], effects: [
      { id: "grain", type: "grain", enabled: true, params: { amount, size: 0.7, roughness: 0.65, colored: false } },
    ] };
    const snapshot = JSON.stringify(before.timeline);
    const doc = createPortableEdit(before);
    expect(doc.version).toBe(3);
    expect(doc.project.timeline.tracks[0].clips[0].effects[0].params.amount).toBe(amount === 18 ? 0.18 : amount === 0.18 ? 0.0018 : 0.0029);
    expect(materializePortableEdit(parsePortableEdit(JSON.stringify(doc)), before).project.timeline).toEqual(before.timeline);
    expect(JSON.stringify(before.timeline)).toBe(snapshot);
  });

  it("preserves the rendering units of an older v2 shared edit", () => {
    const before = project();
    const doc = createPortableEdit(before);
    const old = { ...doc, version: 2, project: { ...doc.project, timeline: { ...doc.project.timeline, tracks: doc.project.timeline.tracks.map(track => ({ ...track, clips: track.clips.map(clip => ({ ...clip, effects: [{ id: "old-grain", type: "grain", enabled: true, params: { amount: 0.18 } }] })) })) } } };
    const migrated = parsePortableEdit(JSON.stringify(old));
    expect(migrated.version).toBe(3);
    expect(migrated.project.timeline.tracks[0].clips[0].effects[0].params.amount).toBe(0.0018);
    expect(materializePortableEdit(migrated, before).project.timeline.tracks[0].clips[0].effects[0].params.amount).toBe(0.18);
  });
  it("roundtrips stable IDs and relinks local files without serializing runtime handles or URLs", () => {
    const before = project(); const json = JSON.stringify(createPortableEdit(before));
    expect(json).not.toMatch(/blob|fileHandle|thumbnailUrl|originalUrl|apiKey/);
    const restored = materializePortableEdit(parsePortableEdit(json), before);
    expect(restored.missing).toEqual([]);
    expect(restored.project.timeline).toEqual(before.timeline);
    expect(restored.project.mediaLibrary.items[0].blob).toBe(before.mediaLibrary.items[0].blob);
  });
  it("retains standard track metadata and accepts media on a universal track", () => {
    const before = project();
    before.timeline.tracks[0] = { ...before.timeline.tracks[0], type: "audio", mode: "standard", role: "captions", groupId: "group-1" };
    const doc = parsePortableEdit(JSON.stringify(createPortableEdit(before)));
    expect(materializePortableEdit(doc, before).project.timeline).toEqual(before.timeline);
    expect(() => parsePortableEdit(JSON.stringify({ ...doc, project: { ...doc.project, timeline: { ...doc.project.timeline, tracks: [{ ...doc.project.timeline.tracks[0], mode: "unknown" }] } } }))).toThrow();
    before.timeline.tracks[0] = { ...before.timeline.tracks[0], mode: undefined };
    expect(() => createPortableEdit(before)).toThrow(/incompatible media/);
  });
  it("creates explicit missing-media placeholders and can match uniquely renamed IDs by file hint", () => {
    const before = project(); const doc = createPortableEdit(before);
    expect(materializePortableEdit(doc, { ...before, mediaLibrary: { items: [] } }).missing).toEqual(["media-1"]);
    const other = { ...before.mediaLibrary.items[0], id: "new-media-id" };
    expect(materializePortableEdit(doc, { ...before, mediaLibrary: { items: [other] } }).missing).toEqual([]);
  });
  it("migrates v1 asset references", () => {
    const doc = createPortableEdit(project()); const { media, ...rest } = doc.project;
    const migrated = parsePortableEdit(JSON.stringify({ ...doc, version: 1, project: { ...rest, assets: media } }));
    expect(migrated.version).toBe(3); expect(migrated.project.media).toEqual(media);
  });
  it("rejects source ranges that exceed the actual locally linked media", () => {
    const before = project(); const doc = createPortableEdit(before);
    const shortAsset = { ...before.mediaLibrary.items[0], metadata: { ...before.mediaLibrary.items[0].metadata, duration: 1 } };
    expect(() => materializePortableEdit(doc, { ...before, mediaLibrary: { items: [shortAsset] } })).toThrow(/source range/);
  });
  it.each(["instructions", "apiKey", "originalUrl", "script", "__proto__"])("rejects unknown or executable property %s", (property) => {
    const text = JSON.stringify(createPortableEdit(project())).replace('"name":"Shared edit"', `"name":"Shared edit","${property}":"untrusted"`);
    expect(() => parsePortableEdit(text)).toThrow();
  });
  it("rejects missing transforms, duplicate IDs, dangling references and source overflow", () => {
    for (const mutate of [(p: ReturnType<typeof createPortableEdit>) => { p.project.timeline.tracks[0].clips[0] = { ...p.project.timeline.tracks[0].clips[0], id: "track-1" }; }, (p: ReturnType<typeof createPortableEdit>) => { p.project.timeline.tracks[0].clips[0] = { ...p.project.timeline.tracks[0].clips[0], mediaId: "unknown" }; }, (p: ReturnType<typeof createPortableEdit>) => { p.project.timeline.tracks[0].clips[0] = { ...p.project.timeline.tracks[0].clips[0], outPoint: 999 }; }]) {
      const doc = createPortableEdit(project()); mutate(doc); expect(() => parsePortableEdit(JSON.stringify(doc))).toThrow();
    }
  });
  it("rejects unknown versions, oversized files and shader presets", () => {
    expect(() => parsePortableEdit(JSON.stringify({ ...createPortableEdit(project()), version: 99 }))).toThrow();
    expect(() => parsePortableEdit(" ".repeat(5_000_001))).toThrow(/5 MB/);
    expect(() => parseEditPreset(JSON.stringify({ format: "openreel-preset", version: 1, name: "Unsafe", effects: [{ id: "effect-1", type: "shader", enabled: true, params: { code: "bad" } }] }))).toThrow();
  });
});


describe("portable clip relationships", () => {
  it("preserves split lineage and separated audio stream metadata on round trip", () => {
    const before = project();
    before.timeline.tracks[0].clips[0] = { ...before.timeline.tracks[0].clips[0], audioTrackIndex: 1,
      metadata: { splitSourceClipId: "original-segment", separatedFromClipId: "source-video", sourceAudioTrackIndex: 1 },
    };
    const doc = parsePortableEdit(JSON.stringify(createPortableEdit(before)));
    const restored = materializePortableEdit(doc, before).project.timeline.tracks[0].clips[0];
    expect(restored.metadata).toEqual(before.timeline.tracks[0].clips[0].metadata);
    expect(restored.audioTrackIndex).toBe(1);
  });
  it("round-trips Essential Sound audioType, the tagged chain and the panel's undo state", () => {
    const before = project();
    const clip = before.timeline.tracks[0].clips[0];
    const lane = [{ time: 0, value: 0.8 }, { time: 1, value: 0.1 }];
    before.timeline.tracks[0].clips[0] = {
      ...clip,
      audioType: "music",
      volume: 2,
      automation: { volume: lane },
      audioEffects: [{ id: "fx-1", type: "eq", enabled: true, params: { bands: [{ type: "peaking", frequency: 1500, gain: -3.5, q: 0.8 }] }, metadata: { essentialSound: { block: "clarity", key: "music-scoop", sig: "{}" } } }],
      metadata: { essentialSound: {
        options: { loudness: true, repair: false, clarity: true, ducking: true, reduceNoise: true, reduceRumble: true, clarityAmount: 0.5, duckAmountDb: 12, duckFadeMs: 300, dialogueTargetLufs: -16 },
        loudness: { targetLufs: -23, beforeLufs: -30, afterLufs: -23, clamped: false, previousVolume: 1, appliedVolume: 2 },
        ducking: { appliedVolumeLane: lane },
      } },
    };
    const parsed = parsePortableEdit(JSON.stringify(createPortableEdit(before)));
    expect(materializePortableEdit(parsed, before).project.timeline.tracks[0].clips[0]).toEqual(before.timeline.tracks[0].clips[0]);
    expect(() => parsePortableEdit(JSON.stringify(createPortableEdit(project())))).not.toThrow();
    const doc = createPortableEdit(before);
    doc.project.timeline.tracks[0].clips[0] = { ...doc.project.timeline.tracks[0].clips[0], audioType: "podcast" as never };
    expect(() => parsePortableEdit(JSON.stringify(doc))).toThrow();
  });
  it("retains strict validation for unknown metadata and invalid stream indexes", () => {
    const before = project();
    before.timeline.tracks[0].clips[0] = { ...before.timeline.tracks[0].clips[0], metadata: { execute: "untrusted" } };
    expect(() => createPortableEdit(before)).toThrow(/unsupported property/);
    before.timeline.tracks[0].clips[0] = { ...before.timeline.tracks[0].clips[0], metadata: { sourceAudioTrackIndex: -1 } };
    expect(() => createPortableEdit(before)).toThrow();
  });
});

describe("spectral repair in the portable edit boundary", () => {
  it("round-trips regions and rejects malformed ones", () => {
    const before = project();
    const region = (id: string, mode: string) => ({ id, mode, startTime: 1, endTime: 2, lowHz: 500, highHz: 900, gainDb: -12, enabled: true });
    const clip = before.timeline.tracks[0].clips[0];
    before.timeline.tracks[0].clips[0] = { ...clip, audioEffects: [{ id: "fx", type: "spectralRepair", enabled: true, params: { regions: [region("r1", "attenuate"), region("r2", "remove")] } }] };
    const doc = createPortableEdit(before);
    const parsed = parsePortableEdit(JSON.stringify(doc));
    expect(materializePortableEdit(parsed, before).project.timeline.tracks[0].clips[0].audioEffects[0]).toEqual(before.timeline.tracks[0].clips[0].audioEffects[0]);
    const bad = JSON.parse(JSON.stringify(doc));
    bad.project.timeline.tracks[0].clips[0].audioEffects[0].params.regions[0].mode = "explode";
    expect(() => parsePortableEdit(JSON.stringify(bad))).toThrow();
  });

  it("round-trips version 2 regions (lasso, brush, heal) and rejects malformed shapes", () => {
    const before = project();
    const clip = before.timeline.tracks[0].clips[0];
    const regions = [
      { id: "l", mode: "heal", shape: "lasso", points: [{ t: 1, hz: 500 }, { t: 2, hz: 900 }, { t: 1.5, hz: 2000 }], startTime: 1, endTime: 2, lowHz: 500, highHz: 2000, gainDb: -120, enabled: true, feather: 2 },
      { id: "b", mode: "remove", shape: "brush", points: [{ t: 1, hz: 700 }], brushSeconds: 0.05, brushOctaves: 0.2, startTime: 0.95, endTime: 1.05, lowHz: 610, highHz: 800, gainDb: -120, enabled: false },
    ];
    before.timeline.tracks[0].clips[0] = { ...clip, audioEffects: [{ id: "fx", type: "spectralRepair", enabled: true, params: { version: 2, regions } }] };
    const doc = createPortableEdit(before);
    const parsed = parsePortableEdit(JSON.stringify(doc));
    expect(materializePortableEdit(parsed, before).project.timeline.tracks[0].clips[0].audioEffects[0]).toEqual(before.timeline.tracks[0].clips[0].audioEffects[0]);
    const bad = JSON.parse(JSON.stringify(doc));
    bad.project.timeline.tracks[0].clips[0].audioEffects[0].params.regions[0].shape = "blob";
    expect(() => parsePortableEdit(JSON.stringify(bad))).toThrow();
  });
});
