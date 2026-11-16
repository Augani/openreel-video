import { describe, expect, it } from "vitest";
import type { Effect } from "../types/timeline";
import { VideoEffectsEngine } from "./video-effects-engine";
import { getDefaultEffectParams } from "./effect-defaults";

interface DrawCall {
  image: unknown;
  args: number[];
  filter: string;
  composite: string;
  alpha: number;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowColor: string;
}

/** Recording 2D context: logs every drawImage with the state it ran under. */
class RecordingContext {
  readonly canvas: { id: string };
  readonly draws: DrawCall[] = [];
  filter = "none";
  globalCompositeOperation = "source-over";
  globalAlpha = 1;
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  shadowColor = "rgba(0, 0, 0, 0)";
  fillStyle = "#000";
  fills = 0;

  constructor(
    id: string,
    private readonly alphaAt: (x: number, y: number) => number = () => 255,
  ) {
    this.canvas = { id };
  }

  save(): void {}
  restore(): void {}
  setTransform(): void {}
  clearRect(): void {}
  fillRect(): void {
    this.fills += 1;
  }
  getImageData(x: number, y: number) {
    return { data: [0, 0, 0, this.alphaAt(x, y)] };
  }
  drawImage(image: unknown, ...args: number[]): void {
    this.draws.push({
      image,
      args,
      filter: this.filter,
      composite: this.globalCompositeOperation,
      alpha: this.globalAlpha,
      shadowBlur: this.shadowBlur,
      shadowOffsetX: this.shadowOffsetX,
      shadowOffsetY: this.shadowOffsetY,
      shadowColor: this.shadowColor,
    });
  }
}

interface EngineHooks {
  applyEffectPixelLevel(
    ctx: unknown,
    effect: Effect,
    width: number,
    height: number,
  ): Promise<void>;
  getFxScratchContext: (width: number, height: number) => unknown;
}

function setup(alphaAt?: (x: number, y: number) => number) {
  const engine = new VideoEffectsEngine({ width: 100, height: 60, useGPU: false });
  const hooks = engine as unknown as EngineHooks;
  const main = new RecordingContext("main", alphaAt);
  const scratch = new RecordingContext("scratch");
  hooks.getFxScratchContext = () => scratch;
  const run = (type: string, params: Record<string, unknown>) =>
    hooks.applyEffectPixelLevel(
      main,
      { id: "e", type, enabled: true, params } as Effect,
      100,
      60,
    );
  return { main, scratch, run };
}

describe("drop shadow (pixel path)", () => {
  it("insets an opaque frame as a card so the shadow has room to show", async () => {
    const { main, run } = setup();
    await run("shadow", { offsetX: 8, offsetY: 8, blur: 12, opacity: 0.5, color: "#000000" });
    expect(main.draws).toHaveLength(1);
    const draw = main.draws[0]!;
    // margin = min(15% of the short side = 9, ceil(12 + 8) + 2) = 9
    expect(draw.args).toEqual([9, 9, 100 - 18, 60 - 18]);
    expect(draw.shadowBlur).toBe(12);
    expect(draw.shadowOffsetX).toBe(8);
    expect(draw.shadowOffsetY).toBe(8);
    expect(draw.shadowColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(draw.composite).toBe("source-over");
  });

  it("keeps a frame with transparency at full size", async () => {
    const { main, run } = setup((x, y) => (x === 0 && y === 0 ? 0 : 255));
    await run("shadow", { offsetX: 4, offsetY: 4, blur: 6, opacity: 1, color: "#000000" });
    expect(main.draws[0]!.args).toEqual([0, 0, 100, 60]);
  });

  it.each([
    ["no offset and no blur", { offsetX: 0, offsetY: 0, blur: 0 }],
    ["zero opacity", { offsetX: 4, offsetY: 4, blur: 4, opacity: 0 }],
    ["an empty param bag", {}],
  ])("is a no-op for %s", async (_name, params) => {
    const { main, run } = setup();
    await run("shadow", params);
    expect(main.draws).toHaveLength(0);
  });
});

describe("glow (pixel path)", () => {
  it("blurs a boosted copy and screen-blends it back in frame", async () => {
    const { main, scratch, run } = setup();
    await run("glow", { radius: 12, intensity: 1, color: "#ffffff" });
    expect(scratch.draws).toHaveLength(1);
    expect(scratch.draws[0]!.filter).toContain("blur(12px)");
    expect(scratch.fills).toBe(0);
    expect(main.draws).toHaveLength(1);
    expect(main.draws[0]!.composite).toBe("screen");
    expect(main.draws[0]!.alpha).toBeCloseTo(0.6);
  });

  it("tints non-white glow and caps the blend alpha at 1", async () => {
    const { main, scratch, run } = setup();
    await run("glow", { radius: 10, intensity: 3, color: "#ff8800" });
    expect(scratch.fills).toBe(1);
    expect(main.draws[0]!.alpha).toBe(1);
  });

  it.each([
    ["zero radius", { radius: 0, intensity: 1 }],
    ["zero intensity", { radius: 10, intensity: 0 }],
    ["an empty param bag", {}],
  ])("is a no-op for %s", async (_name, params) => {
    const { main, scratch, run } = setup();
    await run("glow", params);
    expect(main.draws).toHaveLength(0);
    expect(scratch.draws).toHaveLength(0);
  });
});

describe("legacy defaults reach the engine", () => {
  const engine = new VideoEffectsEngine({ width: 4, height: 4, useGPU: false });
  const css = (type: string, params: Record<string, unknown>) =>
    engine.getCssFilterString([{ id: "e", type, enabled: true, params } as Effect]);

  it.each(["brightness", "contrast", "saturation", "hue", "blur"])(
    "%s: seeded defaults yield a different CSS filter than an empty effect",
    (type) => {
      const defaults = getDefaultEffectParams(type)!;
      expect(css(type, defaults)).not.toBe(css(type, {}));
    },
  );

  it("glow and shadow are pixel-path effects, never a CSS drop-shadow no-op", () => {
    expect(css("glow", { radius: 12 })).toBeNull();
    expect(css("shadow", { offsetX: 8, offsetY: 8, blur: 12 })).toBeNull();
  });
});
