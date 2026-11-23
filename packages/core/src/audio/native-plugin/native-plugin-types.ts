/**
 * Hosted native audio plugins (Audio Unit today, VST3 behind the same protocol), shared by the editor, the export and the
 * desktop main process. Everything here is plain data: the plugin itself only ever runs in the out-of-process helper.
 */

export type NativePluginFormat = "au" | "vst3";

/** One plugin as the scanner reports it. `id` is stable across machines for the same plugin ("au:aufx:dely:appl"). */
export interface NativePluginDescriptor {
  readonly id: string;
  readonly format: NativePluginFormat;
  readonly name: string;
  readonly vendor: string;
  readonly version?: string;
  readonly category?: string;
  readonly path?: string;
  readonly hasCustomView?: boolean;
  /**
   * ok: validated in the sandboxed scan and usable.
   * unsupported: found on disk but no host backend can load this format in this build.
   * blocked: crashed, hung or failed validation (see blocklist); not offered until the user unblocks it.
   */
  readonly status: "ok" | "unsupported" | "blocked";
  readonly statusReason?: string;
  readonly latencySamples?: number;
  readonly tailSeconds?: number;
  readonly parameterCount?: number;
}

export interface NativePluginParameter {
  /** Stable key within the plugin (the Audio Unit parameter address). */
  readonly key: string;
  readonly name: string;
  readonly identifier?: string;
  readonly min: number;
  readonly max: number;
  readonly value: number;
  readonly unitName?: string;
  readonly indexed?: boolean;
}

/** Block-rate automation lane: [sourceSeconds, value] breakpoints, linear between them, held outside. */
export type NativePluginLane = ReadonlyArray<readonly [number, number]>;

/** What one plugin instance on a clip needs to be rendered. Persisted (minus `automation`, which is baked from keyframes at render time). */
export interface NativePluginStep {
  readonly effectId: string;
  readonly pluginId: string;
  /** Opaque plugin state chunk (base64). Restored before `values` are applied. */
  readonly state?: string;
  readonly values: Readonly<Record<string, number>>;
  readonly automation: Readonly<Record<string, NativePluginLane>>;
}

export interface NativePluginRenderRequest {
  readonly pluginId: string;
  readonly state?: string;
  readonly values: Readonly<Record<string, number>>;
  readonly automation: Readonly<Record<string, NativePluginLane>>;
  readonly channels: readonly Float32Array[];
  readonly sampleRate: number;
}

export interface NativePluginRenderResult {
  /** Latency-compensated: same length and alignment as the input. */
  readonly channels: Float32Array[];
  readonly latencySamples: number;
}

export interface NativePluginCallOptions {
  readonly signal?: { readonly aborted: boolean };
  readonly onProgress?: (fraction: number) => void;
}

export interface NativePluginBackend {
  render(request: NativePluginRenderRequest, options?: NativePluginCallOptions): Promise<NativePluginRenderResult>;
}

/** The plugin is not installed, blocked, of a format no backend can load, or there is no host at all: the effect is bypassed and reported. */
export class NativePluginUnavailableError extends Error {
  constructor(readonly pluginId: string, message: string) {
    super(message);
    this.name = "NativePluginUnavailableError";
  }
}

/** The plugin is there but failed while rendering (crash, timeout, bad output): an export fails loudly instead of changing the audio. */
export class NativePluginRenderError extends Error {
  constructor(readonly pluginId: string, message: string) {
    super(message);
    this.name = "NativePluginRenderError";
  }
}

export class NativePluginCancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "NativePluginCancelledError";
  }
}
