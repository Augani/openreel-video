import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransitionEngine } from "./transition-engine";
import type { Transition } from "../types/timeline";
import { getMorphCutRegistry } from "./morph-cut/registry";
import { runMorphCutAnalysis } from "./morph-cut/analyse-job";
import { jumpCut, type FacePose } from "./morph-cut/synthetic-faces";
import { blendRGBA, type RGBAFrame } from "./time-interpolation/frame-blend";
import { psnr, renderScene, texture } from "./time-interpolation/synthetic-scenes";

/**
 * The Canvas2D TransitionEngine rendering Morph Cut against a small pixel-backed OffscreenCanvas: it is a cross
 * dissolve until the analysis is ready (or when it failed), then the warped morph, and always the live frames at
 * progress 0 and 1.
 */
const W = 192;
const H = 108;
const A: FacePose = { x: 0.5, y: 0.5, scale: 1, rotationDeg: 0, blink: 0 };
const B: FacePose = { x: 0.54, y: 0.53, scale: 1.08, rotationDeg: 6, blink: 0 };

class FakeCanvas {
  data: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    const self = this;
    const ctx = {
      globalAlpha: 1,
      clearRect() {
        self.data.fill(0);
      },
      drawImage(src: FakeCanvas | { width: number; height: number; data?: Uint8ClampedArray }) {
        const from = (src as FakeCanvas).data;
        if (!from) return;
        const a = ctx.globalAlpha;
        for (let i = 0; i < self.data.length && i < from.length; i++) self.data[i] = from[i] * a + self.data[i] * (1 - a);
      },
      getImageData(_x: number, _y: number, w: number, h: number) {
        return { width: w, height: h, data: new Uint8ClampedArray(self.data) };
      },
      putImageData(image: { data: Uint8ClampedArray }) {
        self.data.set(image.data);
      },
    };
    return ctx;
  }
}

const asSource = (f: RGBAFrame): FakeCanvas => {
  const c = new FakeCanvas(f.width, f.height);
  c.data.set(f.data);
  return c;
};

/** The engine reuses one output canvas, so a render is copied before the next one overwrites it. */
async function render(engine: TransitionEngine, a: unknown, b: unknown, t: Transition, progress: number): Promise<{ data: Uint8ClampedArray }> {
  const canvas = (await engine.renderTransitionToCanvas(a as CanvasImageSource, b as CanvasImageSource, t, progress)) as unknown as FakeCanvas;
  return { data: new Uint8ClampedArray(canvas.data) };
}

const transition = (id: string): Transition => ({ id, clipAId: "a", clipBId: "b", type: "morphCut", duration: 1, params: { curve: "linear" } });

describe("TransitionEngine: Morph Cut", () => {
  beforeEach(() => {
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
    getMorphCutRegistry().clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    getMorphCutRegistry().clear();
  });

  it("renders a cross dissolve until the analysis has finished, then the morph, and the live frames at the ends", async () => {
    const engine = new TransitionEngine({ width: W, height: H });
    const cut = jumpCut(W, H, A, B);
    const a = asSource(cut.a);
    const b = asSource(cut.b);
    const t = transition("morph-1");

    // not analysed: a cross dissolve
    const before = await render(engine, a, b, t, 0.5);
    expect(engine.lastMorphCutPath).toBe("dissolve");
    const plain = await render(engine, a, b, { ...t, type: "crossfade" }, 0.5);
    expect(Array.from(before.data)).toEqual(Array.from(plain.data));

    // analysed
    const analysis = await runMorphCutAnalysis({ transitionId: t.id, key: "k1", quality: "low", loadFrames: async () => ({ a: cut.a, b: cut.b }) });
    expect(analysis?.ok).toBe(true);
    const morph = await render(engine, a, b, t, 0.5);
    expect(engine.lastMorphCutPath).toBe("cpu");
    const truth = cut.truth(0.5);
    const morphDb = psnr(morph.data, truth.data);
    const dissolveDb = psnr(blendRGBA(cut.a, cut.b, 0.5), truth.data);
    console.log(`[morph-cut engine] midpoint vs analytic: morph ${morphDb.toFixed(2)} dB, dissolve ${dissolveDb.toFixed(2)} dB`);
    expect(morphDb).toBeGreaterThan(dissolveDb + 3);

    // the ends are the live frames (a cross dissolve of weight 0 / 1)
    const start = await render(engine, a, b, t, 0);
    const end = await render(engine, a, b, t, 1);
    expect(psnr(start.data, cut.a.data)).toBeGreaterThan(45);
    expect(psnr(end.data, cut.b.data)).toBeGreaterThan(45);
  });

  it("is deterministic: the same frame at the same progress is the same pixels (preview and export share this path)", async () => {
    const engine = new TransitionEngine({ width: W, height: H });
    const cut = jumpCut(W, H, A, B);
    const a = asSource(cut.a) as unknown as CanvasImageSource;
    const b = asSource(cut.b) as unknown as CanvasImageSource;
    const t = transition("morph-2");
    await runMorphCutAnalysis({ transitionId: t.id, key: "k2", quality: "low", loadFrames: async () => ({ a: cut.a, b: cut.b }) });
    const first = (await render(engine, a, b, t, 0.37)).data;
    const exportEngine = new TransitionEngine({ width: W, height: H });
    const second = (await render(exportEngine, a, b, t, 0.37)).data;
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it("honours the eased progress (the curve param) like every other transition", async () => {
    const engine = new TransitionEngine({ width: W, height: H });
    const cut = jumpCut(W, H, A, B);
    const a = asSource(cut.a) as unknown as CanvasImageSource;
    const b = asSource(cut.b) as unknown as CanvasImageSource;
    const t: Transition = { ...transition("morph-3"), params: { curve: "ease-in" } };
    await runMorphCutAnalysis({ transitionId: t.id, key: "k3", quality: "low", loadFrames: async () => ({ a: cut.a, b: cut.b }) });
    const out = (await render(engine, a, b, t, 0.5)).data;
    // ease-in at 0.5 is 0.25: closer to the outgoing frame than the incoming one
    expect(psnr(out, cut.truth(0.25).data)).toBeGreaterThan(psnr(out, cut.truth(0.5).data));
  });

  it("unrelated shots: the transition says so, and every frame stays a cross dissolve", async () => {
    const engine = new TransitionEngine({ width: W, height: H });
    const a = renderScene((x, y) => texture(x, y, 0.9), W, H, 0, 1);
    const b = renderScene((x, y) => texture(x * 1.7 + 40, y * 0.6, 7.7), W, H, 0, 1);
    const t = transition("morph-bad");
    await runMorphCutAnalysis({ transitionId: t.id, key: "kbad", quality: "low", loadFrames: async () => ({ a, b }) });
    expect(getMorphCutRegistry().getState(t.id)).toMatchObject({ status: "failed", message: "Morph Cut could not align these shots" });
    const out = (await render(engine, asSource(a), asSource(b), t, 0.5)).data;
    expect(engine.lastMorphCutPath).toBe("dissolve");
    const plain = (await render(engine, asSource(a), asSource(b), { ...t, type: "crossfade" }, 0.5)).data;
    expect(Array.from(out)).toEqual(Array.from(plain));
  });

  it("a field that does not match the frame's aspect ratio is not applied (cross dissolve, never a broken warp)", async () => {
    const wide = new TransitionEngine({ width: 160, height: 160 });
    const cut = jumpCut(W, H, A, B);
    const t = transition("morph-aspect");
    await runMorphCutAnalysis({ transitionId: t.id, key: "kaspect", quality: "low", loadFrames: async () => ({ a: cut.a, b: cut.b }) });
    const sq = new FakeCanvas(160, 160);
    await wide.renderTransitionToCanvas(sq as unknown as CanvasImageSource, sq as unknown as CanvasImageSource, t, 0.5);
    expect(wide.lastMorphCutPath).toBe("dissolve");
  });
});
