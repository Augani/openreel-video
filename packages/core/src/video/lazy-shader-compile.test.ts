import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColorGradingEngine } from "./color-grading-engine";
import { VideoEffectsEngine } from "./video-effects-engine";

/**
 * Editor warm-up must not pay a GPU round trip per shader program: programs are compiled on first
 * use. A counting fake WebGL2 context proves it (no real GPU needed).
 */
function makeFakeGl() {
  const counts = { compile: 0, link: 0, createProgram: 0 };
  const gl = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "compileShader") return () => { counts.compile++; };
        if (prop === "linkProgram") return () => { counts.link++; };
        if (prop === "createProgram") return () => { counts.createProgram++; return {}; };
        if (prop === "getShaderParameter" || prop === "getProgramParameter") return (_o: unknown, p: unknown) => (typeof p === "number" && p < 0 ? 0 : 1);
        if (prop === "ACTIVE_UNIFORMS" || prop === "ACTIVE_ATTRIBUTES") return -1;
        if (/^[A-Z_0-9]+$/.test(prop)) return 1;
        return () => ({});
      },
    },
  );
  return { gl, counts };
}

describe("lazy GPU shader compilation", () => {
  let fake: ReturnType<typeof makeFakeGl>;
  const RealOffscreen = globalThis.OffscreenCanvas;

  beforeEach(() => {
    fake = makeFakeGl();
    class FakeCanvas {
      constructor(public width: number, public height: number) {}
      getContext() { return fake.gl; }
    }
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (RealOffscreen) globalThis.OffscreenCanvas = RealOffscreen;
  });

  it("ColorGradingEngine.initialize compiles no shader program", () => {
    const engine = new ColorGradingEngine(64, 64);
    engine.initialize();
    expect(fake.counts.compile).toBe(0);
    expect(fake.counts.createProgram).toBe(0);
  });

  it("ColorGradingEngine compiles only the colour wheels program, once, on first use", async () => {
    const engine = new ColorGradingEngine(64, 64);
    const image = { width: 64, height: 64, close() {} } as unknown as ImageBitmap;
    const wheels = {
      shadows: { r: 0, g: 0, b: 0 },
      midtones: { r: 0, g: 0, b: 0 },
      highlights: { r: 0, g: 0, b: 0 },
    } as unknown as Parameters<ColorGradingEngine["applyColorWheels"]>[1];
    vi.stubGlobal("createImageBitmap", async () => image);
    await engine.applyColorWheels(image, wheels).catch(() => undefined);
    const first = fake.counts.createProgram;
    expect(first).toBe(1);
    expect(fake.counts.compile).toBe(2); // vertex + fragment of that one program
    await engine.applyColorWheels(image, wheels).catch(() => undefined);
    expect(fake.counts.createProgram).toBe(first);
  });

  it("VideoEffectsEngine's WebGL2 fallback compiles no shader until an effect needs one", async () => {
    const engine = new VideoEffectsEngine({ width: 64, height: 64, useGPU: true, preferWebGPU: false });
    await engine.initialize();
    expect(fake.counts.createProgram).toBe(0);
    expect(fake.counts.compile).toBe(0);
  });
});
