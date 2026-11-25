import { describe, expect, it } from "vitest";
import type { Clip, MediaItem, Project, Track } from "../types";
import { cleanTailFrames, declineSmartRender, describePixelFormat, extendCopyTails, MIN_COPY_FRAMES, nativeProbeMismatch, planSmartRender, type SmartRenderSourceInfo } from "./smart-render";
import { parameterSetKey, parseAvcC, prependParameterSets, repairEncoderAvcConfig } from "./avc-config";

const FPS = 30;

const clip = (over: Partial<Clip> & Pick<Clip, "id" | "startTime" | "duration">): Clip => ({
  mediaId: "m1",
  trackId: "t1",
  inPoint: 0,
  outPoint: over.duration,
  effects: [],
  audioEffects: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  volume: 1,
  keyframes: [],
  ...over,
});

const media = (): MediaItem =>
  ({
    id: "m1",
    name: "a.mp4",
    type: "video",
    fileHandle: null,
    blob: new Blob(["x"]),
    thumbnailUrl: null,
    waveformData: null,
    metadata: { duration: 20, width: 1280, height: 720, frameRate: FPS, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1, hasVideo: true, hasAudio: true },
  }) as MediaItem;

const project = (clips: Clip[], extra: Partial<Project> = {}): Project =>
  ({
    id: "p",
    name: "p",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1280, height: 720, frameRate: FPS, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media()] },
    timeline: {
      tracks: [{ id: "t1", type: "video", name: "V1", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false } as Track],
      subtitles: [],
      duration: 20,
      markers: [],
    },
    ...extra,
  }) as unknown as Project;

// 20 s source, key frame every 2 s (60 frames).
const source = (over: Partial<SmartRenderSourceInfo> = {}): SmartRenderSourceInfo => ({
  mediaId: "m1",
  codec: "avc",
  width: 1280,
  height: 720,
  frameRate: FPS,
  firstPts: 0,
  endTime: 20,
  keyframeTimes: Array.from({ length: 10 }, (_, i) => i * 2),
  closedGops: true,
  constantFrameRate: true,
  nalLengthSize: 4,
  rotation: 0,
  ...over,
});

const settings = { format: "mp4", codec: "h264", width: 1280, height: 720, frameRate: FPS } as const;
const plan = (p: Project, src: SmartRenderSourceInfo | null = source(), totalFrames = 600) =>
  planSmartRender({ project: p, settings, sources: new Map(src ? [["m1", src]] : []), exportStart: 0, totalFrames });

describe("planSmartRender", () => {
  it("copies a whole untouched clip and covers every frame exactly once", () => {
    const result = plan(project([clip({ id: "c1", startTime: 0, duration: 20 })]));
    expect(result.eligible).toBe(true);
    expect(result.copiedFrames).toBe(600);
    expect(result.copiedPercent).toBe(100);
    expect(result.segments).toEqual([
      { kind: "copy", startFrame: 0, endFrame: 600, mediaId: "m1", sourceStart: 0, sourceEnd: 20 },
    ]);
  });

  it("re-encodes the partial GOPs at a cut and copies whole GOPs", () => {
    // Clip uses source 1.0 .. 11.0 placed at 0: keys at 2,4,..,10 are inside.
    const result = plan(project([clip({ id: "c1", startTime: 0, duration: 10, inPoint: 1, outPoint: 11 })]), source(), 300);
    expect(result.segments).toEqual([
      { kind: "encode", startFrame: 0, endFrame: 30 },
      { kind: "copy", startFrame: 30, endFrame: 270, mediaId: "m1", sourceStart: 2, sourceEnd: 10 },
      { kind: "encode", startFrame: 270, endFrame: 300 },
    ]);
    expect(result.copiedFrames).toBe(240);
  });

  describe("sources whose first presentation time is not zero", () => {
    // 20 s source whose first frame is at 1.4 s (a whole number of frames) and whose key frames are every 2 s after it.
    const shifted = (firstPts: number, over: Partial<SmartRenderSourceInfo> = {}) =>
      source({ firstPts, endTime: firstPts + 20, keyframeTimes: Array.from({ length: 10 }, (_, i) => firstPts + i * 2), ...over });

    it("copies from the first key frame at its own presentation time, not from output frame zero", () => {
      const result = plan(project([clip({ id: "c1", startTime: 0, duration: 21.4, outPoint: 21.4 })]), shifted(1.4), 642);
      expect(result.eligible).toBe(true);
      // media time is the file's own PTS: output frames 0..41 come before the first source frame and are re-encoded
      expect(result.segments).toEqual([
        { kind: "encode", startFrame: 0, endFrame: 42 },
        { kind: "copy", startFrame: 42, endFrame: 642, mediaId: "m1", sourceStart: 1.4, sourceEnd: 21.4 },
      ]);
      expect(result.copiedPercent).toBeGreaterThan(90);
    });

    it("cuts at the key frames of a shifted source around an effect, keeping frame numbers exact", () => {
      const effect = [{ id: "e", type: "vignette", params: {}, enabled: true }] as never;
      const result = plan(
        project([
          clip({ id: "a", startTime: 0, duration: 7.4, outPoint: 7.4 }),
          clip({ id: "b", startTime: 7.4, duration: 2, inPoint: 7.4, outPoint: 9.4, effects: effect }),
          clip({ id: "c", startTime: 9.4, duration: 12, inPoint: 9.4, outPoint: 21.4 }),
        ]),
        shifted(1.4),
        642,
      );
      expect(result.segments).toEqual([
        { kind: "encode", startFrame: 0, endFrame: 42 },
        { kind: "copy", startFrame: 42, endFrame: 222, mediaId: "m1", sourceStart: 1.4, sourceEnd: 7.4 },
        { kind: "encode", startFrame: 222, endFrame: 282 },
        { kind: "copy", startFrame: 282, endFrame: 642, mediaId: "m1", sourceStart: 9.4, sourceEnd: 21.4 },
      ]);
    });

    it("tolerates a start within 0.02 frame of the grid and puts frames where the renderer shows them", () => {
      // 1.401 s on a 30 fps grid is 42.03 frames: too far from the grid to place frames without resampling.
      const offGrid = plan(project([clip({ id: "c1", startTime: 0, duration: 21.4, outPoint: 21.4 })]), shifted(1.401), 642);
      expect(offGrid.eligible).toBe(false); // 0.03 of a frame off the grid: beyond the 0.02 tolerance, resampling would be needed
      // 1.4004 s is 42.012 frames: inside the tolerance, first shown at output frame 43
      const near = plan(project([clip({ id: "c1", startTime: 0, duration: 21.4, outPoint: 21.4 })]), shifted(1.4004), 642);
      expect(near.eligible).toBe(true);
      expect(near.segments[0]).toEqual({ kind: "encode", startFrame: 0, endFrame: 43 });
      expect(near.segments[1]).toMatchObject({ kind: "copy", startFrame: 43, sourceStart: 1.4004 });
      // slightly early (1.3996 s = 41.988 frames): shown at output frame 42
      const early = plan(project([clip({ id: "c1", startTime: 0, duration: 21.4, outPoint: 21.4 })]), shifted(1.3996), 642);
      expect(early.segments[1]).toMatchObject({ kind: "copy", startFrame: 42 });
    });

    it("accounts for the offset together with a clip trim and a placement on the timeline", () => {
      // timeline 5 s .. 15 s shows source 3.4 s .. 13.4 s; key frames at 3.4, 5.4, ... 13.4 (all inside)
      const p = project([clip({ id: "c1", startTime: 5, duration: 10, inPoint: 3.4, outPoint: 13.4 })]);
      const result = plan(p, shifted(1.4), 450);
      const copy = result.segments.find((s) => s.kind === "copy");
      // source 3.4 is output 5 s = frame 150 (key frame at 3.4 is the cut point), source 13.4 is frame 450
      expect(copy).toMatchObject({ startFrame: 150, endFrame: 450, sourceStart: 3.4, sourceEnd: 13.4 });
      expect(result.segments[0]).toEqual({ kind: "encode", startFrame: 0, endFrame: 150 });
    });

    it("still refuses a clip whose frames do not land on the output grid", () => {
      const result = plan(project([clip({ id: "c1", startTime: 0, duration: 20, inPoint: 0.0167 })]), shifted(1.4), 600);
      expect(result.eligible).toBe(false);
      expect(result.reasons.join(" ")).toMatch(/not aligned to the frame grid/);
    });
  });

  it("encodes a run covered by an overlay and copies the free parts", () => {
    const text = {
      id: "tx", trackId: "t2", startTime: 8, duration: 4, text: "hi",
    };
    const p = project([clip({ id: "c1", startTime: 0, duration: 20 })], { textClips: [text] as never });
    const result = plan(p);
    const copies = result.segments.filter((s) => s.kind === "copy");
    expect(copies.length).toBe(2);
    // 8..12 is covered: copy ends at key 8, resumes at key 12.
    expect(copies[0]).toMatchObject({ startFrame: 0, endFrame: 240, sourceEnd: 8 });
    expect(copies[1]).toMatchObject({ startFrame: 360, endFrame: 600, sourceStart: 12 });
    expect(result.segments.some((s) => s.kind === "encode" && s.startFrame === 240 && s.endFrame === 360)).toBe(true);
  });

  it.each([
    ["effects", { effects: [{ id: "e", type: "blur", params: {}, enabled: true }] }],
    ["opacity", { transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 0.5 } }],
    ["scale", { transform: { position: { x: 0, y: 0 }, scale: { x: 1.1, y: 1.1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 } }],
    ["speed", { speed: 2 }],
    ["reverse", { reversed: true }],
    ["keyframes", { keyframes: [{ id: "k", time: 0, property: "opacity", value: 1, easing: "linear" } as never] }],
  ])("never copies a clip with %s", (_name, over) => {
    const result = plan(project([clip({ id: "c1", startTime: 0, duration: 20, ...over })]));
    expect(result.eligible).toBe(false);
    expect(result.copiedFrames).toBe(0);
    expect(result.segments).toEqual([{ kind: "encode", startFrame: 0, endFrame: 600 }]);
  });

  it("never copies across a transition", () => {
    const p = project([clip({ id: "c1", startTime: 0, duration: 20 })]);
    (p.timeline.tracks[0] as { transitions: unknown[] }).transitions = [
      { id: "tr", clipAId: "c1", type: "crossfade", duration: 1, params: {} },
    ];
    expect(plan(p).eligible).toBe(false);
  });

  it("refuses sources whose colour would change at a copy/encode boundary, accepts unspecified or BT.709", () => {
    const p = project([clip({ id: "c1", startTime: 0, duration: 20 })]);
    expect(plan(p, source({ color: { matrix: "smpte170m" } })).eligible).toBe(false);
    expect(plan(p, source({ color: { fullRange: true } })).eligible).toBe(false);
    expect(plan(p, source({ color: { transfer: "pq" } })).eligible).toBe(false);
    expect(plan(p, source({ color: { matrix: "bt709", transfer: "bt709", fullRange: false } })).eligible).toBe(true);
    expect(plan(p, source({ color: { matrix: null, transfer: null, fullRange: null } })).eligible).toBe(true);
  });

  it("re-encodes where an adjustment layer, a subtitle or a mask is over the clip", () => {
    const base = project([clip({ id: "c1", startTime: 0, duration: 20 })]);
    const adjustment = { id: "adj", trackId: "t2", startTime: 8, duration: 4, effects: [] };
    const withAdjustment = plan({ ...base, adjustmentLayers: [adjustment] as never });
    expect(withAdjustment.segments.some((s) => s.kind === "encode" && s.startFrame === 240 && s.endFrame === 360)).toBe(true);
    const subtitle = { id: "s", text: "hi", startTime: 8, endTime: 12 };
    const withSubtitle = plan({ ...base, timeline: { ...base.timeline, subtitles: [subtitle] as never } });
    expect(withSubtitle.segments.some((s) => s.kind === "encode" && s.startFrame === 240 && s.endFrame === 360)).toBe(true);
    expect(plan({ ...base, masks: [{ id: "m", clipId: "c1" }] as never }).eligible).toBe(false);
  });

  it("refuses when the export does not match the source", () => {
    const p = project([clip({ id: "c1", startTime: 0, duration: 20 })]);
    expect(plan(p, source({ width: 1920 })).eligible).toBe(false);
    expect(plan(p, source({ frameRate: 25 })).eligible).toBe(false);
    expect(plan(p, source({ closedGops: false })).eligible).toBe(false);
    expect(plan(p, source({ constantFrameRate: false })).eligible).toBe(false);
    expect(plan(p, null).eligible).toBe(false);
    expect(
      planSmartRender({ project: p, settings: { ...settings, codec: "vp9" }, sources: new Map([["m1", source()]]), exportStart: 0, totalFrames: 600 }).eligible,
    ).toBe(false);
  });

  it("refuses a clip that is off the frame grid", () => {
    const p = project([clip({ id: "c1", startTime: 0.0123, duration: 19 })]);
    const result = plan(p);
    expect(result.eligible).toBe(false);
    expect(result.reasons.join()).toMatch(/frame grid/);
  });

  it("ignores runs shorter than one useful GOP", () => {
    const p = project([clip({ id: "c1", startTime: 0, duration: 20 })]);
    const result = plan(p, source({ keyframeTimes: [0] }), 600);
    // One key frame at 0 and the end of media: the whole clip is one GOP and copies.
    expect(result.copiedFrames).toBe(600);
    const tiny = planSmartRender({ project: project([clip({ id: "c1", startTime: 0, duration: 0.3 })]), settings, sources: new Map([["m1", source()]]), exportStart: 0, totalFrames: 9 });
    expect(tiny.eligible).toBe(false);
    expect(MIN_COPY_FRAMES).toBeGreaterThan(9);
  });

  it("honours an export range", () => {
    const p = project([clip({ id: "c1", startTime: 0, duration: 20 })]);
    // Export 3 s .. 9 s: copy starts at key 4 (output frame 30) and ends at key 8 (output frame 150).
    const result = planSmartRender({ project: p, settings, sources: new Map([["m1", source()]]), exportStart: 3, totalFrames: 180 });
    expect(result.segments).toEqual([
      { kind: "encode", startFrame: 0, endFrame: 30 },
      { kind: "copy", startFrame: 30, endFrame: 150, mediaId: "m1", sourceStart: 4, sourceEnd: 8 },
      { kind: "encode", startFrame: 150, endFrame: 180 },
    ]);
  });

  it("encodes the frames under a burned-in subtitle", () => {
    const p = project([clip({ id: "c1", startTime: 0, duration: 20 })]);
    (p.timeline as { subtitles: unknown[] }).subtitles = [{ id: "s", text: "hi", startTime: 8, endTime: 12, style: {} }];
    const result = plan(p);
    expect(result.segments.some((s) => s.kind === "encode" && s.startFrame === 240 && s.endFrame === 360)).toBe(true);
    expect(result.copiedFrames).toBe(480);
  });

  it("skips hidden-track overlays", () => {
    const text = { id: "tx", trackId: "t2", startTime: 8, duration: 4, text: "hi" };
    const p = project([clip({ id: "c1", startTime: 0, duration: 20 })], { textClips: [text] as never });
    (p.timeline as { tracks: unknown[] }).tracks.push({ id: "t2", type: "text", name: "T", clips: [], transitions: [], locked: false, hidden: true, muted: false, solo: false });
    expect(plan(p).copiedFrames).toBe(600);
  });
});

describe("native engine (desktop ffmpeg)", () => {
  const nativeSettings = { ...settings, codec: "h264" } as const;
  const hevcSettings = { ...settings, codec: "h265" } as const;
  const nativeSource = (over: Partial<SmartRenderSourceInfo> = {}) =>
    source({ profile: 100, level: 40, color: { matrix: "bt709", transfer: "bt709", primaries: "bt709", fullRange: false }, ...over });
  const nativePlan = (
    p: Project,
    src: SmartRenderSourceInfo | null = nativeSource(),
    over: Partial<Parameters<typeof planSmartRender>[0]> = {},
  ) =>
    planSmartRender({
      project: p,
      settings: nativeSettings,
      sources: new Map(src ? [["m1", src]] : []),
      exportStart: 0,
      totalFrames: 600,
      engine: "native",
      ...over,
    });
  const whole = () => project([clip({ id: "c1", startTime: 0, duration: 20 })]);

  it("copies an untouched H.264 clip and hands the encoder the source's stream parameters", () => {
    const result = nativePlan(whole());
    expect(result.eligible).toBe(true);
    expect(result.copiedPercent).toBe(100);
    expect(result.encodeMatch).toMatchObject({ codec: "avc", profile: 100, level: 40, frameRate: FPS });
    expect(result.encodeMatch?.color?.matrix).toBe("bt709");
  });

  it("renders the sequence cadence when a 29.97 source and export use a 30 fps timeline", () => {
    const p = project([clip({ id: "clip", startTime: 0, duration: 10 })]);
    const rate = 30000 / 1001;
    for (const engine of ["native", "webcodecs"] as const) {
      const result = planSmartRender({
        project: p, engine, exportStart: 0, totalFrames: 300,
        settings: { ...settings, frameRate: 29.97 },
        sources: new Map([["m1", source({ frameRate: rate })]]),
      });
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain("sequence frame rate requires resampling");
    }
  });

  it("plans a 10-minute 29.97 fps timeline on the exact 30000/1001 grid (a rounded 29.97 would put cuts a GOP early)", () => {
    const ntsc = 30000 / 1001;
    const frames = 17983;
    const long = project(
      [
        clip({ id: "a", startTime: 0, duration: 300.3, inPoint: 0 }),
        clip({ id: "b", startTime: 300.3, duration: 20.02, inPoint: 300.3, effects: [{ id: "e", type: "vignette", params: {}, enabled: true }] }),
        clip({ id: "c", startTime: 320.32, duration: 279.68, inPoint: 320.32 }),
      ],
      { settings: { width: 1280, height: 720, frameRate: ntsc, sampleRate: 48000, channels: 2 } as never },
    );
    const src = nativeSource({
      frameRate: ntsc,
      endTime: (frames * 1001) / 30000,
      keyframeTimes: Array.from({ length: Math.ceil(frames / 30) }, (_, i) => (i * 30 * 1001) / 30000),
    });
    for (const rate of [29.97, ntsc]) {
      const result = nativePlan(long, src, { settings: { ...nativeSettings, frameRate: rate }, totalFrames: 17982 });
      expect(result.segments.map((s) => [s.kind, s.startFrame, s.endFrame])).toEqual([
        ["copy", 0, 9000],
        ["encode", 9000, 9600],
        ["copy", 9600, 17970],
        ["encode", 17970, 17982],
      ]);
    }
  });

  it("accepts BT.601 sources (the encoder converts with the same matrix) but not full range or HDR transfer", () => {
    expect(nativePlan(whole(), nativeSource({ color: { matrix: "smpte170m", transfer: "smpte170m", primaries: "smpte170m" } })).eligible).toBe(true);
    expect(nativePlan(whole(), nativeSource({ color: { fullRange: true } })).eligible).toBe(false);
    expect(nativePlan(whole(), nativeSource({ color: { transfer: "pq" } })).eligible).toBe(false);
    expect(nativePlan(whole(), nativeSource({ color: { matrix: "bt2020-ncl" } })).eligible).toBe(false);
  });

  it("falls back to a full re-encode, with the reason, when the stream parameters cannot be matched", () => {
    const high10 = nativePlan(whole(), nativeSource({ profile: 110 }));
    expect(high10.eligible).toBe(false);
    expect(high10.segments).toEqual([{ kind: "encode", startFrame: 0, endFrame: 600 }]);
    expect(high10.reasons.join()).toMatch(/10-bit \(H\.264 High 10\)/);
    expect(nativePlan(whole(), nativeSource({ level: undefined })).reasons.join()).toMatch(/level is unknown/);
    expect(nativePlan(whole(), nativeSource({ profile: undefined })).eligible).toBe(false);
  });

  it("only matches the codec the export asks for", () => {
    expect(nativePlan(whole(), nativeSource({ codec: "hevc", profile: 1 })).reasons.join()).toMatch(/codec differs/);
    const hevc = nativePlan(whole(), nativeSource({ codec: "hevc", profile: 1, level: 120 }), { settings: hevcSettings });
    expect(hevc.eligible).toBe(true);
    expect(hevc.encodeMatch?.codec).toBe("hevc");
    expect(nativePlan(whole(), nativeSource({ codec: "hevc", profile: 2 }), { settings: hevcSettings }).eligible).toBe(false);
    expect(
      nativePlan(whole(), nativeSource({ codec: "prores" }), { settings: { ...settings, codec: "prores", format: "mov" } }).reasons.join(),
    ).toMatch(/ProRes profile differs/);
  });

  it("plans ProRes (all intra) with every frame a cut point once the profile matches", () => {
    const prores = nativeSource({
      codec: "prores",
      proresProfile: "hq",
      allIntra: true,
      closedGops: true,
      keyframeTimes: Array.from({ length: 600 }, (_, i) => i / FPS),
      profile: undefined,
      level: undefined,
      color: undefined,
    });
    const p = project([clip({ id: "c1", startTime: 0, duration: 20, inPoint: 0.5, outPoint: 20 })]);
    const proresSettings = { ...settings, codec: "prores", format: "mov", proresProfile: "hq" } as const;
    const result = nativePlan(p, prores, { settings: proresSettings, totalFrames: 585 });
    expect(result.eligible).toBe(true);
    expect(result.segments.filter((s) => s.kind === "encode")).toEqual([]);
    expect(result.copiedFrames).toBe(585);
    expect(nativePlan(p, prores, { settings: { ...proresSettings, proresProfile: "standard" } }).eligible).toBe(false);
  });

  it("refuses pixel formats and bit depths the camera stream does not have", () => {
    expect(nativePlan(whole(), nativeSource(), { settings: { ...nativeSettings, colorDepth: 10 } }).eligible).toBe(false);
    expect(nativePlan(whole(), nativeSource(), { settings: { ...nativeSettings, pixelFormat: "yuv422" } }).eligible).toBe(false);
  });

  it("keeps the parameter group that saves the most frames when sources differ", () => {
    const other = { ...media(), id: "m2" } as MediaItem;
    const p = project([
      clip({ id: "c1", startTime: 0, duration: 6 }),
      clip({ id: "c2", startTime: 6, duration: 14, mediaId: "m2" }),
    ]);
    (p.mediaLibrary as { items: MediaItem[] }).items.push(other);
    const result = planSmartRender({
      project: p,
      settings: nativeSettings,
      sources: new Map([
        ["m1", nativeSource()],
        ["m2", nativeSource({ mediaId: "m2", profile: 77, level: 31 })],
      ]),
      exportStart: 0,
      totalFrames: 600,
      engine: "native",
    });
    expect(result.encodeMatch).toMatchObject({ profile: 77, level: 31 });
    expect(result.segments.filter((s) => s.kind === "copy").every((s) => s.kind === "copy" && s.mediaId === "m2")).toBe(true);
    expect(result.reasons.join()).toMatch(/different stream parameters/);
    expect(result.copiedFrames).toBeLessThan(600);
  });

  describe("never copies across a pixel-affecting change", () => {
    const neutral = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };
    const touched: Array<[string, Partial<Clip>]> = [
      ["effects", { effects: [{ id: "e", type: "blur", params: {}, enabled: true }] }],
      ["color grading", { colorGrading: { exposure: 0.2 } as never }],
      ["crop", { transform: { ...neutral, crop: { x: 0, y: 0, width: 0.5, height: 1 } } }],
      ["transform", { transform: { ...neutral, position: { x: 10, y: 0 } } }],
      ["blend mode", { blendMode: "multiply" as never }],
      ["speed", { speed: 1.5 }],
      ["speed ramp", { speedKeyframes: [{ id: "s", time: 0, speed: 1 } as never] }],
      ["freeze frame", { freezeFrames: [{ id: "f", time: 1, duration: 1 } as never] }],
      ["stabilization", { stabilization: { enabled: true, strength: 1, cropMode: "auto" } }],
      ["chroma key", { chromaKey: { enabled: true } as never }],
      ["nested sequence", { mediaId: "compound:seq1" }],
    ];
    it.each(touched)("%s", (_name, over) => {
      const result = nativePlan(project([clip({ id: "c1", startTime: 0, duration: 20, ...over })]));
      expect(result.eligible).toBe(false);
      expect(result.copiedFrames).toBe(0);
    });

    it("graphics, captions, masks and particles over a clip re-encode exactly the covered frames", () => {
      const base = whole();
      const cases: Array<[string, Project]> = [
        ["text", { ...base, textClips: [{ id: "tx", trackId: "t2", startTime: 8, duration: 4, text: "hi" }] as never }],
        ["shape", { ...base, shapeClips: [{ id: "sh", trackId: "t2", startTime: 8, duration: 4 }] as never }],
        ["adjustment layer", { ...base, adjustmentLayers: [{ id: "adj", trackId: "t2", startTime: 8, duration: 4, effects: [] }] as never }],
        ["burned-in caption", { ...base, timeline: { ...base.timeline, subtitles: [{ id: "s", text: "hi", startTime: 8, endTime: 12 }] as never } }],
      ];
      for (const [name, p] of cases) {
        const result = nativePlan(p);
        expect(result.segments.some((s) => s.kind === "encode" && s.startFrame === 240 && s.endFrame === 360), name).toBe(true);
        expect(result.copiedFrames, name).toBe(480);
      }
      expect(nativePlan({ ...base, masks: [{ id: "m", clipId: "c1" }] as never }).eligible).toBe(false);
      expect(nativePlan({ ...base, particleEffects: [{ id: "p", clipId: "c1" }] as never }).eligible).toBe(false);
    });

    it("a multicam angle switch copies each angle's own whole GOPs and re-encodes the cut GOPs", () => {
      // Angle 1 plays 0..7 s of m1; angle 2 plays 7..20 s of m2. The cut at 7 s is inside a GOP of both.
      const m2 = { ...media(), id: "m2" } as MediaItem;
      const p = project([
        clip({ id: "a", startTime: 0, duration: 7, mediaId: "m1" }),
        clip({ id: "b", startTime: 7, duration: 13, mediaId: "m2", inPoint: 7, outPoint: 20 }),
      ]);
      (p.mediaLibrary as { items: MediaItem[] }).items.push(m2);
      const result = planSmartRender({
        project: p,
        settings: nativeSettings,
        sources: new Map([["m1", nativeSource()], ["m2", nativeSource({ mediaId: "m2" })]]),
        exportStart: 0,
        totalFrames: 600,
        engine: "native",
      });
      expect(result.segments.filter((s) => s.kind === "encode")).toEqual([{ kind: "encode", startFrame: 180, endFrame: 240 }]);
      expect(result.segments.filter((s) => s.kind === "copy")).toEqual([
        { kind: "copy", startFrame: 0, endFrame: 180, mediaId: "m1", sourceStart: 0, sourceEnd: 6, tailLimitFrame: 210 },
        { kind: "copy", startFrame: 240, endFrame: 600, mediaId: "m2", sourceStart: 8, sourceEnd: 20 },
      ]);
    });

    it("plans from the full-resolution item: a proxy reference never changes what is copied", () => {
      const p = whole();
      (p.mediaLibrary.items[0] as unknown as { proxy: unknown }).proxy = { id: "px", storage: "idb", status: "ready" };
      const result = nativePlan(p);
      expect(result.copiedPercent).toBe(100);
      expect(result.segments).toEqual([{ kind: "copy", startFrame: 0, endFrame: 600, mediaId: "m1", sourceStart: 0, sourceEnd: 20 }]);
    });
  });
});

describe("native source probe", () => {
  const ok = { codec: "h264", pixelFormat: "yuv420p", color: { range: "tv", matrix: "bt709" } };

  it("accepts 8-bit 4:2:0 limited-range BT.709 and untagged streams", () => {
    expect(nativeProbeMismatch(ok, "avc")).toBeNull();
    expect(nativeProbeMismatch({ codec: "h264", pixelFormat: "yuv420p", color: {} }, "avc")).toBeNull();
    expect(nativeProbeMismatch({ codec: "hevc", pixelFormat: "yuv420p", color: { matrix: "smpte170m" } }, "hevc")).toBeNull();
  });

  it("refuses what the encoder cannot reproduce", () => {
    expect(nativeProbeMismatch({ ...ok, pixelFormat: "yuv420p10le" }, "avc")).toMatch(/8-bit 4:2:0/);
    expect(nativeProbeMismatch({ ...ok, pixelFormat: "yuvj420p" }, "avc")).toMatch(/8-bit 4:2:0/);
    expect(nativeProbeMismatch({ ...ok, color: { range: "pc" } }, "avc")).toMatch(/full-range/);
    expect(nativeProbeMismatch({ ...ok, color: { matrix: "bt2020nc" } }, "avc")).toMatch(/BT\.2020/);
    expect(nativeProbeMismatch({ ...ok, color: { transfer: "smpte2084" } }, "avc")).toMatch(/HDR \(PQ\)/);
    expect(nativeProbeMismatch({ ...ok, color: { transfer: "arib-std-b67" } }, "avc")).toMatch(/HDR \(HLG\)/);
    expect(nativeProbeMismatch({ ...ok, color: { primaries: "bt2020" } }, "avc")).toMatch(/BT\.2020/);
    expect(nativeProbeMismatch({ ...ok, color: { transfer: "smpte428" } }, "avc")).toMatch(/transfer/);
    expect(nativeProbeMismatch(ok, "hevc")).toMatch(/different codec/);
  });

  it("declining turns the plan into a full re-encode and keeps the reasons", () => {
    const base = planSmartRender({ project: project([clip({ id: "c1", startTime: 0, duration: 20 })]), settings, sources: new Map([["m1", source({ profile: 100, level: 40 })]]), exportStart: 0, totalFrames: 600, engine: "native" });
    expect(base.eligible).toBe(true);
    const declined = declineSmartRender(base, "source is full-range");
    expect(declined.eligible).toBe(false);
    expect(declined.segments).toEqual([{ kind: "encode", startFrame: 0, endFrame: 600 }]);
    expect(declined.reasons).toContain("source is full-range");
  });
});

describe("avc config helpers", () => {
  const sps = new Uint8Array([0x67, 0x64, 0x00, 0x1f]);
  const pps = new Uint8Array([0x68, 0xee, 0x3c, 0x80]);
  const avcC = new Uint8Array([1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, sps.length, ...sps, 1, 0, pps.length, ...pps]);

  it("parses an avcC record", () => {
    const sets = parseAvcC(avcC)!;
    expect(sets.nalLengthSize).toBe(4);
    expect(sets.sps[0]).toEqual(sps);
    expect(sets.pps[0]).toEqual(pps);
    expect(parseAvcC(new Uint8Array([2, 0, 0]))).toBeNull();
  });

  it("repairs the duplicated SPS and PPS in Firefox OpenH264 encoder metadata once", () => {
    const malformed = new Uint8Array([1, 100, 0, 40, 3, 1, 0, 6, 103, 103, 100, 0, 40, 172, 1, 0, 3, 104, 104, 238]);
    const decoderConfig = { codec: "avc1.640028", description: malformed };
    repairEncoderAvcConfig({ decoderConfig });
    expect(Array.from(decoderConfig.description)).toEqual([1, 100, 0, 40, 255, 225, 0, 5, 103, 100, 0, 40, 172, 1, 0, 2, 104, 238]);
    const repaired = decoderConfig.description;
    repairEncoderAvcConfig({ decoderConfig });
    expect(decoderConfig.description).toBe(repaired);
  });

  it("prepends length-prefixed parameter sets to a packet", () => {
    const sets = parseAvcC(avcC)!;
    const packet = new Uint8Array([0, 0, 0, 2, 0x65, 0x88]);
    const out = prependParameterSets(packet, sets);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 4]);
    expect(Array.from(out.slice(4, 8))).toEqual(Array.from(sps));
    expect(Array.from(out.slice(8, 12))).toEqual([0, 0, 0, 4]);
    expect(Array.from(out.slice(12, 16))).toEqual(Array.from(pps));
    expect(Array.from(out.slice(16))).toEqual(Array.from(packet));
  });

  it("keys parameter sets by content", () => {
    const a = parseAvcC(avcC)!;
    const other = new Uint8Array(avcC);
    other[9] = 0x65;
    expect(parameterSetKey(a)).toBe(parameterSetKey(parseAvcC(avcC)!));
    expect(parameterSetKey(a)).not.toBe(parameterSetKey(parseAvcC(other)!));
  });
});

describe("native decline reasons name the format that cannot be copied", () => {
  const nativeSettings = { ...settings, codec: "h264" } as const;
  const hevcSettings = { ...settings, codec: "h265" } as const;
  const sdr = { matrix: "bt709", transfer: "bt709", primaries: "bt709", fullRange: false };
  const reasonFor = (over: Partial<SmartRenderSourceInfo>, s: typeof nativeSettings | typeof hevcSettings = nativeSettings) =>
    planSmartRender({
      project: project([clip({ id: "c1", startTime: 0, duration: 20 })]),
      settings: s,
      sources: new Map([["m1", source({ profile: 100, level: 40, color: sdr, ...over })]]),
      exportStart: 0,
      totalFrames: 600,
      engine: "native",
    });

  it.each([
    [{ profile: 110 }, /10-bit \(H\.264 High 10\)/],
    [{ profile: 122 }, /4:2:2/],
    [{ profile: 244 }, /4:4:4/],
    [{ color: { ...sdr, transfer: "pq" } }, /HDR \(PQ\)/],
    [{ color: { ...sdr, transfer: "hlg" } }, /HDR \(HLG\)/],
    [{ color: { ...sdr, matrix: "bt2020-ncl", primaries: "bt2020" } }, /BT\.2020/],
  ] as const)("H.264 %j", (over, pattern) => {
    const result = reasonFor(over as Partial<SmartRenderSourceInfo>);
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(" ")).toMatch(pattern);
    expect(result.reasons.join(" ")).toMatch(/8-bit 4:2:0 SDR sources only/);
  });

  it("HEVC Main 10 and range-extension profiles", () => {
    expect(reasonFor({ codec: "hevc", profile: 2, level: 120 }, hevcSettings).reasons.join(" ")).toMatch(/10-bit \(HEVC Main 10\)/);
    expect(reasonFor({ codec: "hevc", profile: 4, level: 120 }, hevcSettings).reasons.join(" ")).toMatch(/4:2:2, 4:4:4/);
  });

  it("describes ffmpeg pixel formats", () => {
    expect(describePixelFormat("yuv422p10le")).toBe("10-bit 4:2:2");
    expect(describePixelFormat("yuv420p")).toBe("8-bit 4:2:0");
    expect(describePixelFormat("yuvj420p")).toBe("8-bit full-range 4:2:0");
    expect(describePixelFormat("yuv444p12le")).toBe("12-bit 4:4:4");
    expect(describePixelFormat("p010le")).toBe("10-bit 4:2:0");
    expect(describePixelFormat("p210le")).toBe("10-bit 4:2:2");
    expect(nativeProbeMismatch({ codec: "hevc", pixelFormat: "yuv422p10le", color: {} }, "hevc")).toMatch(/10-bit 4:2:2/);
  });
});

describe("native ProRes source copy", () => {
  const prores = (over: Partial<SmartRenderSourceInfo> = {}): SmartRenderSourceInfo =>
    source({
      codec: "prores",
      allIntra: true,
      proresProfile: "hq",
      keyframeTimes: Array.from({ length: 600 }, (_, i) => i / FPS),
      endTime: 600 / FPS,
      color: { matrix: "bt709", transfer: "bt709", primaries: "bt709", fullRange: false },
      ...over,
    });
  const proresSettings = { format: "mov", codec: "prores", width: 1280, height: 720, frameRate: FPS, proresProfile: "hq" } as const;
  const run = (p: Project, src: SmartRenderSourceInfo, s: Parameters<typeof planSmartRender>[0]["settings"] = proresSettings) =>
    planSmartRender({ project: p, settings: s, sources: new Map([["m1", src]]), exportStart: 0, totalFrames: 600, engine: "native" });
  const effect = [{ id: "e", type: "vignette", params: {}, enabled: true }] as never;

  it("copies untouched ProRes spans exactly (every frame is a cut point) and re-encodes only the effect", () => {
    const p = project([
      clip({ id: "a", startTime: 0, duration: 7, inPoint: 0 }),
      clip({ id: "b", startTime: 7, duration: 3, inPoint: 7, effects: effect }),
      clip({ id: "c", startTime: 10, duration: 10, inPoint: 10 }),
    ]);
    const result = run(p, prores({ endTime: 20, keyframeTimes: Array.from({ length: Math.round(20 * FPS) }, (_, i) => i / FPS) }));
    expect(result.eligible).toBe(true);
    expect(result.encodeMatch).toMatchObject({ codec: "prores", proresProfile: "hq", allIntra: true });
    const kinds = result.segments.map((s) => s.kind);
    expect(kinds).toEqual(["copy", "encode", "copy"]);
    // not rounded out to a GOP: the copy ends on the frame before the effect
    const [first, middle] = result.segments;
    expect(first.endFrame).toBe(middle.startFrame);
    expect(Math.abs(first.endFrame - 7 * FPS)).toBeLessThan(1);
    expect(result.reencodedFrames).toBeLessThan(Math.ceil(3 * FPS) + 2);
  });

  it("declines a profile mismatch, 4444, and HDR with the reason", () => {
    const p = project([clip({ id: "c1", startTime: 0, duration: 20 })]);
    expect(run(p, prores({ proresProfile: "lt" })).reasons.join(" ")).toMatch(/ProRes profile differs/);
    expect(run(p, prores({ proresProfile: "4444" }), { ...proresSettings, proresProfile: "4444" }).reasons.join(" ")).toMatch(/ProRes 4444/);
    expect(run(p, prores({ color: { transfer: "pq" } })).reasons.join(" ")).toMatch(/HDR \(PQ\)/);
  });

  it("probe check wants ProRes 4:2:2 10-bit", () => {
    expect(nativeProbeMismatch({ codec: "prores", pixelFormat: "yuv422p10le", color: { matrix: "bt709" } }, "prores")).toBeNull();
    expect(nativeProbeMismatch({ codec: "prores", pixelFormat: "yuv444p12le", color: {} }, "prores")).toMatch(/not ProRes 4:2:2/);
    expect(nativeProbeMismatch({ codec: "prores", pixelFormat: "yuv422p10le", color: { transfer: "arib-std-b67" } }, "prores")).toMatch(/HDR \(HLG\)/);
  });
});

describe("smart cut: copying into the partial GOP before an edit", () => {
  const native = { format: "mp4", codec: "h264", width: 1280, height: 720, frameRate: FPS } as const;
  const nativeSrc = (over: Partial<SmartRenderSourceInfo> = {}) => source({ profile: 100, level: 40, ...over });
  const withEffect = () => {
    const clips = [
      clip({ id: "a", startTime: 0, duration: 7, mediaId: "m1" }),
      clip({ id: "b", startTime: 7, duration: 3, mediaId: "m1", inPoint: 7, outPoint: 10, effects: [{ id: "e", type: "blur", params: {}, enabled: true }] as never }),
      clip({ id: "c", startTime: 10, duration: 10, mediaId: "m1", inPoint: 10, outPoint: 20 }),
    ];
    return planSmartRender({ project: project(clips), settings: native, sources: new Map([["m1", nativeSrc()]]), exportStart: 0, totalFrames: 600, engine: "native" });
  };

  describe("cleanTailFrames", () => {
    it("stops at the last anchor frame (I or P) before the limit, never on a B-frame", () => {
      // display order I B B P B B P B B P
      expect(cleanTailFrames("IBBPBBPBBP", 10)).toBe(10);
      expect(cleanTailFrames("IBBPBBPBBP", 9)).toBe(7);
      expect(cleanTailFrames("IBBPBBPBBP", 8)).toBe(7);
      expect(cleanTailFrames("IBBPBBPBBP", 6)).toBe(4);
      expect(cleanTailFrames("IBBPBBPBBP", 3)).toBe(1);
      expect(cleanTailFrames("IBBPBBPBBP", 2)).toBe(1);
    });
    it("handles hierarchical B (a reference B is still a B) and P-only streams", () => {
      expect(cleanTailFrames("IBBBPBBBP", 3)).toBe(1);
      expect(cleanTailFrames("IPPPPP", 4)).toBe(4);
    });
    it("refuses a probe that does not start at a key frame, and an empty tail", () => {
      expect(cleanTailFrames("PBBP", 4)).toBe(0);
      expect(cleanTailFrames("", 4)).toBe(0);
      expect(cleanTailFrames("IBB", 0)).toBe(0);
    });
  });

  it("the native planner records how far each copy could run into the cut GOP, and never for the browser engine or all-intra", () => {
    const result = withEffect();
    const copies = result.segments.filter((s) => s.kind === "copy");
    // key frames every 60 frames: the effect starts at frame 210 so the head copy stops at 180 with 30 frames of GOP left.
    expect(copies[0]).toMatchObject({ startFrame: 0, endFrame: 180, tailLimitFrame: 210 });
    expect(copies[1]).toMatchObject({ startFrame: 300 });
    expect(copies[1]).not.toHaveProperty("tailLimitFrame");
    const web = planSmartRender({ project: project([clip({ id: "a", startTime: 0, duration: 7 })]), settings: native, sources: new Map([["m1", source()]]), exportStart: 0, totalFrames: 210 });
    expect(web.segments.every((s) => s.kind !== "copy" || s.tailLimitFrame === undefined)).toBe(true);
  });

  describe("extendCopyTails", () => {
    it("moves the copy end and the encode start by the same frames and keeps every frame covered exactly once", () => {
      const base = withEffect();
      const extended = extendCopyTails(base, FPS, new Map([[0, 28]]));
      expect(extended.segments[0]).toEqual({ kind: "copy", startFrame: 0, endFrame: 208, mediaId: "m1", sourceStart: 0, sourceEnd: 208 / FPS });
      expect(extended.segments[1]).toEqual({ kind: "encode", startFrame: 208, endFrame: 300 });
      expect(extended.copiedFrames).toBe(base.copiedFrames + 28);
      expect(extended.copiedFrames + extended.reencodedFrames).toBe(600);
      let cursor = 0;
      for (const segment of extended.segments) {
        expect(segment.startFrame).toBe(cursor);
        cursor = segment.endFrame;
      }
      expect(cursor).toBe(600);
    });
    it("never takes more than the planner's limit", () => {
      const extended = extendCopyTails(withEffect(), FPS, new Map([[0, 500]]));
      expect(extended.segments[0]).toMatchObject({ endFrame: 210 });
    });
    it("does nothing without extensions", () => {
      const base = withEffect();
      expect(extendCopyTails(base, FPS, new Map())).toBe(base);
      expect(extendCopyTails(base, FPS, new Map([[0, 0]]))).toBe(base);
    });
    it("NTSC frame rates keep the source time on the exact rational grid", () => {
      const base = withEffect();
      const extended = extendCopyTails(base, 29.97, new Map([[0, 30]]));
      expect(extended.segments[0]).toMatchObject({ endFrame: 210 });
      const seg = extended.segments[0];
      if (seg.kind !== "copy") throw new Error("copy expected");
      expect(seg.sourceEnd).toBeCloseTo(6 + 30 * (1001 / 30000), 9);
    });
  });
});

describe("razor cuts that change nothing", () => {
  const native = { format: "mp4", codec: "h264", width: 1280, height: 720, frameRate: FPS } as const;
  const plan2 = (clips: Clip[], total = 600) =>
    planSmartRender({ project: project(clips), settings: native, sources: new Map([["m1", source({ profile: 100, level: 40 })]]), exportStart: 0, totalFrames: total, engine: "native" });

  it("two clips playing one source back to back are a single copy, with no re-encode around the cut", () => {
    const result = plan2([
      clip({ id: "a", startTime: 0, duration: 7 }),
      clip({ id: "b", startTime: 7, duration: 13, inPoint: 7, outPoint: 20 }),
    ]);
    expect(result.segments).toEqual([{ kind: "copy", startFrame: 0, endFrame: 600, mediaId: "m1", sourceStart: 0, sourceEnd: 20 }]);
    expect(result.reencodedFrames).toBe(0);
  });

  it("many splits in a row still merge, and an edit between them is the only thing re-encoded", () => {
    const result = plan2([
      clip({ id: "a", startTime: 0, duration: 5 }),
      clip({ id: "b", startTime: 5, duration: 2, inPoint: 5, outPoint: 7 }),
      clip({ id: "c", startTime: 7, duration: 3, inPoint: 7, outPoint: 10, effects: [{ id: "e", type: "blur", params: {}, enabled: true }] as never }),
      clip({ id: "d", startTime: 10, duration: 4, inPoint: 10, outPoint: 14 }),
      clip({ id: "e", startTime: 14, duration: 6, inPoint: 14, outPoint: 20 }),
    ]);
    const copies = result.segments.filter((s) => s.kind === "copy");
    expect(copies.map((c) => [c.startFrame, c.endFrame])).toEqual([[0, 180], [300, 600]]);
    expect(result.segments.filter((s) => s.kind === "encode")).toEqual([{ kind: "encode", startFrame: 180, endFrame: 300 }]);
  });

  it("a ripple delete (the second clip plays from further on in the source) is not merged", () => {
    const result = plan2([
      clip({ id: "a", startTime: 0, duration: 7 }),
      clip({ id: "b", startTime: 7, duration: 10, inPoint: 10, outPoint: 20 }),
    ], 510);
    const copies = result.segments.filter((s) => s.kind === "copy");
    expect(copies).toHaveLength(2);
    expect(result.reencodedFrames).toBeGreaterThan(0);
  });

  it("a split with a transition on it is not merged away", () => {
    const p = project([
      clip({ id: "a", startTime: 0, duration: 7 }),
      clip({ id: "b", startTime: 7, duration: 13, inPoint: 7, outPoint: 20 }),
    ]);
    (p.timeline.tracks[0] as unknown as { transitions: unknown[] }).transitions = [{ id: "t", clipAId: "a", clipBId: "b", type: "fade", duration: 1 }];
    const result = planSmartRender({ project: p, settings: native, sources: new Map([["m1", source({ profile: 100, level: 40 })]]), exportStart: 0, totalFrames: 600, engine: "native" });
    expect(result.eligible).toBe(false);
  });
});

describe("planSmartRender and Morph Cut", () => {
  const native = { format: "mp4", codec: "h264", width: 1280, height: 720, frameRate: FPS } as const;
  it("never stream-copies any frame of a Morph Cut span: the warped frames are rendered and re-encoded", () => {
    const p = project([
      clip({ id: "a", startTime: 0, duration: 7 }),
      clip({ id: "b", startTime: 7, duration: 13, inPoint: 7, outPoint: 20 }),
    ]);
    (p.timeline.tracks[0] as unknown as { transitions: unknown[] }).transitions = [{ id: "mc", clipAId: "a", clipBId: "b", type: "morphCut", duration: 1, params: { quality: "medium" } }];
    const result = planSmartRender({ project: p, settings: native, sources: new Map([["m1", source({ profile: 100, level: 40 })]]), exportStart: 0, totalFrames: 600, engine: "native" });
    // the span is 6.5 s .. 7.5 s = frames 195..225 at 30 fps
    const overlapsSpan = result.segments.filter((s) => s.kind === "copy" && s.startFrame < 225 && s.endFrame > 195);
    expect(overlapsSpan).toEqual([]);
    expect(result.segments.some((s) => s.kind === "encode" && s.startFrame <= 195 && s.endFrame >= 225)).toBe(true);
    expect(result.eligible).toBe(false);
  });
});

describe("planSmartRender and multichannel audio", () => {
  // Smart render copies PICTURE only; every sound is rendered from the audio mixdown and encoded once in the final pass.
  // So a clip's channel map, audio stream and patch slot cannot change which frames are copied, and the audio is never copied.
  it("plans the same copy for a clip with a custom channel map, another audio stream and a patch slot as for a plain clip", () => {
    const plain = plan(project([clip({ id: "c1", startTime: 0, duration: 20 })]));
    const mapped = plan(project([
      clip({ id: "c1", startTime: 0, duration: 20, channelMap: { format: "mono", sources: [2] }, audioTrackIndex: 1, metadata: { sourceChannelGroup: 2 } }),
    ]));
    expect(mapped.eligible).toBe(true);
    expect(mapped.segments).toEqual(plain.segments);
    expect(mapped.copiedFrames).toBe(plain.copiedFrames);
  });

  it("a picture clip with its sound on separate multichannel audio clips still copies the whole picture", () => {
    const sound = (id: string, group: number) => clip({ id, startTime: 0, duration: 20, trackId: "a1", transform: { ...clip({ id: "x", startTime: 0, duration: 1 }).transform, opacity: 0 }, channelMap: { format: "mono", sources: [group] }, volume: 1, metadata: { sourceChannelGroup: group, separatedFromClipId: "c1" } });
    const p = project([clip({ id: "c1", startTime: 0, duration: 20, volume: 0, metadata: { sourceMonitorComponent: "video" } })]);
    const withSound = {
      ...p,
      timeline: { ...p.timeline, tracks: [...p.timeline.tracks, { id: "a1", type: "audio", name: "A1", clips: [sound("s0", 0), sound("s1", 1)], transitions: [], locked: false, hidden: false, muted: false, solo: false } as Track] },
    } as Project;
    const result = plan(withSound);
    expect(result.eligible).toBe(true);
    expect(result.copiedFrames).toBe(600);
  });

  it("an invisible clip that is NOT a sound clip (opacity keyframed on) still covers the picture", () => {
    const p = project([clip({ id: "c1", startTime: 0, duration: 20 })]);
    const overlay = clip({ id: "o1", startTime: 5, duration: 5, trackId: "v2", transform: { ...clip({ id: "x", startTime: 0, duration: 1 }).transform, opacity: 0 }, keyframes: [{ id: "k", time: 0, property: "opacity", value: 1, easing: "linear" } as never] });
    const result = plan({ ...p, timeline: { ...p.timeline, tracks: [...p.timeline.tracks, { id: "v2", type: "video", name: "V2", clips: [overlay], transitions: [], locked: false, hidden: false, muted: false, solo: false } as Track] } } as Project);
    expect(result.copiedFrames).toBeLessThan(600);
  });
});
