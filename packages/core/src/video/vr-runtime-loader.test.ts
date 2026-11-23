import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The VR runtime is a lazy chunk: these tests start from a module registry in which it has NOT been evaluated (the
 * package's vitest setup registers it for the other tests) and check what the render path relies on.
 */
async function fresh() {
  vi.resetModules();
  const loader = await import("./vr-runtime-loader");
  const pro = await import("./pro-effects");
  const shaders = await import("./pro-effect-shaders");
  return { loader, pro, shaders };
}

describe("lazy VR runtime", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("keeps the specs, defaults and neutral test available without the runtime", async () => {
    const { loader, pro } = await fresh();
    expect(loader.isVrRuntimeLoaded()).toBe(false);
    for (const type of ["vr-rotate-sphere", "vr-projection", "vr-blur", "vr-plane-to-sphere", "vr-sharpen", "vr-glow", "vr-chromatic-aberrations", "vr-digital-glitch", "vr-de-noise"] as const) {
      expect(pro.PRO_EFFECT_SPECS[type].params.length).toBeGreaterThan(0);
      expect(pro.isProEffectNeutral(type, pro.PRO_EFFECT_DEFAULTS[type])).toBe(true);
    }
    expect(loader.isVrRuntimeLoaded()).toBe(false);
  });

  it("never returns an unprocessed picture silently: synchronous VR entry points throw until the runtime is loaded", async () => {
    const { loader, pro, shaders } = await fresh();
    const pixels = new Uint8ClampedArray(8 * 4 * 4);
    const acting = pro.proEffectActingParams("vr-blur");
    expect(() => pro.applyProEffect("vr-blur", acting, pixels, 8, 4)).toThrow(loader.VrRuntimeNotLoadedError);
    expect(() => pro.proEffectGpuUniforms("vr-glow", pro.proEffectActingParams("vr-glow"), 4)).toThrow(loader.VrRuntimeNotLoadedError);
    expect(() => shaders.getProEffectShaderDef("vr-sharpen")).toThrow(loader.VrRuntimeNotLoadedError);
    // non-VR effects never need it
    expect(shaders.getProEffectShaderDef("mosaic").glsl.length).toBeGreaterThan(0);
    expect(loader.isVrRuntimeLoaded()).toBe(false);
  });

  it("loads on demand, once, and then every VR effect has GLSL, uniforms and a CPU path", async () => {
    const { loader, pro, shaders } = await fresh();
    const effects = [{ type: "mosaic" }, { type: "vr-glow" }];
    expect(loader.ensureVrRuntimeFor([{ type: "mosaic" }, { type: "exposure" }])).toBeUndefined();
    expect(loader.isVrRuntimeLoaded()).toBe(false);
    const first = loader.ensureVrRuntimeFor(effects);
    const second = loader.loadVrRuntime();
    expect(first).toBeInstanceOf(Promise);
    await first;
    expect(await second).toBe(loader.getVrRuntime());
    expect(loader.isVrRuntimeLoaded()).toBe(true);
    for (const type of loader.getVrRuntime() ? Object.keys(loader.getVrRuntime()!.glsl) : []) {
      const def = shaders.getProEffectShaderDef(type as never);
      expect(def.glsl).toContain("void main");
      const uniforms = pro.proEffectGpuUniforms(type as never, pro.proEffectActingParams(type as never), 64);
      for (const p of def.params) expect(uniforms[p.name], `${type}.${p.name}`).toBeTypeOf("number");
    }
    expect(Object.keys(loader.getVrRuntime()!.glsl).sort()).toEqual(
      ["vr-blur", "vr-chromatic-aberrations", "vr-de-noise", "vr-digital-glitch", "vr-glow", "vr-plane-to-sphere", "vr-projection", "vr-rotate-sphere", "vr-sharpen"],
    );
    // the CPU reference now runs and changes the picture
    const src = new Uint8ClampedArray(16 * 8 * 4).map((_, i) => (i * 37) % 251);
    const out = new Uint8ClampedArray(src);
    pro.applyProEffect("vr-rotate-sphere", pro.proEffectActingParams("vr-rotate-sphere"), out, 16, 8);
    expect(out).not.toEqual(src);
  });

  it("preloads when a project already holds a VR effect, and not otherwise", async () => {
    const { loader } = await fresh();
    loader.preloadVrRuntimeForProject({ timeline: { tracks: [{ clips: [{ effects: [{ type: "mosaic" }] }] }] } });
    expect(loader.isVrRuntimeLoaded()).toBe(false);
    loader.preloadVrRuntimeForProject({ timeline: { tracks: [{ clips: [{ effects: [{ type: "gaussian-blur" }, { type: "vr-de-noise" }] }] }] } });
    await loader.loadVrRuntime();
    expect(loader.isVrRuntimeLoaded()).toBe(true);
  });
});
