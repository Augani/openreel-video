import { describe, expect, it } from "vitest";
import {
  PRO_EFFECT_DEFAULTS,
  PRO_EFFECT_NEUTRAL_PARAMS,
  PRO_EFFECT_SPECS,
  applyProEffect,
  isProEffectNeutral,
  isProEffectType,
  parseProEffectKeyframeProperty,
} from "./pro-effects";
import { getDefaultEffectParams } from "./effect-defaults";
import { getAnimatedVideoEffects, isRenderableVideoEffect } from "./animated-video-effects";
import {
  ECHO_OPERATORS,
  MAX_ECHOES,
  clipHasTemporalEffects,
  compositeEchoReference,
  echoCompositeOrder,
  echoIntensity,
  echoSampleTime,
  findActiveEcho,
  isTemporalNeutral,
  planEcho,
  posterizeFrameIndex,
  posterizeTime,
  posterizedClipTime,
  resolveEcho,
  resolvePosterizeRate,
  type EchoOperator,
} from "./temporal-effects";

describe("Posterize Time frame math", () => {
  it("holds the start of each 1/fps interval", () => {
    expect(posterizeTime(0, 10)).toBe(0);
    expect(posterizeTime(0.099, 10)).toBe(0);
    expect(posterizeTime(0.1, 10)).toBeCloseTo(0.1, 12);
    expect(posterizeTime(0.37, 10)).toBeCloseTo(0.3, 12);
    expect(posterizeTime(1.999, 1)).toBe(1);
  });

  it("does not lose a frame to float error (0.3 * 10 = 3.0000000000000004, 0.7 * 10 = 7.000000000000001)", () => {
    expect(posterizeFrameIndex(0.3, 10)).toBe(3);
    expect(posterizeFrameIndex(0.7, 10)).toBe(7);
    expect(posterizeFrameIndex(0.1 + 0.2, 10)).toBe(3);
    // 29.97 fps timeline positions land on their own frame
    for (let n = 0; n < 600; n++) expect(posterizeFrameIndex(n / 24, 24)).toBe(n);
  });

  it("is idempotent and never moves time forward", () => {
    for (const fps of [1, 4, 8, 12, 23.976, 30, 120]) {
      for (let i = 0; i < 400; i++) {
        const t = i * 0.0371;
        const held = posterizeTime(t, fps);
        expect(held).toBeLessThanOrEqual(t + 1e-6);
        expect(t - held).toBeLessThan(1 / fps + 1e-9);
        expect(posterizeTime(held, fps)).toBeCloseTo(held, 9);
      }
    }
  });

  it("shows the same frame for every output frame inside one posterized frame", () => {
    const fps = 5;
    const shown = new Set<number>();
    for (let i = 0; i < 24; i++) shown.add(posterizeTime(0.4 + i / 120, fps));
    // 0.4 .. 0.6 spans exactly one posterized frame boundary (at 0.6 not reached)
    expect([...shown]).toEqual([0.4]);
  });

  it("is off for a zero rate and for non-finite input", () => {
    expect(posterizeTime(1.234, 0)).toBe(1.234);
    expect(posterizeTime(1.234, -3)).toBe(1.234);
    expect(posterizeTime(Number.NaN, 8)).toBeNaN();
    expect(posterizeTime(1.234, Number.NaN)).toBe(1.234);
  });

  it("applies the first enabled non-zero Posterize Time of a stack", () => {
    const effects = [
      { type: "posterize-time", enabled: false, params: { frameRate: 2 } },
      { type: "posterize-time", enabled: true, params: { frameRate: 0 } },
      { type: "posterize-time", enabled: true, params: { frameRate: 4 } },
      { type: "posterize-time", enabled: true, params: { frameRate: 1 } },
    ];
    expect(posterizedClipTime(effects, 0.6)).toBeCloseTo(0.5, 12);
    expect(posterizedClipTime([], 0.6)).toBe(0.6);
  });
});

describe("Echo frame times", () => {
  const echo = resolveEcho({ echoTime: 0.1, echoes: 3, startIntensity: 1, decay: 0.5, operator: "add" });

  it("samples t - k * echoTime", () => {
    expect(echoSampleTime(2, 1, 0.1)).toBeCloseTo(1.9, 12);
    expect(echoSampleTime(2, 3, 0.1)).toBeCloseTo(1.7, 12);
    expect(echoSampleTime(2, 2, -0.25)).toBeCloseTo(2.5, 12);
  });

  it("weights echo k by startIntensity * decay^k", () => {
    expect(echoIntensity(0, 0.8, 0.5)).toBeCloseTo(0.8, 12);
    expect(echoIntensity(1, 0.8, 0.5)).toBeCloseTo(0.4, 12);
    expect(echoIntensity(3, 0.8, 0.5)).toBeCloseTo(0.1, 12);
    expect(echoIntensity(5, 1, 0)).toBe(0);
  });

  it("plans the echo frames of a frame deterministically", () => {
    const plan = planEcho(2, 10, echo);
    expect(plan.map((s) => s.k)).toEqual([1, 2, 3]);
    expect(plan.map((s) => s.localTime)).toEqual([
      expect.closeTo(1.9, 9),
      expect.closeTo(1.8, 9),
      expect.closeTo(1.7, 9),
    ]);
    expect(plan.map((s) => s.weight)).toEqual([0.5, 0.25, 0.125]);
    expect(planEcho(2, 10, echo)).toEqual(plan);
  });

  it("depends only on the clip-local time, never on call order or history", () => {
    const a = planEcho(5.04, 10, echo);
    planEcho(1, 10, echo);
    planEcho(9.9, 10, echo);
    expect(planEcho(5.04, 10, echo)).toEqual(a);
  });

  it("drops echoes before the clip start and past its end", () => {
    const early = planEcho(0.15, 10, echo);
    expect(early.map((s) => s.k)).toEqual([1]);
    expect(planEcho(0, 10, echo)).toEqual([]);
    const future = resolveEcho({ echoTime: -0.5, echoes: 4, startIntensity: 1, decay: 0.5 });
    expect(planEcho(8.2, 10, future).map((s) => s.k)).toEqual([1, 2, 3]);
    expect(planEcho(9.9, 10, future)).toEqual([]);
  });

  it("keeps an echo that lands exactly on the first frame", () => {
    const plan = planEcho(0.3, 10, echo);
    expect(plan.map((s) => s.k)).toEqual([1, 2, 3]);
    expect(plan[2].localTime).toBeCloseTo(0, 9);
    expect(plan[2].localTime).toBeGreaterThanOrEqual(0);
  });

  it("drops zero-intensity echoes", () => {
    const flat = resolveEcho({ echoTime: 0.1, echoes: 4, startIntensity: 1, decay: 0 });
    expect(planEcho(2, 10, flat)).toEqual([]);
  });

  it("composites Composite in Front farthest-first so the nearest echo ends on top", () => {
    const front = resolveEcho({ echoTime: 0.1, echoes: 3, operator: "composite-front" });
    expect(planEcho(2, 10, front).map((s) => s.k)).toEqual([3, 2, 1]);
    expect(echoCompositeOrder([{ k: 2 }, { k: 1 }], "composite-back").map((s) => s.k)).toEqual([1, 2]);
  });
});

describe("parameter resolution", () => {
  it("clamps and rounds stored values", () => {
    const echo = resolveEcho({ echoTime: 99, echoes: 2.6, startIntensity: 7, decay: -1, operator: "nope" });
    expect(echo).toEqual({ echoTime: 2, echoes: 3, startIntensity: 1, decay: 0, operator: "add" });
    expect(resolveEcho({ echoes: 1e6 }).echoes).toBe(MAX_ECHOES);
    expect(resolveEcho({}).echoes).toBe(0);
  });

  it("reads the posterize rate", () => {
    expect(resolvePosterizeRate({ frameRate: 12 })).toBe(12);
    expect(resolvePosterizeRate({ frameRate: 1e6 })).toBe(120);
    expect(resolvePosterizeRate({})).toBe(0);
  });

  it("treats zero echoes / zero rate as the neutral no-op", () => {
    expect(isTemporalNeutral("echo", { echoes: 0 })).toBe(true);
    expect(isTemporalNeutral("echo", { echoes: 1 })).toBe(false);
    expect(isTemporalNeutral("posterize-time", { frameRate: 0 })).toBe(true);
    expect(isTemporalNeutral("posterize-time", { frameRate: 12 })).toBe(false);
  });

  it("finds the first active echo", () => {
    const effects = [
      { type: "blur", enabled: true, params: {} },
      { type: "echo", enabled: true, params: { echoes: 0 } },
      { type: "echo", enabled: false, params: { echoes: 3 } },
      { type: "echo", enabled: true, params: { echoes: 2, operator: "screen" } },
    ];
    const found = findActiveEcho(effects);
    expect(found?.index).toBe(3);
    expect(found?.echo.operator).toBe("screen");
    expect(findActiveEcho([])).toBeNull();
  });
});

describe("pro effect registration", () => {
  it("registers both effects as keyframable Time pro effects", () => {
    for (const type of ["echo", "posterize-time"] as const) {
      expect(isProEffectType(type)).toBe(true);
      expect(PRO_EFFECT_SPECS[type].category).toBe("Time");
      expect(isProEffectNeutral(type, PRO_EFFECT_NEUTRAL_PARAMS[type])).toBe(true);
      expect(isProEffectNeutral(type, PRO_EFFECT_DEFAULTS[type])).toBe(false);
      expect(getDefaultEffectParams(type)).toEqual(PRO_EFFECT_DEFAULTS[type]);
    }
    for (const key of ["echoTime", "echoes", "startIntensity", "decay"]) {
      expect(parseProEffectKeyframeProperty(`effect.echo.${key}`)).not.toBeNull();
    }
    expect(parseProEffectKeyframeProperty("effect.posterize-time.frameRate")).not.toBeNull();
    expect(parseProEffectKeyframeProperty("effect.echo.operator")).toBeNull();
  });

  it("exposes the six Premiere echo operators", () => {
    const options = PRO_EFFECT_SPECS.echo.params.find((p) => p.key === "operator")?.options ?? [];
    expect(options.map((o) => o.value)).toEqual([...ECHO_OPERATORS]);
  });

  it("is an identity in the per-pixel pass", () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255, 200, 100, 50, 128]);
    const before = [...data];
    expect(applyProEffect("echo", PRO_EFFECT_DEFAULTS.echo, data, 2, 1)).toBe(true);
    expect(applyProEffect("posterize-time", PRO_EFFECT_DEFAULTS["posterize-time"], data, 2, 1)).toBe(true);
    expect([...data]).toEqual(before);
  });

  it("renders only when not neutral", () => {
    expect(isRenderableVideoEffect({ id: "a", type: "echo", enabled: true, params: { echoes: 0 } })).toBe(false);
    expect(isRenderableVideoEffect({ id: "a", type: "echo", enabled: true, params: { echoes: 2 } })).toBe(true);
  });

  it("samples keyframed parameters at the clip-local time", () => {
    const clip = {
      id: "c",
      effects: [{ id: "e", type: "posterize-time", enabled: true, params: { frameRate: 12 } }],
      keyframes: [
        { id: "k1", time: 0, property: "effect.posterize-time.frameRate", value: 2, easing: "linear" },
        { id: "k2", time: 4, property: "effect.posterize-time.frameRate", value: 10, easing: "linear" },
      ],
    } as unknown as Parameters<typeof getAnimatedVideoEffects>[0];
    const at = (t: number) => getAnimatedVideoEffects(clip, t)[0].params.frameRate as number;
    expect(at(0)).toBeCloseTo(2, 6);
    expect(at(2)).toBeCloseTo(6, 6);
    expect(at(4)).toBeCloseTo(10, 6);
    // the held frame follows the rate at that frame
    expect(posterizedClipTime(getAnimatedVideoEffects(clip, 2), 2.4)).toBeCloseTo(2.333333, 5);
    expect(clipHasTemporalEffects(clip as never)).toBe(true);
    expect(clipHasTemporalEffects({ effects: [{ type: "blur", enabled: true }], keyframes: [] })).toBe(false);
  });
});

/** RGBA pixels from a list of [r, g, b, a] bytes. */
const px = (...p: number[][]) => new Uint8ClampedArray(p.flat());

describe("compositeEchoReference", () => {
  const base = px([200, 100, 40, 255], [10, 20, 30, 255]);
  const echoPx = px([100, 200, 255, 255], [250, 5, 30, 255]);
  const run = (operator: EchoOperator, weight: number, startIntensity = 1) =>
    [...compositeEchoReference(base, [{ data: echoPx, weight }], { operator, startIntensity })];

  it("is the identity with no echoes", () => {
    expect([...compositeEchoReference(base, [], { operator: "add", startIntensity: 1 })]).toEqual([...base]);
  });

  const near = (actual: number[], expected: number[]) => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(1));
  };

  it("Add sums weighted frames and clamps", () => {
    near(run("add", 0.5), [250, 200, 168, 255, 135, 22, 45, 255]);
    near(run("add", 1), [255, 255, 255, 255, 255, 25, 60, 255]);
  });

  it("Add scales the current frame by the starting intensity", () => {
    near(run("add", 0.5, 0.5), [150, 150, 148, 255, 130, 13, 30, 255]);
  });

  it("Maximum / Minimum / Screen mix the blend result by the echo weight", () => {
    near(run("maximum", 1), [200, 200, 255, 255, 250, 20, 30, 255]);
    near(run("minimum", 1), [100, 100, 40, 255, 10, 5, 30, 255]);
    near(run("screen", 1), [222, 222, 255, 255, 250, 25, 56, 255]);
    // half weight lerps between the base and the full blend
    near(run("maximum", 0.5), [200, 150, 148, 255, 130, 20, 30, 255]);
    near(run("screen", 0.5), [211, 161, 148, 255, 130, 22, 43, 255]);
    // the starting intensity dims the current frame for Maximum too, like Add
    near(run("maximum", 0.5, 0.5), [100, 125, 138, 255, 128, 10, 22, 255]);
  });

  it("Composite in Front puts the echo over the frame at its opacity", () => {
    near(run("composite-front", 0.25), [175, 125, 94, 255, 70, 16, 30, 255]);
    near(run("composite-front", 1), [100, 200, 255, 255, 250, 5, 30, 255]);
    // composites never dim the current frame by the starting intensity
    near(run("composite-front", 0.25, 0.1), [175, 125, 94, 255, 70, 16, 30, 255]);
  });

  it("Composite in Back only shows through transparent pixels of the frame", () => {
    expect(run("composite-back", 1)).toEqual([...base]);
    const hole = px([0, 0, 0, 0], [10, 20, 30, 128]);
    const out = compositeEchoReference(hole, [{ data: echoPx, weight: 0.5 }], {
      operator: "composite-back",
      startIntensity: 1,
    });
    // fully transparent pixel takes the echo at half opacity
    expect([...out.slice(0, 4)]).toEqual([100, 200, 255, 128]);
    // half-transparent pixel gains opacity: 0.502 + 0.5 * 0.498
    expect(Math.abs(out[7] - 191)).toBeLessThanOrEqual(1);
  });

  it("applies echoes in the given order for non-commutative operators", () => {
    const red = px([255, 0, 0, 255]);
    const blue = px([0, 0, 255, 255]);
    const none = px([0, 0, 0, 255]);
    const a = compositeEchoReference(none, [{ data: red, weight: 0.5 }, { data: blue, weight: 0.5 }], {
      operator: "composite-front",
      startIntensity: 1,
    });
    const b = compositeEchoReference(none, [{ data: blue, weight: 0.5 }, { data: red, weight: 0.5 }], {
      operator: "composite-front",
      startIntensity: 1,
    });
    expect([...a]).toEqual([64, 0, 128, 255]);
    expect([...b]).toEqual([128, 0, 64, 255]);
  });
});
