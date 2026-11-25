/**
 * Web Audio side of the repair effects: loads the worklet module into a
 * context and builds one effect node (live preview, track/bus racks, clip
 * chains and offline mixdown all call `createRepairChainNode`, so all of them
 * run the same processor).
 */
import { LINKED_COMPRESSOR_DEFAULTS, isDspProcessorType, type DspProcessorType, type RepairParams } from "./repair-dsp";

const loading = new WeakMap<BaseAudioContext, Promise<boolean>>();
const loaded = new WeakSet<BaseAudioContext>();
const readyListeners = new WeakMap<BaseAudioContext, Set<() => void>>();

export const REPAIR_WORKLET_NAME = "openreel-repair";

export const isRepairWorkletReady = (ctx: BaseAudioContext): boolean => loaded.has(ctx);

/**
 * Loads the repair worklet into `ctx` (idempotent). Resolves false when the
 * context has no AudioWorklet (old browsers, node tests): repair effects then
 * pass audio through unchanged.
 */
export function ensureRepairWorklet(ctx: BaseAudioContext): Promise<boolean> {
  if (loaded.has(ctx)) return Promise.resolve(true);
  const existing = loading.get(ctx);
  if (existing) return existing;
  const worklet = (ctx as { audioWorklet?: { addModule(url: string): Promise<void> } }).audioWorklet;
  if (!worklet || typeof worklet.addModule !== "function") return Promise.resolve(false);
  const promise = import("./repair-worklet-url")
    .then((mod) => worklet.addModule(mod.default))
    .then(() => {
      loaded.add(ctx);
      const listeners = readyListeners.get(ctx);
      readyListeners.delete(ctx);
      listeners?.forEach((fn) => fn());
      return true;
    })
    .catch((error: unknown) => {
      loading.delete(ctx);
      console.warn("[audio-repair] could not load the repair worklet; repair effects are bypassed.", error);
      return false;
    });
  loading.set(ctx, promise);
  return promise;
}

const meters = new Map<string, number>();
const reductionSources = new Map<string, () => number>();

/**
 * Publishes a gain-reduction reader (dB, >= 0) under an effect id, e.g. a
 * DynamicsCompressorNode's `reduction`. Returns the unregister function.
 */
export function registerGainReductionSource(id: string, read: () => number): () => void {
  reductionSources.set(id, read);
  return () => {
    if (reductionSources.get(id) === read) reductionSources.delete(id);
  };
}

/** Latest gain reduction (dB) of the effect with this id (repair worklets and rack dynamics), 0 when none. */
export const getRepairMeter = (id: string): number => {
  const source = reductionSources.get(id);
  return source ? source() : (meters.get(id) ?? 0);
};

/** Keyed (sidechain) compressors expose these as AudioParams `p0`..`p5` of the worklet node, in this order. */
export const KEYED_COMPRESSOR_PARAM_KEYS = ["threshold", "ratio", "attack", "release", "knee", "makeupGain"] as const;

export interface RepairChainNode {
  readonly input: AudioNode;
  /** Keyed compressors only: connect the sidechain key signal here. */
  readonly keyInput?: AudioNode;
  /** Keyed compressors only: the automatable AudioParams by param key (null until the worklet node exists). */
  getParams?(): Record<string, AudioParam> | null;
  /** Keyed compressors only: called once the worklet node is attached (immediately when it already is). */
  onAttach?(fn: () => void): void;
  readonly output: AudioNode;
  /** All owned nodes (grows when the worklet attaches after loading). */
  readonly nodes: AudioNode[];
  update(params: RepairParams): void;
  dispose(): void;
}

export interface RepairChainOptions {
  /** Key under which the gain-reduction meter is published (usually the effect id). */
  readonly meterId?: string;
  /** Channels the node processes (default 2). Above 2 the channels are discrete and the processors link across all of them. */
  readonly channels?: number;
  /** A linked compressor with a sidechain key input (`keyInput`) and AudioParams for its dynamics settings. */
  readonly keyed?: boolean;
}

/**
 * One repair effect as a Web Audio node pair. If the worklet is not loaded yet
 * the effect passes audio through and switches on when loading finishes (live
 * contexts); offline renders await `ensureRepairWorklet` first so they never
 * start unprocessed.
 */
export function createRepairChainNode(
  ctx: BaseAudioContext,
  type: DspProcessorType,
  params: RepairParams,
  options: RepairChainOptions = {},
): RepairChainNode {
  const channels = Math.max(1, Math.floor(options.channels ?? 2));
  const input = ctx.createGain();
  const output = ctx.createGain();
  if (channels > 2) {
    for (const gain of [input, output]) {
      gain.channelCount = channels;
      gain.channelCountMode = "explicit";
      gain.channelInterpretation = "discrete";
    }
  }
  const nodes: AudioNode[] = [input, output];
  let node: AudioWorkletNode | null = null;
  let current = params;
  let disposed = false;
  const keyed = options.keyed === true && type === "linkedCompressor";
  const keyInput = keyed ? ctx.createGain() : undefined;
  if (keyInput) {
    nodes.push(keyInput);
    if (channels > 2) {
      keyInput.channelCount = channels;
      keyInput.channelCountMode = "explicit";
      keyInput.channelInterpretation = "discrete";
    }
  }
  const attachListeners = new Set<() => void>();
  const dynamicsValue = (key: (typeof KEYED_COMPRESSOR_PARAM_KEYS)[number], source: RepairParams): number => {
    const v = source[key];
    return typeof v === "number" && Number.isFinite(v) ? v : LINKED_COMPRESSOR_DEFAULTS[key];
  };
  input.connect(output);

  const attach = () => {
    if (disposed || node || !isDspProcessorType(type)) return;
    try {
      const parameterData: Record<string, number> = {};
      if (keyed) KEYED_COMPRESSOR_PARAM_KEYS.forEach((key, i) => (parameterData[`p${i}`] = dynamicsValue(key, current)));
      node = new AudioWorkletNode(ctx, REPAIR_WORKLET_NAME, {
        numberOfInputs: keyed ? 2 : 1,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
        channelCount: channels,
        channelCountMode: "explicit",
        channelInterpretation: channels > 2 ? "discrete" : "speakers",
        processorOptions: { type, params: { ...current, keyed: keyed ? 1 : 0 }, useParams: keyed },
        ...(keyed ? { parameterData } : {}),
      });
    } catch (error) {
      console.warn("[audio-repair] could not create the repair node.", error);
      return;
    }
    if (options.meterId) {
      const id = options.meterId;
      node.port.onmessage = (event: MessageEvent) => {
        const value = (event.data as { meter?: number } | undefined)?.meter;
        if (typeof value === "number") meters.set(id, value);
      };
    }
    input.disconnect(output);
    input.connect(node);
    keyInput?.connect(node, 0, 1);
    node.connect(output);
    nodes.push(node);
    attachListeners.forEach((fn) => fn());
  };

  if (isRepairWorkletReady(ctx)) {
    attach();
  } else {
    let listeners = readyListeners.get(ctx);
    if (!listeners) {
      listeners = new Set();
      readyListeners.set(ctx, listeners);
    }
    listeners.add(attach);
    void ensureRepairWorklet(ctx);
  }

  return {
    input,
    keyInput,
    output,
    nodes,
    getParams: keyed
      ? () => {
          if (!node) return null;
          const out: Record<string, AudioParam> = {};
          KEYED_COMPRESSOR_PARAM_KEYS.forEach((key, i) => {
            const param = node?.parameters.get(`p${i}`);
            if (param) out[key] = param;
          });
          return out;
        }
      : undefined,
    onAttach: keyed
      ? (fn) => {
          attachListeners.add(fn);
          if (node) fn();
        }
      : undefined,
    update(next) {
      current = next;
      if (keyed && node) {
        KEYED_COMPRESSOR_PARAM_KEYS.forEach((key, i) => {
          const param = node?.parameters.get(`p${i}`);
          if (param) param.value = dynamicsValue(key, next);
        });
      }
      node?.port.postMessage({ params: { ...next, keyed: keyed ? 1 : 0 } });
    },
    dispose() {
      disposed = true;
      attachListeners.clear();
      readyListeners.get(ctx)?.delete(attach);
      if (options.meterId) meters.delete(options.meterId);
      try {
        node?.port.postMessage({ dispose: true });
      } catch {
        /* node already gone */
      }
    },
  };
}
