import { describe, expect, it } from "vitest";
import { makeFrameRate, resolveFrameRate, secondsToFrames } from "../interchange/timecode";
import type { Effect } from "../types/timeline";
import {
  BURN_IN_DEFAULTS,
  BURN_IN_SPECS,
  BURN_IN_TEXT_PARAM,
  burnInFrameRate,
  createBurnInSource,
  drawBurnIn,
  elapsedFrames,
  formatBurnInTimecode,
  hasBurnInEffects,
  isBurnInNeutral,
  resolveBurnInNameText,
  resolveBurnInParams,
  resolveBurnInTimecodeText,
  timecodeBurnInOverlay,
  withBurnInText,
  type BurnInSource,
} from "./burn-in";
import { getAnimatedVideoEffects, hasAnimatedVideoEffects, isRenderableVideoEffect } from "./animated-video-effects";
import { getDefaultEffectParams, withEffectDefaults } from "./effect-defaults";

const DF30 = makeFrameRate(30, true, true);
const NDF30 = makeFrameRate(30, true, false);
const DF60 = makeFrameRate(60, true, true);
const R25 = makeFrameRate(25, false);
const R24 = makeFrameRate(24, false);

const tc = (frames: number, rate = DF30, extra: object = {}) => formatBurnInTimecode({ frames, rate, ...extra });

describe("formatBurnInTimecode", () => {
  it("counts 29.97 drop-frame: minute boundaries drop frame numbers 00 and 01", () => {
    expect(tc(0)).toBe("00:00:00;00");
    expect(tc(1799)).toBe("00:00:59;29");
    expect(tc(1800)).toBe("00:01:00;02");
    expect(tc(3597)).toBe("00:01:59;29");
    expect(tc(3598)).toBe("00:02:00;02");
  });

  it("does not drop on every tenth minute", () => {
    expect(tc(17981)).toBe("00:09:59;29");
    expect(tc(17982)).toBe("00:10:00;00");
    expect(tc(17983)).toBe("00:10:00;01");
  });

  it("matches the wall clock over an hour (107892 frames = 01:00:00;00)", () => {
    expect(tc(107891)).toBe("00:59:59;29");
    expect(tc(107892)).toBe("01:00:00;00");
    // Drop-frame stays within 3.6 ms of the wall clock per hour (the whole point of dropping).
    expect(Math.abs((107892 * 1001) / 30000 - 3600)).toBeLessThan(0.004);
    // Non-drop 29.97 drifts 3.6 s per hour.
    expect(Math.abs((108000 * 1001) / 30000 - 3600)).toBeGreaterThan(3.5);
  });

  it("counts 29.97 non-drop without dropping anything", () => {
    expect(tc(1800, NDF30)).toBe("00:01:00:00");
    expect(tc(107892, NDF30)).toBe("00:59:56:12");
  });

  it("counts 59.94 drop-frame (four frame numbers per minute)", () => {
    expect(tc(3599, DF60)).toBe("00:00:59;59");
    expect(tc(3600, DF60)).toBe("00:01:00;04");
    expect(tc(35964, DF60)).toBe("00:10:00;00");
  });

  it("handles integer rates", () => {
    expect(tc(90000, R25)).toBe("01:00:00:00");
    expect(tc(24 * 3600 + 23, R24)).toBe("01:00:00:23");
  });

  it("shows a minus sign for negative frames (offsets before the start)", () => {
    expect(tc(-30, NDF30)).toBe("-00:00:01:00");
    expect(tc(-1, DF30, { format: "frames" })).toBe("-1");
  });

  it("formats plain frames and feet + frames", () => {
    expect(tc(1234, R24, { format: "frames" })).toBe("1234");
    expect(tc(100, R24, { format: "feet-16" })).toBe("0002+20");
    expect(tc(100, R24, { format: "feet-35" })).toBe("0006+04");
    expect(tc(0, R24, { format: "feet-35" })).toBe("0000+00");
  });

  it("marks the second field with '.' (non-drop) or ',' (drop-frame)", () => {
    expect(tc(1800, NDF30, { secondField: true })).toBe("00:01:00.00");
    expect(tc(1800, DF30, { secondField: true })).toBe("00:01:00,02");
    expect(tc(1800, DF30, { secondField: false })).toBe("00:01:00;02");
  });
});

describe("frame rates", () => {
  it("maps Time display choices to exact rates", () => {
    expect(burnInFrameRate("29.97-df", { fps: 25, dropFrame: false })).toMatchObject({ timebase: 30, ntsc: true, dropFrame: true });
    expect(burnInFrameRate("29.97-ndf", { fps: 25, dropFrame: true })).toMatchObject({ timebase: 30, ntsc: true, dropFrame: false });
    expect(burnInFrameRate("59.94-df", { fps: 25, dropFrame: false })).toMatchObject({ timebase: 60, dropFrame: true });
    expect(burnInFrameRate("23.976", { fps: 25, dropFrame: false })).toMatchObject({ timebase: 24, ntsc: true });
    expect(burnInFrameRate("25", { fps: 30, dropFrame: false })).toMatchObject({ timebase: 25, ntsc: false });
  });

  it("auto follows the native rate and its drop-frame flag", () => {
    expect(burnInFrameRate("auto", { fps: 29.97, dropFrame: true })).toEqual(resolveFrameRate(29.97, { dropFrame: true }));
    expect(burnInFrameRate("auto", { fps: 24, dropFrame: true }).dropFrame).toBe(false);
  });

  it("elapsed frames land exactly on n for t = n / fps and floor in between", () => {
    const rate = resolveFrameRate(29.97);
    for (const n of [0, 1, 29, 30, 1799, 1800, 17982, 107892]) {
      expect(elapsedFrames((n * 1001) / 30000, rate)).toBe(n);
    }
    expect(elapsedFrames((10.5 * 1001) / 30000, rate)).toBe(10);
    expect(elapsedFrames(-1, rate)).toBe(0);
    expect(secondsToFrames(1, rate)).toBe(30);
  });
});

const source = (over: Partial<BurnInSource> = {}): BurnInSource => ({
  frameRate: 29.97,
  sequenceName: "Main Sequence",
  sequenceStartTimecode: "01:00:00;00",
  media: (id) =>
    id === "m1"
      ? { name: "Interview A", fileName: "A001_C003.mov", frameRate: 25, startTimecodeText: "10:00:00:00" }
      : id === "m2"
        ? { name: "Drop clip", fileName: "drop.mov", frameRate: 29.97, startTimecodeText: "00:59:59;00" }
        : undefined,
  ...over,
});

describe("resolveBurnInTimecodeText", () => {
  const clip = { id: "c1", mediaId: "m1", startTime: 0, inPoint: 0 };

  it("shows sequence timecode: start timecode plus the clip's timeline position, drop-frame from the start", () => {
    const params = { source: "sequence" };
    expect(resolveBurnInTimecodeText({ params, source: source(), clip, localTime: 0 })).toBe("01:00:00;00");
    expect(resolveBurnInTimecodeText({ params, source: source(), clip: { ...clip, startTime: 10 }, localTime: 0 })).toBe("01:00:09;29");
    // 60 s of wall clock passes the first minute boundary: frame 1800 = 00:01:00;02.
    expect(resolveBurnInTimecodeText({ params, source: source(), clip: { ...clip, startTime: 60.06 }, localTime: 0 })).toBe("01:01:00;02");
    expect(resolveBurnInTimecodeText({ params, source: source(), clip: { ...clip, startTime: 5 }, localTime: 1 })).toBe("01:00:05;29");
  });

  it("without a sequence start timecode it counts from zero", () => {
    const text = resolveBurnInTimecodeText({
      params: {},
      source: source({ sequenceStartTimecode: undefined }),
      clip: { ...clip, startTime: 3 },
      localTime: 0,
    });
    // 3 s at 29.97 fps is frame 89 (floor of 89.91), non-drop because there is no drop-frame start timecode.
    expect(text).toBe("00:00:02:29");
  });

  it("source timecode uses the file's start, the clip's in point and the file's own frame rate", () => {
    const params = { source: "source" };
    expect(resolveBurnInTimecodeText({ params, source: source(), clip: { ...clip, inPoint: 2 }, localTime: 1 })).toBe("10:00:03:00");
    expect(resolveBurnInTimecodeText({ params, source: source(), clip: { ...clip, inPoint: 0 }, localTime: 0.44 })).toBe("10:00:00:11");
  });

  it("source timecode follows a drop-frame file", () => {
    const text = resolveBurnInTimecodeText({
      params: { source: "source" },
      source: source(),
      clip: { id: "c2", mediaId: "m2", startTime: 0, inPoint: 0 },
      localTime: 1,
    });
    // 00:59:59;00 plus 29 frames (floor of 29.97) is still inside that second.
    expect(text).toBe("00:59:59;29");
    const later = resolveBurnInTimecodeText({
      params: { source: "source" },
      source: source(),
      clip: { id: "c2", mediaId: "m2", startTime: 0, inPoint: 0 },
      localTime: 2,
    });
    // Plus 59 frames: 30 finish second 59, the hour boundary has no drop, 29 more land on 01:00:00;29.
    expect(later).toBe("01:00:00;29");
  });

  it("clip timecode counts from the first frame of the clip", () => {
    const params = { source: "clip", timeBase: "25" };
    expect(resolveBurnInTimecodeText({ params, source: source(), clip: { ...clip, startTime: 40 }, localTime: 1.5 })).toBe("00:00:01:12");
  });

  it("a source timecode on a clip without a file counts from the clip start", () => {
    const text = resolveBurnInTimecodeText({
      params: { source: "source", timeBase: "25" },
      source: source(),
      clip: { id: "t1", startTime: 9, inPoint: 0 },
      localTime: 2,
    });
    expect(text).toBe("00:00:02:00");
  });

  it("applies the time display override, format, offset, field mark and label", () => {
    const base = { source: "clip", timeBase: "29.97-df" };
    const run = (extra: object, localTime = 60.07) =>
      resolveBurnInTimecodeText({ params: { ...base, ...extra }, source: source(), clip, localTime });
    expect(run({})).toBe("00:01:00;02");
    expect(run({ timeBase: "29.97-ndf" })).toBe("00:01:00:00");
    expect(run({ format: "frames" })).toBe("1800");
    expect(run({ offsetFrames: 10 })).toBe("00:01:00;12");
    expect(run({ offsetFrames: -1800 })).toBe("00:00:00;00");
    expect(run({ field: "field-2" })).toBe("00:01:00,02");
    expect(run({ label: "CAM A" })).toBe("CAM A  00:01:00;02");
  });
});

describe("resolveBurnInNameText", () => {
  const clip = { id: "c1", mediaId: "m1" };
  it("clip name, file name (with or without extension) and sequence name", () => {
    expect(resolveBurnInNameText({}, source(), clip)).toBe("Interview A");
    expect(resolveBurnInNameText({ nameSource: "file" }, source(), clip)).toBe("A001_C003.mov");
    expect(resolveBurnInNameText({ nameSource: "file", hideExtension: true }, source(), clip)).toBe("A001_C003");
    expect(resolveBurnInNameText({ nameSource: "sequence" }, source(), clip)).toBe("Main Sequence");
    expect(resolveBurnInNameText({ prefix: "SC4 - " }, source(), clip)).toBe("SC4 - Interview A");
  });

  it("a clip without media has no clip or file name", () => {
    expect(resolveBurnInNameText({}, source(), { id: "t" })).toBe("");
    expect(resolveBurnInNameText({ nameSource: "sequence" }, source(), { id: "t" })).toBe("Main Sequence");
  });
});

describe("params", () => {
  it("fills defaults and clamps ranges", () => {
    const p = resolveBurnInParams("burn-in-timecode", { size: 999, opacity: -5, position: "nowhere", textColor: "red", label: 3 });
    expect(p.size).toBe(30);
    expect(p.opacity).toBe(0);
    expect(p.position).toBe("bottom-center");
    expect(p.textColor).toBe("#ffffff");
    expect(p.label).toBe("");
  });

  it("every spec has a default that is inside its own range and option set", () => {
    for (const spec of Object.values(BURN_IN_SPECS)) {
      for (const param of spec.params) {
        if (param.kind === "number") expect(param.default).toBeGreaterThanOrEqual(param.min);
        if (param.kind === "number") expect(param.default).toBeLessThanOrEqual(param.max);
        if (param.kind === "select") expect(param.options.map((o) => o.value)).toContain(param.default);
      }
      expect(resolveBurnInParams(spec.type, BURN_IN_DEFAULTS[spec.type])).toEqual(BURN_IN_DEFAULTS[spec.type]);
    }
  });

  it("zero opacity is the neutral value", () => {
    expect(isBurnInNeutral("burn-in-name", { opacity: 0 })).toBe(true);
    expect(isBurnInNeutral("burn-in-name", {})).toBe(false);
  });

  it("new effects are seeded with visible defaults", () => {
    expect(getDefaultEffectParams("burn-in-timecode")).toEqual(BURN_IN_DEFAULTS["burn-in-timecode"]);
    expect(withEffectDefaults("burn-in-name", { prefix: "X" })).toMatchObject({ prefix: "X", nameSource: "clip", opacity: 100 });
  });
});

const effect = (type: string, params: Record<string, unknown> = {}): Effect => ({ id: `e-${type}`, type, params, enabled: true });

describe("sampling", () => {
  const clip = { id: "c1", mediaId: "m1", startTime: 4, inPoint: 0, effects: [effect("burn-in-timecode", { source: "sequence" })], keyframes: [] };

  it("getAnimatedVideoEffects resolves the text per frame and leaves other effects alone", () => {
    const withBlur = { ...clip, effects: [effect("blur", { radius: 2 }), ...clip.effects] };
    const [blur, burn] = getAnimatedVideoEffects(withBlur, 1, source());
    expect(blur.params).toEqual({ radius: 2 });
    expect(burn.params[BURN_IN_TEXT_PARAM]).toBe("01:00:04;29");
    expect(getAnimatedVideoEffects(withBlur, 2, source())[1].params[BURN_IN_TEXT_PARAM]).toBe("01:00:05;29");
  });

  it("is deterministic: the same instant gives the same text", () => {
    const a = getAnimatedVideoEffects(clip, 0.5, source())[0].params[BURN_IN_TEXT_PARAM];
    const b = getAnimatedVideoEffects(clip, 0.5, source())[0].params[BURN_IN_TEXT_PARAM];
    expect(a).toBe(b);
  });

  it("an effect with no source draws nothing (empty text) instead of inventing a value", () => {
    expect(getAnimatedVideoEffects(clip, 1)[0].params[BURN_IN_TEXT_PARAM]).toBe("");
  });

  it("burn-ins make a clip animated and are skipped at zero opacity", () => {
    expect(hasAnimatedVideoEffects(clip)).toBe(true);
    expect(hasBurnInEffects(clip)).toBe(true);
    const hidden = { ...clip, effects: [effect("burn-in-timecode", { opacity: 0 })] };
    expect(hasAnimatedVideoEffects(hidden)).toBe(false);
    expect(isRenderableVideoEffect(hidden.effects[0])).toBe(false);
    expect(isRenderableVideoEffect(clip.effects[0])).toBe(true);
  });

  it("withBurnInText returns the same array when there is no burn-in", () => {
    const effects = [effect("blur")];
    expect(withBurnInText(effects, clip, 0, source())).toBe(effects);
  });
});

describe("createBurnInSource", () => {
  const project = {
    name: "Project",
    settings: { frameRate: 25, startTimecode: "10:00:00:00" },
    mediaLibrary: {
      items: [
        { id: "m1", name: "Display Name", metadata: { frameRate: 24, startTimecodeText: "01:02:03:04" }, sourceFile: { name: "RAW_0001.MXF" } },
        { id: "m2", name: "Retimed", metadata: { frameRate: 24 }, interpretation: { frameRate: 23.976 } },
      ],
    },
    sequences: [{ id: "s1", name: "Rough Cut" }],
    activeSequenceId: "s1",
  };

  it("reads names, file names, frame rates and start timecodes from the project", () => {
    const s = createBurnInSource(project);
    expect(s.sequenceName).toBe("Rough Cut");
    expect(s.sequenceStartTimecode).toBe("10:00:00:00");
    expect(s.media("m1")).toMatchObject({ name: "Display Name", fileName: "RAW_0001.MXF", frameRate: 24, startTimecodeText: "01:02:03:04" });
    expect(s.media("m2")).toMatchObject({ fileName: "Retimed", frameRate: 23.976 });
    expect(s.media("nope")).toBeUndefined();
    expect(s.media(undefined)).toBeUndefined();
  });

  it("is cached per project object", () => {
    expect(createBurnInSource(project)).toBe(createBurnInSource(project));
  });

  it("falls back to the project name without sequences", () => {
    expect(createBurnInSource({ ...project, sequences: undefined }).sequenceName).toBe("Project");
  });
});

describe("export timecode overlay", () => {
  const project = {
    name: "P",
    settings: { frameRate: 29.97, startTimecode: "01:00:00;00" },
    mediaLibrary: { items: [{ id: "m1", name: "Cam", metadata: { frameRate: 25, startTimecodeText: "10:00:00:00" } }] },
    timeline: {
      tracks: [
        { type: "video", clips: [{ id: "top", mediaId: "m1", startTime: 2, duration: 5, inPoint: 1 }] },
        { type: "video", clips: [{ id: "bottom", mediaId: "m1", startTime: 0, duration: 10, inPoint: 0 }] },
      ],
    },
  };

  it("is null when off", () => {
    expect(timecodeBurnInOverlay(project, undefined, 1)).toBeNull();
    expect(timecodeBurnInOverlay(project, { enabled: false }, 1)).toBeNull();
  });

  it("draws the drop-frame sequence timecode at the frame time", () => {
    const at = (t: number) => timecodeBurnInOverlay(project, { enabled: true }, t)?.params[BURN_IN_TEXT_PARAM];
    expect(at(0)).toBe("01:00:00;00");
    // 30 frames of 29.97 fps last 1.001 s.
    expect(at(1.001)).toBe("01:00:01;00");
    expect(at(60.06)).toBe("01:01:00;02");
  });

  it("source mode shows the file timecode of the topmost clip, then falls back to the sequence in a gap", () => {
    const at = (t: number) => timecodeBurnInOverlay(project, { enabled: true, source: "source" }, t)?.params[BURN_IN_TEXT_PARAM];
    // top clip: starts at 2 s, in point 1 s -> 1 s into the clip = source second 2 of a 25 fps file.
    expect(at(3)).toBe("10:00:02:00");
    // bottom clip only: 8 s in.
    expect(at(8)).toBe("10:00:08:00");
    // Past both clips: the sequence timecode keeps counting (12 s = frame 359).
    expect(at(12)).toBe("01:00:11;29");
  });

  it("carries position, size, opacity and box into the drawn effect", () => {
    const overlay = timecodeBurnInOverlay(project, { enabled: true, position: "top-right", size: 8, opacity: 50, box: false }, 0);
    expect(overlay?.params).toMatchObject({ position: "top-right", size: 8, opacity: 50, box: false });
  });
});

interface Call { op: string; args: unknown[] }

/** Minimal Canvas2D recorder: text width is 0.6 em per character. */
function recorder() {
  const calls: Call[] = [];
  let font = "";
  const size = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  const ctx = {
    save: () => calls.push({ op: "save", args: [] }),
    restore: () => calls.push({ op: "restore", args: [] }),
    beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {},
    fill: () => calls.push({ op: "fill", args: [ctx.fillStyle] }),
    fillText: (text: string, x: number, y: number) => calls.push({ op: "fillText", args: [text, x, y, ctx.fillStyle] }),
    measureText: (text: string) => ({ width: text.length * size() * 0.6, actualBoundingBoxAscent: size() * 0.7, actualBoundingBoxDescent: size() * 0.2 }),
    set font(value: string) { font = value; },
    get font() { return font; },
    fillStyle: "", filter: "", globalAlpha: 1, globalCompositeOperation: "", textBaseline: "", textAlign: "",
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("drawBurnIn", () => {
  const draw = (type: "burn-in-timecode" | "burn-in-name", params: Record<string, unknown>, w = 1920, h = 1080) => {
    const r = recorder();
    const layout = drawBurnIn(r.ctx, type, params, w, h);
    return { ...r, layout };
  };

  it("draws nothing without text or at zero opacity", () => {
    expect(draw("burn-in-timecode", {}).layout).toBeNull();
    expect(draw("burn-in-timecode", { [BURN_IN_TEXT_PARAM]: "" }).calls).toHaveLength(0);
    expect(draw("burn-in-timecode", { [BURN_IN_TEXT_PARAM]: "00:00:00:00", opacity: 0 }).layout).toBeNull();
  });

  it("places timecode digits on a fixed advance, one glyph per cell", () => {
    const { calls } = draw("burn-in-timecode", { [BURN_IN_TEXT_PARAM]: "01:00:00;00" });
    const glyphs = calls.filter((c) => c.op === "fillText");
    expect(glyphs).toHaveLength(11);
    const fontSize = Math.round(0.05 * 1080);
    const cell = fontSize * 0.6;
    const xs = glyphs.map((g) => g.args[1] as number);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(cell, 6);
  });

  it("anchors by position with margin and padding", () => {
    const margin = Math.round(1080 * 0.03);
    const tl = draw("burn-in-timecode", { [BURN_IN_TEXT_PARAM]: "00:00:00:00", position: "top-left" }).layout!;
    expect(tl.x).toBe(margin);
    expect(tl.y).toBe(margin);
    const br = draw("burn-in-timecode", { [BURN_IN_TEXT_PARAM]: "00:00:00:00", position: "bottom-right" }).layout!;
    expect(br.x + br.width).toBe(1920 - margin);
    expect(br.y + br.height).toBe(1080 - margin);
    const c = draw("burn-in-timecode", { [BURN_IN_TEXT_PARAM]: "00:00:00:00", position: "center" }).layout!;
    expect(Math.abs(c.x + c.width / 2 - 960)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.y + c.height / 2 - 540)).toBeLessThanOrEqual(1);
    const bc = draw("burn-in-timecode", { [BURN_IN_TEXT_PARAM]: "00:00:00:00" }).layout!;
    expect(Math.abs(bc.x + bc.width / 2 - 960)).toBeLessThanOrEqual(1);
  });

  it("scales with the frame so preview and export agree", () => {
    const params = { [BURN_IN_TEXT_PARAM]: "00:00:00:00" };
    const hd = draw("burn-in-timecode", params, 1920, 1080).layout!;
    const uhd = draw("burn-in-timecode", params, 3840, 2160).layout!;
    expect(uhd.fontSize).toBe(hd.fontSize * 2);
    expect(Math.abs(uhd.width - hd.width * 2)).toBeLessThanOrEqual(2);
  });

  it("opacity multiplies into text and box alpha; the box can be switched off", () => {
    const withBox = draw("burn-in-timecode", { [BURN_IN_TEXT_PARAM]: "00:00:00:00", opacity: 50, boxOpacity: 100 });
    expect(withBox.calls.find((c) => c.op === "fill")?.args[0]).toBe("rgba(0,0,0,0.5)");
    expect(withBox.calls.find((c) => c.op === "fillText")?.args[3]).toBe("rgba(255,255,255,0.5)");
    const noBox = draw("burn-in-timecode", { [BURN_IN_TEXT_PARAM]: "00:00:00:00", box: false });
    expect(noBox.calls.some((c) => c.op === "fill")).toBe(false);
    expect(noBox.layout!.width).toBe(Math.round(noBox.calls.filter((c) => c.op === "fillText").length * Math.round(0.05 * 1080) * 0.6));
  });

  it("truncates a long name with an ellipsis inside the frame", () => {
    const long = "A very long clip name that cannot possibly fit on one line of a narrow frame ".repeat(3);
    const { layout, calls } = draw("burn-in-name", { [BURN_IN_TEXT_PARAM]: long }, 640, 360);
    const text = calls.find((c) => c.op === "fillText")!.args[0] as string;
    expect(text.endsWith("…")).toBe(true);
    expect(layout!.x + layout!.width).toBeLessThanOrEqual(640);
  });

  it("is deterministic", () => {
    const params = { [BURN_IN_TEXT_PARAM]: "01:00:00;00", position: "top-center" };
    expect(draw("burn-in-timecode", params).calls).toEqual(draw("burn-in-timecode", params).calls);
  });
});
