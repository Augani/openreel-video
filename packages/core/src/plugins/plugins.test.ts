// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLUGIN_VERSION_PARAM,
  PluginHost,
  PluginRegistry,
  assemblePluginShader,
  computeParamLayout,
  createStoredZip,
  describePluginEffect,
  generateParamsStruct,
  lintCpuSource,
  lintPluginShader,
  mapShaderDiagnostics,
  newPluginEffectParams,
  packPluginParams,
  parsePluginArchive,
  parsePluginPackage,
  pluginKeyframeChannels,
  pluginKeyframePropertyId,
  readZip,
  resolvePluginParams,
  samplePluginEffects,
  validatePluginManifest,
  PluginCpuSandbox,
  PluginSandboxError,
  FAILURE_TRIP_THRESHOLD,
  type LoadedPlugin,
  type PluginGpuBackend,
  type SandboxChannelFactory,
} from "./index";
import {
  getAnimatedVideoEffects,
  hasAnimatedVideoEffects,
  isRenderableVideoEffect,
} from "../video/animated-video-effects";
import { setPluginRegistryForTests } from "./registry";
import { ProjectSerializer } from "../storage/project-serializer";
import type { IStorageEngine } from "../storage/types";
import type { Clip, Effect, Keyframe } from "../types/timeline";
import type { Project } from "../types";

const EXAMPLES = path.resolve(__dirname, "../../../../examples/effect-plugins");

function loadExample(id: string): LoadedPlugin {
  const dir = path.join(EXAMPLES, id);
  const files = new Map<string, string>();
  for (const name of readdirSync(dir)) files.set(name, readFileSync(path.join(dir, name), "utf8"));
  const result = parsePluginPackage(files);
  if (!result.ok) throw new Error(`${id}: ${result.errors.join("; ")}`);
  return result.plugin;
}

const nodeChannelFactory: SandboxChannelFactory = (bootstrap) => {
  const worker = new Worker(bootstrap, { eval: true });
  return {
    post: (message, transfer) => worker.postMessage(message, transfer ?? []),
    onMessage: (cb) => worker.on("message", cb),
    onError: (cb) => worker.on("error", cb),
    terminate: () => void worker.terminate(),
  };
};

const baseManifest = {
  apiVersion: 1,
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  category: "Stylize",
  parameters: [{ key: "amount", type: "float", min: 0, max: 1, default: 0.5 }],
  cpu: { file: "cpu.js" },
};

const cpuPlugin = (source: string, extra: Record<string, unknown> = {}, id = "demo"): LoadedPlugin => {
  const result = validatePluginManifest({ ...baseManifest, id, ...extra });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return { manifest: result.manifest, cpu: source };
};

const frame = (w: number, h: number, fill: number[] = [100, 150, 200, 255]): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(fill, i * 4);
  return data;
};

const fakeCtx = (w: number, h: number, initial = frame(w, h)) => {
  const state = { data: initial };
  return {
    state,
    ctx: {
      canvas: {},
      getImageData: () => ({ data: state.data.slice() }),
      putImageData: (image: ImageData) => {
        state.data = image.data as Uint8ClampedArray;
      },
    },
  };
};

afterEach(() => setPluginRegistryForTests(null));

describe("manifest validation", () => {
  it("accepts the three shipped example plugins", () => {
    for (const id of ["film-grain", "chromatic-aberration-prism", "duotone-map"]) {
      expect(() => loadExample(id)).not.toThrow();
    }
    const grain = loadExample("film-grain");
    expect(grain.manifest.timeDriven).toBe(true);
    expect(grain.wgsl).toContain("fn effect(");
    expect(grain.cpu).toContain("function process(");
    expect(loadExample("duotone-map").wgsl).toBeUndefined();
    expect(loadExample("chromatic-aberration-prism").cpu).toBeUndefined();
  });

  it("normalises parameters (types, ranges, keyframable flags)", () => {
    const m = loadExample("chromatic-aberration-prism").manifest;
    const byKey = Object.fromEntries(m.parameters.map((p) => [p.key, p]));
    expect(byKey.amount).toMatchObject({ type: "float", min: 0, max: 60, keyframable: true });
    expect(byKey.angle.type).toBe("angle");
    expect(byKey.center).toMatchObject({ type: "point", default: { x: 0.5, y: 0.5 } });
    expect(byKey.channels).toMatchObject({ type: "choice", keyframable: false });
  });

  it.each([
    ["non-object", 5, /JSON object/],
    ["wrong apiVersion", { ...baseManifest, apiVersion: 2 }, /apiVersion/],
    ["bad id", { ...baseManifest, id: "Bad Id!" }, /id must match/],
    ["bad version", { ...baseManifest, version: "one" }, /semantic version/],
    ["bad category", { ...baseManifest, category: "Nope" }, /category/],
    ["no implementation", { ...baseManifest, cpu: undefined }, /shader.*cpu/],
    ["path traversal", { ...baseManifest, cpu: { file: "../evil.js" } }, /cpu\.file/],
    ["timeout range", { ...baseManifest, cpu: { file: "c.js", timeoutMs: 5 } }, /timeoutMs/],
    ["duplicate keys", { ...baseManifest, parameters: [baseManifest.parameters[0], baseManifest.parameters[0]] }, /duplicated/],
    ["reserved key", { ...baseManifest, parameters: [{ key: "orHost", type: "float", default: 0 }] }, /reserved/],
    ["wgsl keyword key", { ...baseManifest, parameters: [{ key: "var", type: "float", default: 0 }] }, /reserved/],
    ["default out of range", { ...baseManifest, parameters: [{ key: "a", type: "float", min: 0, max: 1, default: 5 }] }, /outside/],
    ["min >= max", { ...baseManifest, parameters: [{ key: "a", type: "float", min: 2, max: 1, default: 1 }] }, /min must be lower/],
    ["non-integer int default", { ...baseManifest, parameters: [{ key: "a", type: "int", min: 0, max: 9, default: 1.5 }] }, /integer/],
    ["bool keyframable", { ...baseManifest, parameters: [{ key: "a", type: "bool", default: true, keyframable: true }] }, /cannot be keyframed/],
    ["choice default", { ...baseManifest, parameters: [{ key: "a", type: "choice", default: "z", choices: [{ value: "a" }] }] }, /one of the choice/],
    ["colour format", { ...baseManifest, parameters: [{ key: "a", type: "color", default: "red" }] }, /#rrggbb/],
    ["point default", { ...baseManifest, parameters: [{ key: "a", type: "point", default: 1 }] }, /\{x, y\}/],
    ["unknown param type", { ...baseManifest, parameters: [{ key: "a", type: "vec9", default: 1 }] }, /type must be/],
    ["too many params", { ...baseManifest, parameters: Array.from({ length: 33 }, (_, i) => ({ key: `p${i}`, type: "float", default: 0 })) }, /at most 32/],
  ])("rejects %s", (_name, input, message) => {
    const result = validatePluginManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(message);
  });

  it("clamps and defaults stored parameter values", () => {
    const { manifest } = loadExample("chromatic-aberration-prism");
    const v = resolvePluginParams(manifest, { amount: 999, angle: "x", channels: "nope", center: { x: 0.2, y: 0.9 } });
    expect(v.amount).toBe(60);
    expect(v.angle).toBe(0);
    expect(v.channels).toBe("rb");
    expect(v.center).toEqual({ x: 0.2, y: 0.9 });
  });
});

describe("shader assembly and uniform layout", () => {
  it("lays params out with WGSL alignment and packs them", () => {
    const { manifest } = loadExample("chromatic-aberration-prism");
    const layout = computeParamLayout(manifest);
    const slot = Object.fromEntries(layout.slots.map((s) => [s.key, s]));
    expect(slot.amount.offset).toBe(0);
    expect(slot.angle.offset).toBe(4);
    expect(slot.center).toMatchObject({ wgslType: "vec2<f32>", offset: 8 });
    expect(slot.falloff.offset).toBe(16);
    expect(slot.channels).toMatchObject({ wgslType: "i32", offset: 20 });
    expect(layout.byteSize % 16).toBe(0);
    const buf = packPluginParams(manifest, layout, resolvePluginParams(manifest, { amount: 12, angle: 90, channels: "gb", center: { x: 0.25, y: 0.75 } }));
    const f = new Float32Array(buf);
    expect(f[0]).toBe(12);
    expect(f[1]).toBeCloseTo(Math.PI / 2, 5);
    expect([f[2], f[3]]).toEqual([0.25, 0.75]);
    expect(new Int32Array(buf)[5]).toBe(2);
    expect(generateParamsStruct(manifest)).toContain("center: vec2<f32>,");
  });

  it("aligns colours to 16 bytes and bools as u32", () => {
    const m = validatePluginManifest({
      ...baseManifest,
      parameters: [
        { key: "on", type: "bool", default: true },
        { key: "tint", type: "color", default: "#ff8000" },
      ],
    });
    if (!m.ok) throw new Error("manifest");
    const layout = computeParamLayout(m.manifest);
    expect(layout.slots[1]).toMatchObject({ wgslType: "vec4<f32>", offset: 16 });
    const buf = packPluginParams(m.manifest, layout, resolvePluginParams(m.manifest, {}));
    expect(new Uint32Array(buf)[0]).toBe(1);
    expect(new Float32Array(buf)[4]).toBeCloseTo(1, 5);
    expect(new Float32Array(buf)[5]).toBeCloseTo(128 / 255, 3);
  });

  it("wraps the plugin function and maps diagnostics to plugin lines", () => {
    const { manifest, wgsl } = loadExample("film-grain");
    const { code, lineOffset } = assemblePluginShader(manifest, wgsl!);
    expect(code).toContain("struct OrParams");
    expect(code).toContain("fn orFs(");
    const lines = code.split("\n");
    expect(lines[lineOffset]).toBe(wgsl!.split("\n")[0]);
    const mapped = mapShaderDiagnostics([{ type: "error", message: "bad", lineNum: lineOffset + 3, linePos: 5 }], lineOffset);
    expect(mapped[0]).toMatchObject({ line: 3, column: 5, type: "error" });
  });

  it.each([
    ["missing effect()", "fn other() {}", /fn effect/],
    ["own bindings", "@group(0) @binding(4) var<uniform> x: f32;\nfn effect(uv: vec2<f32>, src: vec4<f32>) -> vec4<f32> { return src; }", /@group|@binding/],
    ["own entry points", "@fragment fn f() {}\nfn effect(uv: vec2<f32>, src: vec4<f32>) -> vec4<f32> { return src; }", /entry points/],
    ["enable extension", "enable f16;\nfn effect(uv: vec2<f32>, src: vec4<f32>) -> vec4<f32> { return src; }", /enable/],
    ["empty", "", /empty/],
  ])("lint rejects %s", (_n, src, message) => {
    expect(lintPluginShader(src).join("\n")).toMatch(message);
  });

  it("lint accepts a minimal valid shader", () => {
    expect(lintPluginShader("fn effect(uv: vec2<f32>, src: vec4<f32>) -> vec4<f32> { return src; }")).toEqual([]);
  });
});

describe("package and zip", () => {
  const files = {
    "plugin.json": JSON.stringify(baseManifest),
    "cpu.js": "function process(frame, params) { frame.data[0] = 7; }",
  };

  it("round-trips a zip and parses the package, even inside a top-level folder", async () => {
    const zip = createStoredZip(files);
    expect([...(await readZip(zip)).keys()].sort()).toEqual(["cpu.js", "plugin.json"]);
    const direct = await parsePluginArchive(zip);
    expect(direct.ok).toBe(true);
    const nested = await parsePluginArchive(createStoredZip({ "demo/plugin.json": files["plugin.json"], "demo/cpu.js": files["cpu.js"], "__MACOSX/x": "junk" }));
    expect(nested.ok).toBe(true);
  });

  it("reports missing files and unparsable manifests", async () => {
    expect(parsePluginPackage(new Map([["plugin.json", JSON.stringify(baseManifest)]]))).toMatchObject({ ok: false });
    expect(parsePluginPackage(new Map([["plugin.json", "{nope"]]))).toMatchObject({ ok: false });
    expect(parsePluginPackage(new Map())).toMatchObject({ ok: false });
    const badZip = await parsePluginArchive(new Uint8Array([1, 2, 3, 4]));
    expect(badZip.ok).toBe(false);
  });

  it("rejects dangerous cpu source at install time", () => {
    for (const src of [
      "function process(f) { fetch('https://x') }",
      "function process(f) { return import('https://x') }",
      "function process(f) { (0).constructor.constructor('return 1')() }",
      "function process(f) { new WebSocket('wss://x') }",
      "function process(f) { eval('1') }",
      "function process(f) { self.postMessage(1) }",
    ]) {
      const result = parsePluginPackage(new Map([["plugin.json", JSON.stringify(baseManifest)], ["cpu.js", src]]));
      expect(result.ok, src).toBe(false);
    }
    expect(lintCpuSource("var x = 1;")).toContain('cpu source must define function process(frame, params, host)');
  });

  it("rejects a zip bomb from the central directory alone", async () => {
    const big = createStoredZip({ "plugin.json": "{}", "huge.bin": new Uint8Array(2 * 1024 * 1024) });
    const result = await parsePluginArchive(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/larger than/);
  });
});

describe("sandbox failure handling (real worker)", () => {
  it("runs process() on a copy and returns the edited pixels", async () => {
    const sandbox = new PluginCpuSandbox("function process(f, p) { for (var i = 0; i < f.data.length; i += 4) f.data[i] = p.amount * 100; }", nodeChannelFactory, 3000);
    const input = frame(2, 2);
    const out = await sandbox.run(input, 2, 2, { amount: 0.5 }, { time: 0, frame: 0 });
    expect(out[0]).toBe(50);
    expect(input[0]).toBe(100);
    sandbox.dispose();
  });

  it("surfaces a thrown error without killing the worker", async () => {
    const sandbox = new PluginCpuSandbox("function process(f) { if (f.data[0] === 100) throw new Error('boom'); }", nodeChannelFactory, 3000);
    await expect(sandbox.run(frame(1, 1), 1, 1, {}, { time: 0, frame: 0 })).rejects.toMatchObject({ kind: "error", message: "boom" });
    const ok = await sandbox.run(frame(1, 1, [1, 2, 3, 255]), 1, 1, {}, { time: 0, frame: 0 });
    expect(ok[0]).toBe(1);
    sandbox.dispose();
  });

  it("terminates a runaway plugin at the frame timeout and recovers on the next frame", async () => {
    const sandbox = new PluginCpuSandbox("function process(f) { if (f.data[0] === 100) { for (;;) {} } }", nodeChannelFactory, 300);
    const started = Date.now();
    await expect(sandbox.run(frame(1, 1), 1, 1, {}, { time: 0, frame: 0 })).rejects.toMatchObject({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(3000);
    const ok = await sandbox.run(frame(1, 1, [9, 9, 9, 255]), 1, 1, {}, { time: 0, frame: 0 });
    expect(ok[0]).toBe(9);
    sandbox.dispose();
  });

  it("rejects a bad return value and a source with no process()", async () => {
    const bad = new PluginCpuSandbox("function process(f) { return new Uint8ClampedArray(3); }", nodeChannelFactory, 3000);
    await expect(bad.run(frame(1, 1), 1, 1, {}, { time: 0, frame: 0 })).rejects.toBeInstanceOf(PluginSandboxError);
    bad.dispose();
    const none = new PluginCpuSandbox("var x = 1;", nodeChannelFactory, 3000);
    await expect(none.run(frame(1, 1), 1, 1, {}, { time: 0, frame: 0 })).rejects.toMatchObject({ kind: "error" });
    none.dispose();
  });

  it("has no network, storage or dynamic code entry points once the plugin loads", async () => {
    // Bypasses the install-time lint on purpose: this proves the runtime lock-down on its own.
    const source = `function process(f) {
      var probe = [typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof importScripts, typeof indexedDB,
        typeof require, typeof process_, typeof Worker, typeof WebAssembly, typeof eval];
      for (var i = 0; i < probe.length; i++) f.data[i] = probe[i] === 'undefined' ? 1 : 0;
      var ctor = 0;
      try { ctor = (function () {}).constructor === undefined ? 1 : 0; } catch (e) { ctor = 1; }
      f.data[probe.length] = ctor;
    }
    var process_;`;
    const sandbox = new PluginCpuSandbox(source, nodeChannelFactory, 3000);
    const out = await sandbox.run(frame(4, 4), 4, 4, {}, { time: 0, frame: 0 });
    expect(Array.from(out.slice(0, 11))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    sandbox.dispose();
  });
});

describe("plugin host", () => {
  const setup = (plugin: LoadedPlugin, gpu: PluginGpuBackend | null = null) => {
    const registry = new PluginRegistry();
    registry.register(plugin);
    const host = new PluginHost(registry, { gpu, channelFactory: nodeChannelFactory, gpuTimeoutMs: 500 });
    return { registry, host };
  };
  const effect = (id = "demo", params: Record<string, unknown> = {}) => ({ type: `plugin:${id}`, params });

  it("renders a CPU plugin onto the context", async () => {
    const { host, registry } = setup(cpuPlugin("function process(f, p) { for (var i = 0; i < f.data.length; i += 4) f.data[i] = p.amount * 255; }"));
    const { ctx, state } = fakeCtx(2, 2);
    const result = await host.applyToContext(ctx, effect("demo", { amount: 1 }), 2, 2);
    expect(result).toEqual({ applied: true, backend: "cpu" });
    expect(state.data[0]).toBe(255);
    expect(state.data[1]).toBe(150);
    expect(registry.getHealth("demo").state).toBe("ok");
    host.dispose();
  });

  it("bypasses (leaves the frame untouched) when the plugin throws, then trips after repeated failures", async () => {
    const { host, registry } = setup(cpuPlugin("function process(f) { throw new Error('nope'); }"));
    const { ctx, state } = fakeCtx(2, 2);
    const before = state.data.slice();
    for (let i = 0; i < FAILURE_TRIP_THRESHOLD; i++) {
      const r = await host.applyToContext(ctx, effect(), 2, 2);
      expect(r).toMatchObject({ applied: false, reason: "failed", error: "nope" });
      expect(Array.from(state.data)).toEqual(Array.from(before));
    }
    expect(registry.isBypassed("demo")).toBe(true);
    expect(await host.applyToContext(ctx, effect(), 2, 2)).toMatchObject({ applied: false, reason: "bypassed" });
    expect(isRenderableVideoEffect({ id: "e", type: "plugin:demo", enabled: true, params: {} } as Effect)).toBe(false);
    registry.resetHealth("demo");
    expect(registry.isBypassed("demo")).toBe(false);
    host.dispose();
  });

  it("falls back to the CPU implementation when the WGSL path fails, and records the shader error", async () => {
    const plugin = { ...cpuPlugin("function process(f) { f.data[0] = 42; }"), wgsl: "fn effect(uv: vec2<f32>, src: vec4<f32>) -> vec4<f32> { return src; }" };
    const gpu: PluginGpuBackend = {
      isAvailable: () => true,
      run: () => Promise.reject(new Error("WGSL compile error in shader.wgsl:\nline 3:5 unexpected token")),
    };
    const { host, registry } = setup(plugin, gpu);
    const { ctx, state } = fakeCtx(2, 2);
    expect(await host.applyToContext(ctx, effect(), 2, 2)).toEqual({ applied: true, backend: "cpu" });
    expect(state.data[0]).toBe(42);
    const health = registry.getHealth("demo");
    expect(health.state).toBe("degraded");
    expect(health.gpuError).toContain("line 3:5");
    host.dispose();
  });

  it("uses the GPU backend when it works and never touches the CPU worker", async () => {
    const plugin = { ...cpuPlugin("function process(f) { throw new Error('cpu must not run'); }"), wgsl: "fn effect(uv: vec2<f32>, src: vec4<f32>) -> vec4<f32> { return src; }" };
    const gpu: PluginGpuBackend = {
      isAvailable: () => true,
      run: (_p, _v, _s, w, h) => Promise.resolve(frame(w, h, [7, 7, 7, 255])),
    };
    const { host } = setup(plugin, gpu);
    const { ctx, state } = fakeCtx(2, 2);
    expect(await host.applyToContext(ctx, effect(), 2, 2)).toEqual({ applied: true, backend: "gpu" });
    expect(state.data[0]).toBe(7);
    host.dispose();
  });

  it("bypasses a WGSL-only plugin when WebGPU is missing", async () => {
    const plugin: LoadedPlugin = { manifest: { ...cpuPlugin("").manifest, cpu: undefined, shader: { file: "s.wgsl" } }, wgsl: "x" };
    const { host, registry } = setup(plugin, null);
    const { ctx, state } = fakeCtx(1, 1);
    const before = state.data.slice();
    const result = await host.applyToContext(ctx, effect(), 1, 1);
    expect(result).toMatchObject({ applied: false, reason: "failed" });
    expect(Array.from(state.data)).toEqual(Array.from(before));
    expect(registry.getHealth("demo").error).toMatch(/WebGPU/);
  });

  it("retry (resetHealth) re-enables a GPU path that failed earlier", async () => {
    const plugin: LoadedPlugin = { manifest: { ...cpuPlugin("").manifest, cpu: undefined, shader: { file: "s.wgsl" } }, wgsl: "x" };
    let broken = true;
    const gpu: PluginGpuBackend = {
      isAvailable: () => true,
      run: (_p, _v, _s, w, h) => (broken ? Promise.reject(new Error("device lost")) : Promise.resolve(frame(w, h, [9, 9, 9, 255]))),
    };
    const { host, registry } = setup(plugin, gpu);
    const { ctx, state } = fakeCtx(1, 1);
    expect(await host.applyToContext(ctx, effect(), 1, 1)).toMatchObject({ applied: false, reason: "failed" });
    broken = false;
    registry.resetHealth("demo");
    expect(await host.applyToContext(ctx, effect(), 1, 1)).toEqual({ applied: true, backend: "gpu" });
    expect(state.data[0]).toBe(9);
    host.dispose();
  });

  it("reports a missing plugin without failing", async () => {
    const { host } = setup(cpuPlugin("function process() {}"));
    const { ctx } = fakeCtx(1, 1);
    expect(await host.applyToContext(ctx, effect("gone"), 1, 1)).toEqual({ applied: false, reason: "missing" });
    expect(await host.applyToContext(ctx, { type: "blur", params: {} }, 1, 1)).toEqual({ applied: false, reason: "not-plugin" });
  });

  it("times out a runaway CPU plugin and bypasses", async () => {
    const plugin = cpuPlugin("function process(f) { for (;;) {} }", { cpu: { file: "cpu.js", timeoutMs: 100 } });
    const { host, registry } = setup(plugin);
    const { ctx, state } = fakeCtx(1, 1);
    const before = state.data.slice();
    const r = await host.applyToContext(ctx, effect(), 1, 1);
    expect(r).toMatchObject({ applied: false, reason: "failed" });
    expect(r.applied === false && r.error).toMatch(/frame budget/);
    expect(Array.from(state.data)).toEqual(Array.from(before));
    expect(registry.getHealth("demo").state).toBe("failed");
    host.dispose();
  }, 15_000);

  it("runs the shipped duotone example end to end", async () => {
    const duotone = loadExample("duotone-map");
    const { host } = setup(duotone);
    const { ctx, state } = fakeCtx(4, 4, frame(4, 4, [255, 255, 255, 255]));
    const params = newPluginEffectParams(duotone.manifest, { intensity: 1, highlights: "#ff0000", shadows: "#000000" });
    expect(await host.applyToContext(ctx, { type: "plugin:duotone-map", params }, 4, 4)).toEqual({ applied: true, backend: "cpu" });
    expect(Array.from(state.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    host.dispose();
  });
});

describe("keyframing plugin parameters", () => {
  const kf = (id: string, time: number, property: string, value: number, easing = "linear"): Keyframe =>
    ({ id, time, property, value, easing }) as Keyframe;

  const registryWith = (plugin: LoadedPlugin) => {
    const registry = new PluginRegistry();
    registry.register(plugin);
    setPluginRegistryForTests(registry);
    return registry;
  };

  it("exposes one channel per keyframable scalar", () => {
    const channels = pluginKeyframeChannels(loadExample("chromatic-aberration-prism").manifest).map((c) => c.id);
    expect(channels).toEqual([
      "effect.plugin:chromatic-aberration-prism.amount",
      "effect.plugin:chromatic-aberration-prism.angle",
      "effect.plugin:chromatic-aberration-prism.center.x",
      "effect.plugin:chromatic-aberration-prism.center.y",
      "effect.plugin:chromatic-aberration-prism.falloff",
    ]);
    expect(pluginKeyframeChannels(loadExample("duotone-map").manifest).map((c) => c.id)).toContain("effect.plugin:duotone-map.shadows.r");
  });

  it("interpolates a float parameter linearly and with easing, through the shared sampler", () => {
    const prism = loadExample("chromatic-aberration-prism");
    registryWith(prism);
    const effects: Effect[] = [{ id: "e1", type: "plugin:chromatic-aberration-prism", enabled: true, params: newPluginEffectParams(prism.manifest) }];
    const property = pluginKeyframePropertyId("chromatic-aberration-prism", "amount");
    const clip = { id: "c", effects, keyframes: [kf("a", 0, property, 0), kf("b", 2, property, 40)] };
    expect(hasAnimatedVideoEffects(clip)).toBe(true);
    expect(getAnimatedVideoEffects(clip, 0)[0].params.amount).toBe(0);
    expect(getAnimatedVideoEffects(clip, 1)[0].params.amount).toBeCloseTo(20, 6);
    expect(getAnimatedVideoEffects(clip, 2)[0].params.amount).toBe(40);
    expect(getAnimatedVideoEffects(clip, 9)[0].params.amount).toBe(40);
    // unkeyed parameters keep their stored value; the stored effect is not mutated
    expect(getAnimatedVideoEffects(clip, 1)[0].params.falloff).toBe(0.6);
    expect(effects[0].params.amount).toBe(8);
    const eased = { ...clip, keyframes: [kf("a", 0, property, 0, "ease-in"), kf("b", 2, property, 40)] };
    const mid = getAnimatedVideoEffects(eased, 1)[0].params.amount as number;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(20);
  });

  it("clamps to the declared range and interpolates points and colours per channel", () => {
    const prism = loadExample("chromatic-aberration-prism");
    const duo = loadExample("duotone-map");
    const registry = new PluginRegistry();
    registry.register(prism);
    registry.register(duo);
    setPluginRegistryForTests(registry);
    const effects: Effect[] = [
      { id: "p", type: "plugin:chromatic-aberration-prism", enabled: true, params: newPluginEffectParams(prism.manifest) },
      { id: "d", type: "plugin:duotone-map", enabled: true, params: newPluginEffectParams(duo.manifest, { shadows: "#000000" }) },
    ];
    const keyframes = [
      kf("1", 0, "effect.plugin:chromatic-aberration-prism.amount", 0),
      kf("2", 1, "effect.plugin:chromatic-aberration-prism.amount", 600),
      kf("3", 0, "effect.plugin:chromatic-aberration-prism.center.x", 0),
      kf("4", 2, "effect.plugin:chromatic-aberration-prism.center.x", 1),
      kf("5", 0, "effect.plugin:duotone-map.shadows.r", 0),
      kf("6", 2, "effect.plugin:duotone-map.shadows.r", 1),
    ];
    const sampled = getAnimatedVideoEffects({ id: "c", effects, keyframes }, 1);
    expect(sampled[0].params.amount).toBe(60);
    expect(sampled[0].params.center).toEqual({ x: 0.5, y: 0.5 });
    expect(sampled[1].params.shadows).toBe("#800000");
  });

  it("keyframes drive the first effect of a type only and never touch a missing plugin", () => {
    const prism = loadExample("chromatic-aberration-prism");
    registryWith(prism);
    const make = (id: string): Effect => ({ id, type: "plugin:chromatic-aberration-prism", enabled: true, params: newPluginEffectParams(prism.manifest) });
    const property = "effect.plugin:chromatic-aberration-prism.amount";
    const out = samplePluginEffects([make("a"), make("b")], [kf("1", 0, property, 30)] as never, 0);
    expect(out[0].params.amount).toBe(30);
    expect(out[1].params.amount).toBe(8);
    const ghost: Effect = { id: "g", type: "plugin:ghost", enabled: true, params: { x: 1 } };
    expect(samplePluginEffects([ghost], [kf("1", 0, "effect.plugin:ghost.x", 5)] as never, 0)[0]).toBe(ghost);
  });

  it("rounds int parameters and passes the clip-local time to time driven plugins", () => {
    const m = validatePluginManifest({
      ...baseManifest,
      id: "stepper",
      timeDriven: true,
      parameters: [{ key: "steps", type: "int", min: 0, max: 10, default: 2 }],
    });
    if (!m.ok) throw new Error("manifest");
    registryWith({ manifest: m.manifest, cpu: "function process() {}" });
    const effects: Effect[] = [{ id: "s", type: "plugin:stepper", enabled: true, params: newPluginEffectParams(m.manifest) }];
    const clip = { id: "c", effects, keyframes: [kf("1", 0, "effect.plugin:stepper.steps", 0), kf("2", 1, "effect.plugin:stepper.steps", 9)] };
    const out = getAnimatedVideoEffects(clip, 0.5)[0];
    expect(out.params.steps).toBe(5);
    expect(out.params.__time).toBe(0.5);
    expect(hasAnimatedVideoEffects({ effects })).toBe(true);
    expect(hasAnimatedVideoEffects({ effects: [{ ...effects[0], enabled: false }] })).toBe(false);
  });
});

describe("save and load", () => {
  const storage = {} as IStorageEngine;
  const makeProject = (effects: Effect[], keyframes: Keyframe[]): Project => ({
    id: "p",
    name: "Plugin project",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: {
      tracks: [
        {
          id: "t1",
          type: "video",
          name: "V1",
          clips: [
            {
              id: "c1",
              mediaId: "m1",
              trackId: "t1",
              startTime: 0,
              duration: 4,
              inPoint: 0,
              outPoint: 4,
              effects,
              audioEffects: [],
              transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
              volume: 1,
              keyframes,
            } as Clip,
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      duration: 4,
      markers: [],
    },
  }) as unknown as Project;

  it("keeps plugin id, version, parameters and keyframes through save/load, with and without the plugin installed", () => {
    const grain = loadExample("film-grain");
    const params = newPluginEffectParams(grain.manifest, { amount: 0.8, colored: true });
    expect(params[PLUGIN_VERSION_PARAM]).toBe("1.0.0");
    const effects: Effect[] = [{ id: "fx1", type: "plugin:film-grain", enabled: true, params }];
    const keyframes = [
      { id: "k1", time: 0, property: "effect.plugin:film-grain.amount", value: 0.1, easing: "linear" },
      { id: "k2", time: 2, property: "effect.plugin:film-grain.amount", value: 0.9, easing: "easeOut" },
    ] as Keyframe[];
    const serializer = new ProjectSerializer(storage);
    const json = serializer.exportToJson(makeProject(effects, keyframes));

    // Opening on a machine WITHOUT the plugin: nothing is dropped, the effect is a placeholder.
    setPluginRegistryForTests(new PluginRegistry());
    const missing = serializer.importFromJson(json);
    const clip = missing.timeline.tracks[0].clips[0];
    expect(clip.effects).toEqual(effects);
    expect(clip.keyframes).toEqual(keyframes);
    const status = describePluginEffect(clip.effects[0]);
    expect(status).toEqual({ kind: "missing", id: "film-grain", storedVersion: "1.0.0" });
    expect(isRenderableVideoEffect(clip.effects[0])).toBe(false);
    // Sampling leaves the placeholder's parameters exactly as saved.
    expect(getAnimatedVideoEffects(clip, 1)[0].params).toEqual(params);

    // Installing the plugin later resolves the same saved effect, parameters intact.
    const registry = new PluginRegistry();
    registry.register(grain);
    setPluginRegistryForTests(registry);
    const reopened = serializer.importFromJson(serializer.exportToJson(missing)).timeline.tracks[0].clips[0];
    expect(describePluginEffect(reopened.effects[0])?.kind).toBe("ok");
    expect(isRenderableVideoEffect(reopened.effects[0])).toBe(true);
    const at1 = getAnimatedVideoEffects(reopened, 1)[0];
    expect(at1.params.colored).toBe(true);
    expect(at1.params.amount as number).toBeGreaterThan(0.1);
    expect(at1.params.amount as number).toBeLessThan(0.9);
  });

  it("flags an installed plugin whose version differs from the saved one", () => {
    const grain = loadExample("film-grain");
    const registry = new PluginRegistry();
    registry.register({ ...grain, manifest: { ...grain.manifest, version: "2.0.0" } });
    const status = describePluginEffect({ type: "plugin:film-grain", params: { [PLUGIN_VERSION_PARAM]: "1.0.0" } }, registry);
    expect(status).toMatchObject({ kind: "version-mismatch", storedVersion: "1.0.0" });
  });
});

describe("registry", () => {
  it("installs, upgrades, uninstalls and notifies", async () => {
    const persisted = new Map<string, LoadedPlugin>();
    const registry = new PluginRegistry({
      list: async () => [...persisted.values()],
      put: async (p) => void persisted.set(p.manifest.id, p),
      remove: async (id) => void persisted.delete(id),
    });
    let notified = 0;
    registry.subscribe(() => notified++);
    const grain = loadExample("film-grain");
    await registry.install(grain);
    expect(registry.list().map((p) => p.manifest.id)).toEqual(["film-grain"]);
    expect(persisted.has("film-grain")).toBe(true);
    await registry.install({ ...grain, manifest: { ...grain.manifest, version: "1.1.0" } });
    expect(registry.get("film-grain")?.manifest.version).toBe("1.1.0");
    const fresh = new PluginRegistry({ list: async () => [...persisted.values()], put: async () => undefined, remove: async () => undefined });
    await fresh.hydrate();
    expect(fresh.get("film-grain")?.manifest.version).toBe("1.1.0");
    expect(await registry.uninstall("film-grain")).toBe(true);
    expect(registry.list()).toEqual([]);
    expect(persisted.size).toBe(0);
    expect(notified).toBeGreaterThanOrEqual(3);
  });
});
