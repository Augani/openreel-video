import { describe, expect, it } from "vitest";
import { resolveCanvasFitDimensions } from "../video/canvas-fit";
import {
  PIXEL_ASPECT_PRESETS,
  displaySizeFor,
  effectiveFieldOrder,
  effectivePixelAspect,
  frameConformFor,
  interpretedDisplaySize,
  normalizeInterpretation,
  validateInterpretation,
} from "./interpretation";
import { clipTouchedReason } from "../export/smart-render";
import type { Clip, MediaItem, Project } from "../types";

const meta = (extra: Record<string, unknown> = {}) =>
  ({ duration: 10, width: 1440, height: 1080, frameRate: 25, codec: "avc", sampleRate: 0, channels: 0, fileSize: 1, ...extra }) as MediaItem["metadata"];

describe("pixel aspect display size", () => {
  it("HDV 1440x1080 with PAR 4/3 displays as 1920x1080", () => {
    expect(displaySizeFor(1440, 1080, 4 / 3)).toEqual({ width: 1920, height: 1080 });
  });
  it("DV NTSC 720x480 (0.9091) displays as 654x480 and PAL 720x576 (1.0940) as 786x576", () => {
    expect(displaySizeFor(720, 480, 10 / 11)).toEqual({ width: 654, height: 480 });
    expect(displaySizeFor(720, 576, 59 / 54)).toEqual({ width: 786, height: 576 });
  });
  it("square pixels never change the size", () => {
    expect(displaySizeFor(1919, 1080, 1)).toEqual({ width: 1919, height: 1080 });
  });
  it("uses the container-reported SAR when there is no override, and the override wins", () => {
    const detected = { metadata: meta({ pixelAspectRatio: 4 / 3 }) };
    expect(effectivePixelAspect(detected)).toBeCloseTo(4 / 3);
    expect(interpretedDisplaySize(detected)).toEqual({ width: 1920, height: 1080 });
    const overridden = { metadata: meta({ pixelAspectRatio: 4 / 3 }), interpretation: { pixelAspectRatio: 1 } };
    expect(effectivePixelAspect(overridden)).toBe(1);
    expect(interpretedDisplaySize(overridden)).toEqual({ width: 1440, height: 1080 });
  });
  it("normalize keeps a square override on footage that reports a non-square SAR, and drops one equal to the file", () => {
    expect(normalizeInterpretation({ pixelAspectRatio: 1 }, { frameRate: 25, pixelAspectRatio: 4 / 3 })).toEqual({ pixelAspectRatio: 1 });
    expect(normalizeInterpretation({ pixelAspectRatio: 4 / 3 }, { frameRate: 25, pixelAspectRatio: 4 / 3 })).toBeUndefined();
    expect(normalizeInterpretation({ fieldOrder: "upper" }, { frameRate: 25, fieldOrder: "upper" })).toBeUndefined();
  });
  it("has the standard presets and validates deinterlace", () => {
    expect(PIXEL_ASPECT_PRESETS.some((p) => Math.abs(p.value - 4 / 3) < 1e-9)).toBe(true);
    expect(validateInterpretation({ deinterlace: "bob" })).toBeNull();
    expect(validateInterpretation({ deinterlace: "weave" as never })).not.toBeNull();
  });
});

describe("fit/fill math uses display dimensions", () => {
  it("an anamorphic 1440x1080 clip (PAR 4/3) fills a square 1920x1080 sequence exactly at Fit", () => {
    const display = displaySizeFor(1440, 1080, 4 / 3);
    expect(resolveCanvasFitDimensions("contain", display.width, display.height, 1920, 1080)).toEqual({ width: 1920, height: 1080 });
    // Without the PAR the same clip would be pillarboxed to 1440 wide: the old, wrong result.
    expect(resolveCanvasFitDimensions("contain", 1440, 1080, 1920, 1080).width).toBe(1440);
  });
  it("Fill of a 4:3 DV frame in a 16:9 sequence crops by display aspect", () => {
    const display = displaySizeFor(720, 480, 10 / 11);
    const fill = resolveCanvasFitDimensions("cover", display.width, display.height, 1920, 1080);
    expect(fill.width).toBe(1920);
    expect(fill.height).toBeCloseTo(1920 / (654 / 480), 5);
  });
});

describe("frameConformFor", () => {
  it("is null for legacy footage (no PAR, no field order) and for progressive with a deinterlace setting", () => {
    expect(frameConformFor({ metadata: meta() })).toBeNull();
    expect(frameConformFor({ metadata: meta(), interpretation: { deinterlace: "bob" } })).toBeNull();
    expect(frameConformFor({ metadata: meta(), interpretation: { frameRate: 24 } })).toBeNull();
  });
  it("describes PAR and field handling when present", () => {
    expect(frameConformFor({ metadata: meta({ pixelAspectRatio: 4 / 3 }) })).toEqual({ pixelAspect: 4 / 3, fieldOrder: "progressive", deinterlace: "none" });
    expect(frameConformFor({ metadata: meta({ fieldOrder: "lower" }) })).toEqual({ pixelAspect: 1, fieldOrder: "lower", deinterlace: "blend" });
    expect(frameConformFor({ metadata: meta(), interpretation: { fieldOrder: "upper", deinterlace: "none" } })).toBeNull();
    expect(effectiveFieldOrder({ metadata: meta({ fieldOrder: "lower" }), interpretation: { fieldOrder: "progressive" } })).toBe("progressive");
  });
});

describe("smart render does not stream-copy footage that needs PAR / field handling", () => {
  const clip = {
    id: "c1",
    mediaId: "m1",
    effects: [],
    keyframes: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } },
  } as unknown as Clip;
  const project = (item: Partial<MediaItem>, settings: Record<string, unknown> = {}) =>
    ({
      settings: { width: 1440, height: 1080, ...settings },
      mediaLibrary: { items: [{ id: "m1", type: "video", metadata: meta(), ...item }] },
    }) as unknown as Project;
  it("declines an anamorphic clip, an interlaced clip and a non-square sequence; accepts legacy footage", () => {
    expect(clipTouchedReason(project({}), clip)).toBeNull();
    expect(clipTouchedReason(project({ metadata: meta({ pixelAspectRatio: 4 / 3 }) }), clip)).toMatch(/pixel aspect/);
    expect(clipTouchedReason(project({ interpretation: { fieldOrder: "upper" } }), clip)).toMatch(/field order/);
    expect(clipTouchedReason(project({}, { pixelAspectRatio: 0.9091 }), clip)).toMatch(/sequence pixel aspect/);
  });
});
