/**
 * Web Audio side of the creative effects: loads the worklet module into a context and builds one effect node.
 * Live preview, track/bus racks, clip chains and the offline mixdown all call `createCreativeFxNode`, so all of them
 * run the same processor. The module is imported on first use only (it is a separate chunk).
 */
import { CREATIVE_FX_CLOCK_SLOT, CREATIVE_FX_DEFINITIONS, creativeParamValues, isCreativeFxType, type CreativeFxType } from "./creative-fx-definitions";

export const CREATIVE_FX_WORKLET_NAME = "openreel-creative-fx";

const loading = new WeakMap<BaseAudioContext, Promise<boolean>>();
const loaded = new WeakSet<BaseAudioContext>();
const readyListeners = new WeakMap<BaseAudioContext, Set<() => void>>();

export const isCreativeFxWorkletReady = (ctx: BaseAudioContext): boolean => loaded.has(ctx);

/**
 * Loads the creative-effects worklet into `ctx` (idempotent). Resolves false when the context has no AudioWorklet
 * (old browsers, node tests): the effects then pass audio through unchanged.
 */
export function ensureCreativeFxWorklet(ctx: BaseAudioContext): Promise<boolean> {
  if (loaded.has(ctx)) return Promise.resolve(true);
  const existing = loading.get(ctx);
  if (existing) return existing;
  const worklet = (ctx as { audioWorklet?: { addModule(url: string): Promise<void> } }).audioWorklet;
  if (!worklet || typeof worklet.addModule !== "function") return Promise.resolve(false);
  const promise = import("./creative-fx-worklet-url")
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
      console.warn("[audio-creative-fx] could not load the worklet; creative effects are bypassed.", error);
      return false;
    });
  loading.set(ctx, promise);
  return promise;
}

export interface CreativeChainNode {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** All owned nodes (grows when the worklet attaches after loading). */
  readonly nodes: AudioNode[];
  /** The automatable AudioParams by param key; null until the worklet node exists. */
  getParams(): Record<string, AudioParam> | null;
  /** Called once the worklet node is attached (immediately when it already is). */
  onAttach(fn: () => void): void;
  update(params: Record<string, number | string | boolean>): void;
  /** Timeline clock: seconds to add to the context time to get timeline time (modulated effects anchor their LFO to it). */
  setClockOffset(seconds: number): void;
  dispose(): void;
}

export interface CreativeChainOptions {
  /** Channels the node processes (default 2). */
  readonly channels?: number;
}

/**
 * One creative effect as a Web Audio node pair. If the worklet is not loaded yet the effect passes audio through and
 * switches on when loading finishes (live contexts); offline renders await `ensureCreativeFxWorklet` first so they
 * never start unprocessed.
 */
export function createCreativeFxNode(
  ctx: BaseAudioContext,
  type: CreativeFxType,
  params: Record<string, number | string | boolean>,
  options: CreativeChainOptions = {},
): CreativeChainNode {
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
  const specs = CREATIVE_FX_DEFINITIONS[type].params;
  let node: AudioWorkletNode | null = null;
  let current = params;
  let clockOffset = 0;
  let disposed = false;
  const attachListeners = new Set<() => void>();
  input.connect(output);

  const attach = () => {
    if (disposed || node || !isCreativeFxType(type)) return;
    const values = creativeParamValues(type, current);
    const parameterData: Record<string, number> = { [`p${CREATIVE_FX_CLOCK_SLOT}`]: clockOffset };
    values.forEach((v, i) => {
      parameterData[`p${i}`] = v;
    });
    try {
      node = new AudioWorkletNode(ctx, CREATIVE_FX_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
        channelCount: channels,
        channelCountMode: "explicit",
        channelInterpretation: channels > 2 ? "discrete" : "speakers",
        processorOptions: { type, params: current },
        parameterData,
      });
    } catch (error) {
      console.warn("[audio-creative-fx] could not create the effect node.", error);
      return;
    }
    input.disconnect(output);
    input.connect(node);
    node.connect(output);
    nodes.push(node);
    attachListeners.forEach((fn) => fn());
  };

  if (isCreativeFxWorkletReady(ctx)) {
    attach();
  } else {
    let listeners = readyListeners.get(ctx);
    if (!listeners) {
      listeners = new Set();
      readyListeners.set(ctx, listeners);
    }
    listeners.add(attach);
    void ensureCreativeFxWorklet(ctx);
  }

  const paramMap = (): Record<string, AudioParam> | null => {
    if (!node) return null;
    const out: Record<string, AudioParam> = {};
    specs.forEach((spec, i) => {
      const param = node?.parameters.get(`p${i}`);
      if (param) out[spec.key] = param;
    });
    return out;
  };

  return {
    input,
    output,
    nodes,
    getParams: paramMap,
    onAttach(fn) {
      attachListeners.add(fn);
      if (node) fn();
    },
    update(next) {
      current = next;
      if (!node) return;
      const values = creativeParamValues(type, next);
      values.forEach((v, i) => {
        const param = node?.parameters.get(`p${i}`);
        if (param) param.value = v;
      });
    },
    setClockOffset(seconds) {
      clockOffset = Number.isFinite(seconds) ? seconds : 0;
      const param = node?.parameters.get(`p${CREATIVE_FX_CLOCK_SLOT}`);
      if (param) param.value = clockOffset;
    },
    dispose() {
      disposed = true;
      attachListeners.clear();
      readyListeners.get(ctx)?.delete(attach);
      try {
        node?.port.postMessage({ dispose: true });
      } catch {
        /* node already gone */
      }
    },
  };
}
