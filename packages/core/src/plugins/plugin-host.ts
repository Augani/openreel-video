/**
 * Sandboxed plugin host.
 *
 * Every plugin effect in the render stack goes through `applyToContext`, from
 * both the preview and the export path (VideoEffectsEngine owns the call), so
 * the two cannot diverge. A plugin can never crash a render:
 *
 *  - WGSL shaders are compiled/validated by the WebGPU backend; a compile or
 *    runtime error disables the GPU path of that plugin and surfaces the error
 *    (registry health + `lastError`);
 *  - CPU code runs in a Worker with no DOM/network, with a per-frame timeout;
 *  - when the GPU path is unusable the CPU fallback (if any) renders instead;
 *    when nothing works the effect is bypassed (the frame passes through);
 *  - after FAILURE_TRIP_THRESHOLD consecutive failed frames the plugin is
 *    bypassed without being run until it is reset or reinstalled.
 */

import {
  PLUGIN_TIME_PARAM,
  hexToRgb,
  resolvePluginParams,
  type PluginManifest,
  type ResolvedPluginParams,
} from "./manifest";
import {
  browserSandboxChannelFactory,
  DEFAULT_CPU_TIMEOUT_MS,
  PluginCpuSandbox,
  type SandboxChannelFactory,
} from "./cpu-sandbox";
import type { LoadedPlugin } from "./package";
import { createWebGpuPluginBackend } from "./webgpu-plugin-backend";
import { describePluginEffect, getPluginRegistry, type PluginRegistry } from "./registry";

export interface PluginFrameHost {
  readonly time: number;
  readonly frame: number;
}

/** GPU implementation behind a narrow seam so the host is testable without WebGPU. */
export interface PluginGpuBackend {
  isAvailable(): boolean;
  /** Compile-check a plugin shader; resolves the error text or null when valid. */
  validate?(plugin: LoadedPlugin): Promise<string | null>;
  /** Run the plugin shader over `source`; resolves straight RGBA of width*height*4 bytes. */
  run(
    plugin: LoadedPlugin,
    values: ResolvedPluginParams,
    source: unknown,
    width: number,
    height: number,
    host: PluginFrameHost,
    timeoutMs: number,
  ): Promise<Uint8ClampedArray>;
}

export interface PluginContext2D {
  readonly canvas: unknown;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  putImageData(data: ImageData, x: number, y: number): void;
}

export type PluginApplyResult =
  | { readonly applied: true; readonly backend: "gpu" | "cpu" }
  | { readonly applied: false; readonly reason: "not-plugin" | "missing" | "bypassed" | "failed"; readonly error?: string };

export interface PluginHostOptions {
  readonly gpu?: PluginGpuBackend | null;
  readonly channelFactory?: SandboxChannelFactory;
  readonly gpuTimeoutMs?: number;
}

interface PluginState {
  gpuFailed: boolean;
  resetEpoch: number;
  sandbox: PluginCpuSandbox | null;
}

export const GPU_FRAME_TIMEOUT_MS = 5_000;

/** Params as the CPU `process(frame, params, host)` sees them. */
export function toCpuParams(manifest: Pick<PluginManifest, "parameters">, values: ResolvedPluginParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of manifest.parameters) {
    const v = values[def.key];
    out[def.key] = def.type === "color" ? hexToRgb(v as string) : v;
  }
  return out;
}

function makeImageData(pixels: Uint8ClampedArray, width: number, height: number): ImageData {
  if (typeof ImageData !== "undefined") {
    return new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height);
  }
  return { data: pixels, width, height, colorSpace: "srgb" } as unknown as ImageData;
}

export class PluginHost {
  private readonly states = new WeakMap<LoadedPlugin, PluginState>();
  private readonly live = new Set<LoadedPlugin>();
  private gpu: PluginGpuBackend | null;
  private readonly channelFactory: SandboxChannelFactory;
  private readonly gpuTimeoutMs: number;
  /** Last error surfaced per plugin id, for the UI. */
  readonly lastError = new Map<string, string>();

  constructor(
    private readonly registry: PluginRegistry = getPluginRegistry(),
    options: PluginHostOptions = {},
  ) {
    this.gpu = options.gpu ?? null;
    this.channelFactory = options.channelFactory ?? browserSandboxChannelFactory;
    this.gpuTimeoutMs = options.gpuTimeoutMs ?? GPU_FRAME_TIMEOUT_MS;
    registry.subscribe(() => this.pruneReplaced());
  }

  setGpuBackend(gpu: PluginGpuBackend | null): void {
    this.gpu = gpu;
  }

  /**
   * Compile-check a plugin's WGSL on this machine's GPU (install-time
   * validation). Resolves null when valid or when there is no GPU to check on.
   */
  async validateShader(plugin: LoadedPlugin): Promise<string | null> {
    if (plugin.wgsl === undefined || !this.gpu?.isAvailable() || !this.gpu.validate) return null;
    return this.gpu.validate(plugin);
  }

  /** Dispose workers of plugins that were uninstalled or replaced by an upgrade. */
  private pruneReplaced(): void {
    for (const plugin of [...this.live]) {
      if (this.registry.get(plugin.manifest.id) === plugin) continue;
      this.states.get(plugin)?.sandbox?.dispose();
      this.states.delete(plugin);
      this.live.delete(plugin);
    }
  }

  private stateOf(plugin: LoadedPlugin): PluginState {
    let s = this.states.get(plugin);
    if (!s) {
      s = { gpuFailed: false, resetEpoch: this.registry.getResetEpoch(plugin.manifest.id), sandbox: null };
      this.states.set(plugin, s);
      this.live.add(plugin);
    }
    return s;
  }

  private fail(id: string, message: string): PluginApplyResult {
    this.lastError.set(id, message);
    this.registry.reportFailure(id, message);
    return { applied: false, reason: "failed", error: message };
  }

  /**
   * Render one plugin effect onto `ctx` in place. Never throws; on any
   * failure the context is left exactly as it was (the effect is bypassed).
   */
  async applyToContext(
    ctx: PluginContext2D,
    effect: { readonly type: string; readonly params: Readonly<Record<string, unknown>> },
    width: number,
    height: number,
  ): Promise<PluginApplyResult> {
    const status = describePluginEffect(effect, this.registry);
    if (!status) return { applied: false, reason: "not-plugin" };
    if (status.kind === "missing") return { applied: false, reason: "missing" };
    if (status.kind === "bypassed") return { applied: false, reason: "bypassed", error: status.error };

    const { plugin } = status;
    const { manifest } = plugin;
    const state = this.stateOf(plugin);
    const epoch = this.registry.getResetEpoch(manifest.id);
    if (state.resetEpoch !== epoch) {
      // The user asked to retry: forget the disabled GPU path and respawn the CPU worker.
      state.resetEpoch = epoch;
      state.gpuFailed = false;
      state.sandbox?.dispose();
      state.sandbox = null;
    }
    const values = resolvePluginParams(manifest, effect.params as Record<string, unknown>);
    const rawTime = effect.params[PLUGIN_TIME_PARAM];
    const time = typeof rawTime === "number" && Number.isFinite(rawTime) ? rawTime : 0;
    const host: PluginFrameHost = { time, frame: Math.floor(time * 30 + 1e-6) };

    if (plugin.wgsl !== undefined && !state.gpuFailed) {
      if (this.gpu?.isAvailable()) {
        try {
          const pixels = await this.gpu.run(plugin, values, ctx.canvas, width, height, host, this.gpuTimeoutMs);
          if (pixels.length !== width * height * 4) throw new Error("GPU readback returned the wrong size");
          ctx.putImageData(makeImageData(pixels, width, height), 0, 0);
          this.registry.reportSuccess(manifest.id);
          return { applied: true, backend: "gpu" };
        } catch (error) {
          state.gpuFailed = true;
          const message = (error as Error)?.message ?? String(error);
          this.lastError.set(manifest.id, message);
          if (plugin.cpu === undefined) return this.fail(manifest.id, message);
          this.registry.reportGpuFailure(manifest.id, message);
        }
      } else if (plugin.cpu === undefined) {
        return this.fail(manifest.id, "WebGPU is not available and the plugin has no CPU fallback");
      }
    }

    if (plugin.cpu === undefined) {
      return this.fail(manifest.id, "plugin has no usable implementation");
    }

    try {
      state.sandbox ??= new PluginCpuSandbox(
        plugin.cpu,
        this.channelFactory,
        manifest.cpu?.timeoutMs ?? DEFAULT_CPU_TIMEOUT_MS,
      );
      const source = ctx.getImageData(0, 0, width, height).data;
      const out = await state.sandbox.run(source, width, height, toCpuParams(manifest, values), host);
      if (out.length !== width * height * 4) throw new Error("plugin returned the wrong buffer size");
      ctx.putImageData(makeImageData(out, width, height), 0, 0);
      this.registry.reportSuccess(manifest.id);
      return { applied: true, backend: "cpu" };
    } catch (error) {
      return this.fail(manifest.id, (error as Error)?.message ?? String(error));
    }
  }

  /** Run only the CPU implementation on raw pixels (used by tests and tools). Throws on failure. */
  async runCpu(plugin: LoadedPlugin, values: ResolvedPluginParams, pixels: Uint8ClampedArray, width: number, height: number, host: PluginFrameHost): Promise<Uint8ClampedArray> {
    if (plugin.cpu === undefined) throw new Error("plugin has no CPU implementation");
    const state = this.stateOf(plugin);
    state.sandbox ??= new PluginCpuSandbox(plugin.cpu, this.channelFactory, plugin.manifest.cpu?.timeoutMs ?? DEFAULT_CPU_TIMEOUT_MS);
    return state.sandbox.run(pixels, width, height, toCpuParams(plugin.manifest, values), host);
  }

  dispose(): void {
    for (const plugin of this.live) this.states.get(plugin)?.sandbox?.dispose();
    this.live.clear();
  }
}

let sharedHost: PluginHost | null = null;

/** The process-wide host the effects engine renders through. */
export function getPluginHost(): PluginHost {
  return (sharedHost ??= new PluginHost(getPluginRegistry(), { gpu: createWebGpuPluginBackend() }));
}

export function setPluginHostForTests(host: PluginHost | null): void {
  sharedHost = host;
}
