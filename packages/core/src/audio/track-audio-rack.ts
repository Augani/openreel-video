/**
 * Premiere-style Audio Track Mixer effect racks.
 *
 * One implementation drives both the live Web Audio graph (incremental
 * updates, click-free bypass) and the offline mixdown/export render, so the
 * same project renders the same samples in both paths. Everything that does
 * not need a Web Audio context (definitions, sanitising, tail estimates) is
 * pure and unit-tested in node.
 */
import type {
  AudioRack,
  AudioRackEffect,
  AudioRackEffectType,
  Effect,
  Project,
  Track,
} from "../types";
import { SURROUND_CHANNELS } from "./surround";
import { hasRackEffectAutomation, isAutomatableRackParam, sanitizeRackEffectAutomation, scheduleParamAutomation } from "./rack-effect-automation";
import { createLinkedCompressorStage, createMultichannelConvolver, needsMultichannelNodes, pinChannels } from "./multichannel-fx";
import { createNoiseReductionNodeChain } from "./audio-effects-engine";
import { REPAIR_EFFECT_DEFINITIONS, sanitizeRepairParams, repairWarmupSeconds } from "./repair/repair-definitions";
import { createRepairChainNode, registerGainReductionSource } from "./repair/repair-node";
import { isRepairEffectType as isRepairType, REPAIR_EFFECT_TYPES, type RepairEffectType } from "./repair/repair-dsp";
import {
  CREATIVE_FX_DEFINITIONS,
  CREATIVE_FX_TYPES,
  creativeFxTailSeconds,
  isCreativeFxType,
  sanitizeCreativeParams,
  type CreativeFxType,
} from "./creative/creative-fx-definitions";
import { createCreativeFxNode } from "./creative/creative-fx-node";
import { KEY_HPF_PARAM, KEY_SOURCE_PARAM, compressorKeySource, parseKeySource, type SidechainKeyHub } from "./sidechain";

/** Default number of effect slots in a rack (Premiere shows five; creative effects make longer chains normal). */
export const MAX_RACK_EFFECTS = 12;
/** Hard ceiling for `setMaxRackEffects`: every slot is a live node chain, so the cap stays bounded. */
export const RACK_EFFECTS_HARD_LIMIT = 32;
let configuredMaxRackEffects = MAX_RACK_EFFECTS;

/** Slots a rack may hold right now (default `MAX_RACK_EFFECTS`). */
export const getMaxRackEffects = (): number => configuredMaxRackEffects;

/** Makes the per-rack slot cap configurable (clamped to 1..RACK_EFFECTS_HARD_LIMIT). Returns the value applied. */
export function setMaxRackEffects(count: number): number {
  const next = Number.isFinite(count) ? Math.max(1, Math.min(RACK_EFFECTS_HARD_LIMIT, Math.floor(count))) : MAX_RACK_EFFECTS;
  configuredMaxRackEffects = next;
  return next;
}
export const RACK_MAX_VOLUME = 4;

export const AUDIO_RACK_EFFECT_TYPES: readonly AudioRackEffectType[] = [
  "gain",
  "eq",
  "compressor",
  "limiter",
  "reverb",
  "delay",
  "noiseReduction",
  ...REPAIR_EFFECT_TYPES,
  ...CREATIVE_FX_TYPES,
];

export interface RackParamSpec {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  readonly unit: string;
  /** Rendered as an on/off switch (value 0/1). */
  readonly toggle?: boolean;
  /** Value is an index into these labels (rendered as a select). */
  readonly options?: readonly string[];
}

export interface RackEffectDefinition {
  readonly type: AudioRackEffectType;
  readonly label: string;
  readonly params: readonly RackParamSpec[];
  /** True for the worklet-backed repair effects (DeHum, DeClick, DeClip, DeEss, DeReverb, Gate). */
  readonly repair?: boolean;
  /** True for the worklet-backed creative / utility effects (Chorus, Flanger, Phaser, Distortion, ...). */
  readonly creative?: boolean;
  /** One line shown under the effect name. */
  readonly description?: string;
}

const repairDefinitions = Object.fromEntries(
  REPAIR_EFFECT_TYPES.map((type) => {
    const def = REPAIR_EFFECT_DEFINITIONS[type];
    return [type, { type, label: def.label, params: def.params, repair: true } satisfies RackEffectDefinition];
  }),
) as Record<RepairEffectType, RackEffectDefinition>;

const creativeDefinitions = Object.fromEntries(
  CREATIVE_FX_TYPES.map((type) => {
    const def = CREATIVE_FX_DEFINITIONS[type];
    return [type, { type, label: def.label, params: def.params, creative: true, description: def.description } satisfies RackEffectDefinition];
  }),
) as Record<CreativeFxType, RackEffectDefinition>;

const p = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
  unit = "",
): RackParamSpec => ({ key, label, min, max, step, default: def, unit });

export const AUDIO_RACK_EFFECT_DEFINITIONS: Record<
  AudioRackEffectType,
  RackEffectDefinition
> = {
  gain: {
    type: "gain",
    label: "Gain",
    params: [p("gainDb", "Gain", -24, 24, 0.1, 0, "dB")],
  },
  eq: {
    type: "eq",
    label: "Parametric EQ",
    params: [
      p("lowGain", "Low (120 Hz)", -24, 24, 0.1, 0, "dB"),
      p("midGain", "Mid", -24, 24, 0.1, 0, "dB"),
      p("midFreq", "Mid frequency", 200, 8000, 10, 1000, "Hz"),
      p("midQ", "Mid Q", 0.1, 10, 0.05, 1),
      p("highGain", "High (6 kHz)", -24, 24, 0.1, 0, "dB"),
    ],
  },
  compressor: {
    type: "compressor",
    label: "Compressor",
    params: [
      p("threshold", "Threshold", -60, 0, 0.5, -24, "dB"),
      p("ratio", "Ratio", 1, 20, 0.1, 4, ":1"),
      p("attack", "Attack", 0.001, 1, 0.001, 0.003, "s"),
      p("release", "Release", 0.01, 3, 0.01, 0.25, "s"),
      p("knee", "Knee", 0, 40, 0.5, 30, "dB"),
      p("makeupGain", "Makeup gain", 0, 24, 0.1, 0, "dB"),
      p(KEY_HPF_PARAM, "Key high-pass", 20, 2000, 10, 20, "Hz"),
    ],
    description: "Pick a track or bus as the sidechain key and the compressor detects on it instead of its own signal.",
  },
  limiter: {
    type: "limiter",
    label: "Limiter",
    params: [
      p("ceiling", "Ceiling", -24, 0, 0.1, -1, "dB"),
      p("release", "Release", 0.01, 1, 0.01, 0.1, "s"),
    ],
  },
  reverb: {
    type: "reverb",
    label: "Reverb",
    params: [
      p("roomSize", "Room size", 0, 1, 0.01, 0.5),
      p("damping", "Damping", 0, 1, 0.01, 0.5),
      p("wetLevel", "Wet", 0, 1, 0.01, 0.3),
      p("dryLevel", "Dry", 0, 1, 0.01, 1),
    ],
  },
  delay: {
    type: "delay",
    label: "Delay",
    params: [
      p("time", "Time", 0, 2, 0.01, 0.3, "s"),
      p("feedback", "Feedback", 0, 0.95, 0.01, 0.3),
      p("wetLevel", "Wet", 0, 1, 0.01, 0.3),
    ],
  },
  noiseReduction: {
    type: "noiseReduction",
    label: "Noise Reduction",
    params: [
      p("threshold", "Threshold", -60, 0, 0.5, -40, "dB"),
      p("reduction", "Reduction", 0, 1, 0.01, 0.5),
      p("attack", "Attack", 0, 100, 1, 10, "ms"),
      p("release", "Release", 0, 500, 5, 100, "ms"),
    ],
  },
  ...repairDefinitions,
  ...creativeDefinitions,
};

const NOISE_FOCUS = new Set([
  "balanced",
  "speech",
  "whiteNoise",
  "music",
  "heavy",
  "wind",
  "hum",
]);

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export const isAudioRackEffectType = (
  value: unknown,
): value is AudioRackEffectType =>
  typeof value === "string" &&
  (AUDIO_RACK_EFFECT_TYPES as readonly string[]).includes(value);

export function defaultRackEffectParams(
  type: AudioRackEffectType,
): Record<string, number | string | boolean> {
  const params: Record<string, number | string | boolean> = {};
  for (const spec of AUDIO_RACK_EFFECT_DEFINITIONS[type].params) {
    params[spec.key] = spec.default;
  }
  if (type === "noiseReduction") params.focus = "balanced";
  return params;
}

/** Clamp every known param into range; unknown keys are dropped. */
export function sanitizeRackEffectParams(
  type: AudioRackEffectType,
  raw: Record<string, unknown> | undefined,
): Record<string, number | string | boolean> {
  if (isRepairType(type)) return sanitizeRepairParams(type, raw);
  if (isCreativeFxType(type)) return sanitizeCreativeParams(type, raw);
  const out = defaultRackEffectParams(type);
  for (const spec of AUDIO_RACK_EFFECT_DEFINITIONS[type].params) {
    const v = raw?.[spec.key];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[spec.key] = clamp(v, spec.min, spec.max);
    }
  }
  if (type === "noiseReduction") {
    const focus = raw?.focus;
    if (typeof focus === "string" && NOISE_FOCUS.has(focus)) out.focus = focus;
  }
  if (type === "compressor") {
    const key = raw?.[KEY_SOURCE_PARAM];
    if (typeof key === "string" && key.length <= 160 && parseKeySource(key)) out[KEY_SOURCE_PARAM] = key;
  }
  return out;
}

let rackIdCounter = 0;
export function createRackEffect(
  type: AudioRackEffectType,
  overrides?: {
    id?: string;
    params?: Record<string, unknown>;
    bypassed?: boolean;
  },
): AudioRackEffect {
  rackIdCounter += 1;
  return {
    id: overrides?.id ?? `rackfx-${Date.now().toString(36)}-${rackIdCounter}`,
    type,
    params: sanitizeRackEffectParams(type, overrides?.params),
    bypassed: overrides?.bypassed === true,
  };
}

/** Normalise an arbitrary stored rack. Returns undefined when it is empty/default. */
export function sanitizeAudioRack(raw: unknown): AudioRack | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<AudioRack>;
  const effects: AudioRackEffect[] = [];
  const seen = new Set<string>();
  if (Array.isArray(r.effects)) {
    for (const e of r.effects) {
      if (effects.length >= getMaxRackEffects()) break;
      if (!e || typeof e !== "object" || !isAudioRackEffectType(e.type)) continue;
      let id =
        typeof e.id === "string" && e.id.length > 0 ? e.id : createRackEffect(e.type).id;
      while (seen.has(id)) id = `${id}-${effects.length}`;
      seen.add(id);
      const automation = sanitizeRackEffectAutomation(e.type, e.automation, (key) => {
        const spec = AUDIO_RACK_EFFECT_DEFINITIONS[e.type].params.find((x) => x.key === key);
        return spec ? { min: spec.min, max: spec.max } : undefined;
      });
      effects.push({
        id,
        type: e.type,
        params: sanitizeRackEffectParams(
          e.type,
          e.params as Record<string, unknown> | undefined,
        ),
        bypassed: e.bypassed === true,
        ...(automation ? { automation } : {}),
      });
    }
  }
  const volume =
    typeof r.volume === "number" && Number.isFinite(r.volume)
      ? clamp(r.volume, 0, RACK_MAX_VOLUME)
      : undefined;
  const pan =
    typeof r.pan === "number" && Number.isFinite(r.pan)
      ? clamp(r.pan, -1, 1)
      : undefined;
  const rack: AudioRack = {
    effects,
    ...(volume !== undefined && volume !== 1 ? { volume } : {}),
    ...(pan !== undefined && pan !== 0 ? { pan } : {}),
  };
  return rack.effects.length === 0 && rack.volume === undefined && rack.pan === undefined
    ? undefined
    : rack;
}

export const rackVolume = (rack: AudioRack | undefined): number =>
  rack?.volume ?? 1;
export const rackPan = (rack: AudioRack | undefined): number => rack?.pan ?? 0;

export const rackHasProcessing = (rack: AudioRack | undefined): boolean =>
  !!rack && rack.effects.some((e) => !e.bypassed);

/** True when any non-bypassed effect carries param keyframes. */
export const rackHasAutomation = (rack: AudioRack | undefined): boolean =>
  !!rack && rack.effects.some((e) => !e.bypassed && hasRackEffectAutomation(e));

/** Migration: sanitise racks on load; old projects without racks are returned untouched. */
export function normalizeProjectAudioRacks(project: Project): Project {
  const timeline = project.timeline;
  const needsTracks = timeline.tracks.some((t) => t.audioRack !== undefined);
  if (!needsTracks && timeline.masterAudioRack === undefined) return project;
  const tracks = timeline.tracks.map((t): Track => {
    if (t.audioRack === undefined) return t;
    const { audioRack: _drop, ...rest } = t;
    void _drop;
    const rack = sanitizeAudioRack(t.audioRack);
    return rack ? { ...rest, audioRack: rack } : rest;
  });
  const { masterAudioRack: _m, ...timelineRest } = timeline;
  void _m;
  const master = sanitizeAudioRack(timeline.masterAudioRack);
  return {
    ...project,
    timeline: {
      ...timelineRest,
      tracks,
      ...(master ? { masterAudioRack: master } : {}),
    },
  };
}

/** Worst-case audible tail (seconds) a rack adds after its input stops. */
export function estimateRackTailSeconds(
  rack: AudioRack | undefined,
  sampleRate = 48000,
): number {
  if (!rack) return 0;
  let tail = 0;
  for (const fx of rack.effects) {
    if (fx.bypassed) continue;
    const q = fx.params;
    const n = (k: string, d: number) =>
      typeof q[k] === "number" ? (q[k] as number) : d;
    switch (fx.type) {
      case "reverb":
        if (n("wetLevel", 0.3) > 0) tail += 0.5 + n("roomSize", 0.5) * 3.5;
        break;
      case "delay":
        if (n("wetLevel", 0.3) > 0) {
          const fb = clamp(n("feedback", 0.3), 0, 0.95);
          const repeats = fb > 0 ? Math.ceil(Math.log(1e-8) / Math.log(fb)) : 1;
          tail += clamp(n("time", 0.3), 0, 2) * repeats;
        }
        break;
      case "compressor":
        tail += 18 * (n("attack", 0.003) + n("release", 0.25)) + 0.006;
        break;
      case "limiter":
        tail += 18 * (0.001 + n("release", 0.1)) + 0.006;
        break;
      case "eq":
        tail += 0.25;
        break;
      case "noiseReduction":
        tail += 1 + 8192 / sampleRate;
        break;
      case "deHum":
      case "deClick":
      case "deClip":
      case "deEss":
      case "deReverb":
      case "gate":
      case "brickwallLimiter":
      case "lowPass":
        tail += repairWarmupSeconds(fx.type) + 2048 / sampleRate;
        break;
      default:
        if (isCreativeFxType(fx.type)) tail += creativeFxTailSeconds(fx.type, fx.params);
        break;
    }
  }
  return tail;
}

/* ------------------------------------------------------------------ */
/* Web Audio construction (live + offline share this code)            */
/* ------------------------------------------------------------------ */

const dbToLinear = (db: number) => Math.pow(10, db / 20);
const identity = (value: number) => value;

/** Deterministic PRNG so live and offline reverbs use the same impulse. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAX_CACHED_IMPULSES = 6;
const impulseCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

export function getRackImpulseResponse(
  ctx: BaseAudioContext,
  roomSize: number,
  damping: number,
): AudioBuffer {
  let cache = impulseCache.get(ctx);
  if (!cache) {
    cache = new Map();
    impulseCache.set(ctx, cache);
  }
  const key = `${roomSize.toFixed(2)}_${damping.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rate = ctx.sampleRate;
  const duration = 0.5 + roomSize * 3.5;
  const length = Math.floor(rate * duration);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry32(0x5eed + ch * 977);
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const decay = Math.exp((-3 * t) / duration);
      data[i] = (rnd() * 2 - 1) * decay * (1 - (damping * t) / duration);
    }
  }
  // Dragging room size/damping visits many keys on a long-lived live context; keep only recent ones.
  while (cache.size >= MAX_CACHED_IMPULSES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(key, buffer);
  return buffer;
}

function setParam(
  param: AudioParam,
  value: number,
  ctx: BaseAudioContext,
  smooth: boolean,
): void {
  if (smooth && typeof param.setTargetAtTime === "function") {
    param.cancelScheduledValues?.(ctx.currentTime);
    param.setTargetAtTime(value, ctx.currentTime, 0.01);
  } else if (smooth && typeof param.setValueAtTime === "function") {
    param.setValueAtTime(value, ctx.currentTime);
  } else {
    param.value = value;
  }
}

interface EffectVoice {
  readonly input: AudioNode;
  readonly output: AudioNode;
  readonly nodes: AudioNode[];
  /** Apply new params in place. False means the voice must be rebuilt. */
  update(params: AudioRackEffect["params"], smooth: boolean): boolean;
  /** Optional teardown for voices that own worklet nodes. */
  dispose?(): void;
  /** Timeline clock for modulated effects: seconds to add to the context time to get timeline time. */
  setClockOffset?(seconds: number): void;
  /** Worklet-backed voices: called once the worklet node exists (its AudioParams then appear in `automatable`). */
  onReady?(fn: () => void): void;
  /** AudioParams that can carry keyframes, by param key; `toParam` maps the param's own unit to the AudioParam value. */
  readonly automatable?: Record<string, { readonly param: AudioParam; readonly toParam: (native: number) => number }>;
}

const num = (params: AudioRackEffect["params"], key: string, def: number) => {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : def;
};

function hardClipCurve(ceiling: number): Float32Array<ArrayBuffer> {
  const n = 16385;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = -1 + (2 * i) / (n - 1);
    curve[i] = Math.max(-ceiling, Math.min(ceiling, x));
  }
  return curve;
}

/** Compressor / limiter params in the linked worklet's vocabulary (the limiter is a 20:1 hard-knee compressor at its ceiling). */
function linkedDynamicsParams(fx: AudioRackEffect["type"], p: AudioRackEffect["params"]): Record<string, number> {
  if (fx === "limiter") {
    return { threshold: clamp(num(p, "ceiling", -1), -24, 0), knee: 0, ratio: 20, attack: 0.001, release: clamp(num(p, "release", 0.1), 0.01, 1), makeupGain: 0 };
  }
  return {
    threshold: clamp(num(p, "threshold", -24), -60, 0),
    ratio: clamp(num(p, "ratio", 4), 1, 20),
    attack: clamp(num(p, "attack", 0.003), 0.001, 1),
    release: clamp(num(p, "release", 0.25), 0.01, 3),
    knee: clamp(num(p, "knee", 30), 0, 40),
    makeupGain: clamp(num(p, "makeupGain", 0), 0, 24),
  };
}

/** Where a rack bus finds sidechain keys: the shared hub, and the id of the track/bus/master that owns the rack. */
export interface RackSidechain {
  readonly hub: SidechainKeyHub;
  readonly ownerId: string;
}

/** The sidechain key a compressor really listens to (configured and legal right now), or null. */
function resolveRackKey(fx: AudioRackEffect, sidechain: RackSidechain | undefined): string | null {
  if (fx.type !== "compressor" || !sidechain) return null;
  const key = compressorKeySource(fx.params);
  return key && sidechain.hub.isValidKey(sidechain.ownerId, key) ? key : null;
}

/** Keyed compressor params: the linked compressor's dynamics plus the key high-pass. */
function keyedCompressorParams(p: AudioRackEffect["params"]): Record<string, number> {
  return { ...linkedDynamicsParams("compressor", p), [KEY_HPF_PARAM]: clamp(num(p, KEY_HPF_PARAM, 20), 20, 2000) };
}

/**
 * A compressor that detects on a sidechain key (another track or bus) instead of its own signal. Runs the linked
 * worklet compressor (same 6 ms lookahead as the native node, so delay compensation is unchanged) with a second
 * input for the key; its dynamics settings are AudioParams, so keyframe automation reaches them like the native one.
 */
function createKeyedCompressorVoice(
  ctx: BaseAudioContext,
  fx: AudioRackEffect,
  channels: number,
  sidechain: RackSidechain,
  keySource: string,
): EffectVoice {
  const chain = createRepairChainNode(ctx, "linkedCompressor", keyedCompressorParams(fx.params), { channels, meterId: fx.id, keyed: true });
  const tap = sidechain.hub.tap(keySource);
  if (chain.keyInput) tap.connect(chain.keyInput);
  return {
    input: chain.input,
    output: chain.output,
    nodes: chain.nodes,
    onReady: (fn) => chain.onAttach?.(fn),
    get automatable() {
      const params = chain.getParams?.();
      if (!params) return undefined;
      return Object.fromEntries(Object.entries(params).map(([key, param]) => [key, { param, toParam: identity }]));
    },
    update(next) {
      if (compressorKeySource(next) !== keySource) return false;
      chain.update(keyedCompressorParams(next));
      return true;
    },
    dispose() {
      try {
        if (chain.keyInput) tap.disconnect(chain.keyInput);
      } catch {
        /* already disconnected */
      }
      chain.dispose();
    },
  };
}

/**
 * One effect as Web Audio nodes. `channels` is what flows through the rack: 2 for a stereo rack (the exact
 * nodes it always had), 6 in a 5.1 sequence, where dynamics and convolution run on all channels at once
 * (linked detector) instead of the stereo-only native nodes.
 */
function createVoice(
  ctx: BaseAudioContext,
  fx: AudioRackEffect,
  channels = 2,
  sidechain?: RackSidechain,
): EffectVoice {
  const params = fx.params;
  const multi = needsMultichannelNodes(channels);
  if (isCreativeFxType(fx.type)) return createCreativeVoice(ctx, fx.type, params, channels);
  // A key that is gone or would close a feedback loop is ignored: the compressor then detects on its own signal.
  const keySource = resolveRackKey(fx, sidechain);
  if (keySource && sidechain) return createKeyedCompressorVoice(ctx, fx, channels, sidechain, keySource);
  switch (fx.type) {
    case "gain": {
      const gain = pinChannels(ctx.createGain(), channels);
      gain.gain.value = dbToLinear(num(params, "gainDb", 0));
      return {
        input: gain,
        output: gain,
        nodes: [gain],
        automatable: { gainDb: { param: gain.gain, toParam: dbToLinear } },
        update(next, smooth) {
          setParam(gain.gain, dbToLinear(num(next, "gainDb", 0)), ctx, smooth);
          return true;
        },
      };
    }
    case "eq": {
      const low = pinChannels(ctx.createBiquadFilter(), channels);
      low.type = "lowshelf";
      low.frequency.value = 120;
      const mid = pinChannels(ctx.createBiquadFilter(), channels);
      mid.type = "peaking";
      const high = pinChannels(ctx.createBiquadFilter(), channels);
      high.type = "highshelf";
      high.frequency.value = 6000;
      const apply = (p2: AudioRackEffect["params"], smooth: boolean) => {
        setParam(low.gain, clamp(num(p2, "lowGain", 0), -24, 24), ctx, smooth);
        setParam(mid.gain, clamp(num(p2, "midGain", 0), -24, 24), ctx, smooth);
        setParam(mid.frequency, clamp(num(p2, "midFreq", 1000), 20, 20000), ctx, smooth);
        setParam(mid.Q, clamp(num(p2, "midQ", 1), 0.1, 18), ctx, smooth);
        setParam(high.gain, clamp(num(p2, "highGain", 0), -24, 24), ctx, smooth);
      };
      apply(params, false);
      low.connect(mid);
      mid.connect(high);
      return {
        input: low,
        output: high,
        nodes: [low, mid, high],
        automatable: {
          lowGain: { param: low.gain, toParam: identity },
          midGain: { param: mid.gain, toParam: identity },
          midFreq: { param: mid.frequency, toParam: identity },
          midQ: { param: mid.Q, toParam: identity },
          highGain: { param: high.gain, toParam: identity },
        },
        update(next, smooth) {
          apply(next, smooth);
          return true;
        },
      };
    }
    case "compressor":
    case "limiter": {
      if (multi) {
        const stage = createLinkedCompressorStage(ctx, linkedDynamicsParams(fx.type, params), { channels, meterId: fx.id });
        if (fx.type === "limiter") {
          const shaper = pinChannels(ctx.createWaveShaper(), channels);
          const setCeiling = (p2: AudioRackEffect["params"]) => {
            shaper.curve = hardClipCurve(dbToLinear(clamp(num(p2, "ceiling", -1), -24, 0)));
            shaper.oversample = "none";
          };
          setCeiling(params);
          stage.output.connect(shaper);
          return {
            input: stage.input,
            output: shaper,
            nodes: [...stage.nodes, shaper],
            update(next) {
              stage.update(linkedDynamicsParams("limiter", next));
              setCeiling(next);
              return true;
            },
            dispose: () => stage.dispose(),
          };
        }
        return {
          input: stage.input,
          output: stage.output,
          nodes: stage.nodes,
          update(next) {
            stage.update(linkedDynamicsParams("compressor", next));
            return true;
          },
          dispose: () => stage.dispose(),
        };
      }
      const comp = ctx.createDynamicsCompressor();
      const isLimiter = fx.type === "limiter";
      const makeup = ctx.createGain();
      const shaper = isLimiter ? ctx.createWaveShaper() : null;
      const apply = (p2: AudioRackEffect["params"], smooth: boolean) => {
        if (isLimiter) {
          const ceiling = clamp(num(p2, "ceiling", -1), -24, 0);
          setParam(comp.threshold, ceiling, ctx, smooth);
          setParam(comp.knee, 0, ctx, smooth);
          setParam(comp.ratio, 20, ctx, smooth);
          setParam(comp.attack, 0.001, ctx, smooth);
          setParam(comp.release, clamp(num(p2, "release", 0.1), 0.01, 1), ctx, smooth);
          if (shaper) {
            shaper.curve = hardClipCurve(dbToLinear(ceiling));
            shaper.oversample = "none";
          }
          makeup.gain.value = 1;
        } else {
          setParam(comp.threshold, clamp(num(p2, "threshold", -24), -60, 0), ctx, smooth);
          setParam(comp.ratio, clamp(num(p2, "ratio", 4), 1, 20), ctx, smooth);
          setParam(comp.attack, clamp(num(p2, "attack", 0.003), 0.001, 1), ctx, smooth);
          setParam(comp.release, clamp(num(p2, "release", 0.25), 0.01, 3), ctx, smooth);
          setParam(comp.knee, clamp(num(p2, "knee", 30), 0, 40), ctx, smooth);
          setParam(
            makeup.gain,
            dbToLinear(clamp(num(p2, "makeupGain", 0), 0, 24)),
            ctx,
            smooth,
          );
        }
      };
      apply(params, false);
      comp.connect(shaper ?? makeup);
      if (shaper) shaper.connect(makeup);
      // The compressor node reports how many dB it is currently pulling down (<= 0).
      const unregister = registerGainReductionSource(fx.id, () => {
        // Older engines expose `reduction` as an AudioParam; only a plain number is a reading.
        const reduction: unknown = comp.reduction;
        return typeof reduction === "number" && Number.isFinite(reduction) ? Math.max(0, -reduction) : 0;
      });
      return {
        input: comp,
        output: makeup,
        nodes: shaper ? [comp, shaper, makeup] : [comp, makeup],
        automatable: isLimiter
          ? undefined
          : {
              threshold: { param: comp.threshold, toParam: identity },
              ratio: { param: comp.ratio, toParam: identity },
              attack: { param: comp.attack, toParam: identity },
              release: { param: comp.release, toParam: identity },
              knee: { param: comp.knee, toParam: identity },
              makeupGain: { param: makeup.gain, toParam: dbToLinear },
            },
        update(next, smooth) {
          apply(next, smooth);
          return true;
        },
        dispose: unregister,
      };
    }
    case "reverb": {
      const input = pinChannels(ctx.createGain(), channels);
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const output = ctx.createGain();
      let room = num(params, "roomSize", 0.5);
      let damp = num(params, "damping", 0.5);
      const impulse = getRackImpulseResponse(ctx, room, damp);
      // A ConvolverNode carries two channels; surround racks use one mono convolver per channel.
      const multiConvolver = multi ? createMultichannelConvolver(ctx, impulse, channels) : null;
      const convolver = multiConvolver ? null : ctx.createConvolver();
      if (convolver) convolver.buffer = impulse;
      const wetIn: AudioNode = multiConvolver ? multiConvolver.input : convolver!;
      const wetOut: AudioNode = multiConvolver ? multiConvolver.output : convolver!;
      dry.gain.value = num(params, "dryLevel", 1);
      wet.gain.value = num(params, "wetLevel", 0.3);
      input.connect(dry);
      dry.connect(output);
      input.connect(wetIn);
      wetOut.connect(wet);
      wet.connect(output);
      const setImpulse = (buffer: AudioBuffer) => {
        if (multiConvolver) multiConvolver.setBuffer(buffer);
        else convolver!.buffer = buffer;
      };
      return {
        input,
        output,
        nodes: [input, dry, wet, ...(multiConvolver ? multiConvolver.nodes : [convolver!]), output],
        update(next, smooth) {
          const r = num(next, "roomSize", 0.5);
          const d = num(next, "damping", 0.5);
          if (r.toFixed(2) !== room.toFixed(2) || d.toFixed(2) !== damp.toFixed(2)) {
            room = r;
            damp = d;
            setImpulse(getRackImpulseResponse(ctx, r, d));
          }
          setParam(dry.gain, num(next, "dryLevel", 1), ctx, smooth);
          setParam(wet.gain, num(next, "wetLevel", 0.3), ctx, smooth);
          return true;
        },
      };
    }
    case "delay": {
      const input = pinChannels(ctx.createGain(), channels);
      const delay = pinChannels(ctx.createDelay(2), channels);
      const feedback = ctx.createGain();
      const wet = ctx.createGain();
      const dry = ctx.createGain();
      const output = ctx.createGain();
      const apply = (p2: AudioRackEffect["params"], smooth: boolean) => {
        const wetLevel = clamp(num(p2, "wetLevel", 0.3), 0, 1);
        setParam(delay.delayTime, clamp(num(p2, "time", 0.3), 0, 2), ctx, smooth);
        setParam(feedback.gain, clamp(num(p2, "feedback", 0.3), 0, 0.95), ctx, smooth);
        setParam(wet.gain, wetLevel, ctx, smooth);
        setParam(dry.gain, 1 - wetLevel, ctx, smooth);
      };
      apply(params, false);
      input.connect(dry);
      dry.connect(output);
      input.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(output);
      return {
        input,
        output,
        nodes: [input, delay, feedback, wet, dry, output],
        update(next, smooth) {
          apply(next, smooth);
          return true;
        },
      };
    }
    case "noiseReduction": {
      const effect: Effect = {
        id: fx.id,
        type: "noiseReduction",
        params: { ...params },
        enabled: true,
      };
      const chain = createNoiseReductionNodeChain(ctx, effect);
      return {
        input: chain.input,
        output: chain.output,
        nodes: chain.nodes,
        // Band filters/gates are built from the params; rebuild on change.
        update: () => false,
      };
    }
    case "deHum":
    case "deClick":
    case "deClip":
    case "deEss":
    case "deReverb":
    case "gate":
    case "brickwallLimiter":
    case "lowPass": {
      const chain = createRepairChainNode(ctx, fx.type, params, { meterId: fx.id, channels });
      return {
        input: chain.input,
        output: chain.output,
        nodes: chain.nodes,
        update(next) {
          chain.update(next);
          return true;
        },
        dispose: () => chain.dispose(),
      };
    }
  }
}

function createCreativeVoice(
  ctx: BaseAudioContext,
  type: CreativeFxType,
  params: AudioRackEffect["params"],
  channels: number,
): EffectVoice {
  const chain = createCreativeFxNode(ctx, type, { ...params }, { channels });
  return {
    input: chain.input,
    output: chain.output,
    nodes: chain.nodes,
    onReady: (fn) => chain.onAttach(fn),
    setClockOffset: (seconds) => chain.setClockOffset(seconds),
    get automatable() {
      const lanes = chain.getParams();
      if (!lanes) return undefined;
      const out: Record<string, { readonly param: AudioParam; readonly toParam: (native: number) => number }> = {};
      for (const [key, param] of Object.entries(lanes)) if (isAutomatableRackParam(type, key)) out[key] = { param, toParam: identity };
      return out;
    },
    update(next) {
      chain.update({ ...next });
      return true;
    },
    dispose: () => chain.dispose(),
  };
}

interface RackSlot {
  effect: AudioRackEffect;
  readonly input: GainNode;
  readonly dry: GainNode;
  readonly wet: GainNode;
  readonly output: GainNode;
  voice: EffectVoice | null;
  /** The sidechain key the current voice was built for (compressors), so a key change rebuilds it. */
  keyedWith: string | null;
  /** True once `output` has been connected downstream (so rewiring must disconnect it). */
  wired: boolean;
}

export interface AudioRackBusOptions {
  /** Live buses smooth every param/bypass change; offline renders set values directly. */
  readonly live: boolean;
  /**
   * 5.1 sequence: the bus carries six discrete channels. `createRackBus` then
   * builds one rack whose nodes are six-channel: EQ, gain and delay process every
   * channel, and compressor, limiter, repair effects and reverb run on all six
   * with a single linked detector (see multichannel-fx.ts).
   */
  readonly surround?: boolean;
  /** Channels carried by the bus (default 2). `createRackBus` sets 6 for surround. */
  readonly channels?: number;
  /** Sidechain keys for compressors in this rack (the hub shared by every rack of one graph, and the rack's owner id). */
  readonly sidechain?: RackSidechain;
}

/** What the mixer, routing graph and realtime graph need from a rack bus (stereo or 5.1). */
export interface RackBusLike {
  readonly input: AudioNode;
  readonly output: AudioNode;
  readonly tailSeconds: number;
  readonly rebuildCount: number;
  getSlotCount(): number;
  update(next: AudioRack | undefined): void;
  /** Place effect param keyframes: timeline `timelineStart` plays at context time `ctxStart` for `duration` seconds. */
  scheduleAutomation?(timelineStart: number, duration: number, ctxStart: number): void;
  /** Tell modulated effects (chorus, flanger, phaser) that timeline second `timelineStart` plays at context time `ctxStart`. */
  anchorTimeline?(timelineStart: number, ctxStart: number): void;
  stopAutomation?(): void;
  /** Drop every keyframe schedule and return the params to their static values (automation mode Off). */
  clearAutomation?(): void;
  dispose(): void;
}

/**
 * Ordered chain of up to five effect slots. Each slot is a dry/wet crossfade
 * around one effect voice, so bypass is a 10 ms gain ramp rather than a graph
 * rebuild, and parameter edits touch AudioParams in place. `update()` diffs the
 * previous rack against the next and only rewires when slots were added,
 * removed or reordered.
 */
export class AudioRackBus {
  readonly input: GainNode;
  readonly output: GainNode;
  private slots: RackSlot[] = [];
  private rack: AudioRack = { effects: [] };
  private inputWired = false;
  /** Where keyframed effect params play from (set by scheduleAutomation); automation is only placed once known. */
  private automationWindow: { timelineStart: number; duration: number; ctxStart: number } | null = null;
  /** Counts structural graph operations; tests use it to prove incrementality. */
  rebuildCount = 0;
  private readonly channels: number;

  constructor(
    private readonly ctx: BaseAudioContext,
    rack: AudioRack | undefined,
    private readonly options: AudioRackBusOptions,
  ) {
    this.channels = Math.max(1, Math.floor(options.channels ?? 2));
    this.input = pinChannels(ctx.createGain(), this.channels);
    this.output = pinChannels(ctx.createGain(), this.channels);
    this.update(rack);
  }

  get tailSeconds(): number {
    return estimateRackTailSeconds(this.rack, this.ctx.sampleRate);
  }

  getSlotCount(): number {
    return this.slots.length;
  }

  update(next: AudioRack | undefined): void {
    const rack = sanitizeAudioRack(next) ?? { effects: [] };
    const effects = rack.effects;
    const smooth = this.options.live;
    const bySlot = new Map(this.slots.map((s) => [s.effect.id, s]));
    const nextSlots: RackSlot[] = [];
    for (const fx of effects) {
      const existing = bySlot.get(fx.id);
      if (existing && existing.effect.type === fx.type) {
        bySlot.delete(fx.id);
        this.applySlot(existing, fx, smooth);
        nextSlots.push(existing);
      } else {
        nextSlots.push(this.createSlot(fx));
      }
    }
    for (const stale of bySlot.values()) this.disposeSlot(stale);
    const sameOrder =
      nextSlots.length === this.slots.length &&
      nextSlots.every((s, i) => s === this.slots[i]);
    this.slots = nextSlots;
    this.rack = rack;
    if (!sameOrder || this.rebuildCount === 0) this.rewire();
    if (this.automationWindow) this.applyAutomation();
  }

  /** Where the timeline clock of modulated effects points: seconds to add to context time (null until anchored). */
  private clockOffset: number | null = null;

  /**
   * Anchors the LFO of chorus / flanger / phaser to the timeline: timeline second `timelineStart` plays at context time
   * `ctxStart`. Live buses call this on play and seek, offline renders once with ctxStart 0 and the (pre-rolled) window
   * start, so preview and export modulate identically at every timeline position.
   */
  anchorTimeline(timelineStart: number, ctxStart: number): void {
    this.clockOffset = timelineStart - ctxStart;
    for (const slot of this.slots) slot.voice?.setClockOffset?.(this.clockOffset);
  }

  /**
   * Places the keyframes of every effect param: timeline second `timelineStart` plays at context time `ctxStart`
   * for `duration` seconds. Live buses call this on play, seek and lane edits; offline renders once with ctxStart 0.
   */
  scheduleAutomation(timelineStart: number, duration: number, ctxStart: number): void {
    this.automationWindow = { timelineStart, duration, ctxStart };
    this.applyAutomation();
  }

  /** Forget the playing window (pause/stop): later rack edits keep the static values instead of re-playing the lanes. */
  stopAutomation(): void {
    this.automationWindow = null;
  }

  clearAutomation(): void {
    this.automationWindow = null;
    const now = this.ctx.currentTime;
    for (const slot of this.slots) {
      for (const [key, target] of Object.entries(slot.voice?.automatable ?? {})) {
        if (!slot.effect.automation?.[key]?.length) continue;
        const stored = slot.effect.params[key];
        target.param.cancelScheduledValues(0);
        target.param.setValueAtTime(target.toParam(typeof stored === "number" ? stored : 0), now);
      }
    }
  }

  private applyAutomation(): void {
    let window = this.automationWindow;
    if (!window) return;
    if (this.options.live) {
      // Re-anchor to "now" so a rack edit during playback continues the curve instead of replaying the past.
      const elapsed = Math.max(0, Math.min(window.duration, this.ctx.currentTime - window.ctxStart));
      window = { timelineStart: window.timelineStart + elapsed, duration: window.duration - elapsed, ctxStart: this.ctx.currentTime };
    }
    for (const slot of this.slots) {
      const automatable = slot.voice?.automatable;
      if (!automatable) continue;
      const lanes = slot.effect.automation;
      for (const [key, target] of Object.entries(automatable)) {
        const points = lanes?.[key];
        if (!points || points.length === 0) continue;
        const stored = slot.effect.params[key];
        const base = typeof stored === "number" ? stored : 0;
        scheduleParamAutomation(target.param, points, base, target.toParam, window.timelineStart, window.duration, window.ctxStart);
      }
    }
  }

  private rewire(): void {
    this.rebuildCount += 1;
    if (this.inputWired) this.input.disconnect();
    let prev: AudioNode = this.input;
    for (const slot of this.slots) {
      if (slot.wired) slot.output.disconnect();
      prev.connect(slot.input);
      prev = slot.output;
      slot.wired = true;
    }
    prev.connect(this.output);
    this.inputWired = true;
  }

  private createSlot(fx: AudioRackEffect): RackSlot {
    const pinned = () => pinChannels(this.ctx.createGain(), this.channels);
    const slot: RackSlot = {
      effect: fx,
      input: pinned(),
      dry: pinned(),
      wet: pinned(),
      output: pinned(),
      voice: null,
      keyedWith: null,
      wired: false,
    };
    slot.input.connect(slot.dry);
    slot.dry.connect(slot.output);
    slot.wet.connect(slot.output);
    slot.dry.gain.value = fx.bypassed ? 1 : 0;
    slot.wet.gain.value = fx.bypassed ? 0 : 1;
    if (!fx.bypassed) this.buildVoice(slot);
    return slot;
  }

  private buildVoice(slot: RackSlot): void {
    this.releaseVoice(slot);
    slot.keyedWith = resolveRackKey(slot.effect, this.options.sidechain);
    const voice = createVoice(this.ctx, slot.effect, this.channels, this.options.sidechain);
    voice.onReady?.(() => {
      if (this.automationWindow && slot.voice === voice) this.applyAutomation();
    });
    slot.input.connect(voice.input);
    voice.output.connect(slot.wet);
    slot.voice = voice;
    if (this.clockOffset !== null) voice.setClockOffset?.(this.clockOffset);
  }

  private releaseVoice(slot: RackSlot): void {
    const voice = slot.voice;
    if (!voice) return;
    slot.voice = null;
    voice.dispose?.();
    try {
      slot.input.disconnect(voice.input);
    } catch {
      /* already disconnected */
    }
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }

  private applySlot(slot: RackSlot, fx: AudioRackEffect, smooth: boolean): void {
    const prev = slot.effect;
    slot.effect = fx;
    if (!fx.bypassed && !slot.voice) this.buildVoice(slot);
    if (prev.bypassed !== fx.bypassed) {
      setParam(slot.dry.gain, fx.bypassed ? 1 : 0, this.ctx, smooth);
      setParam(slot.wet.gain, fx.bypassed ? 0 : 1, this.ctx, smooth);
    }
    if (prev.automation !== fx.automation && slot.voice?.automatable) this.clearRemovedAutomation(slot, prev, fx);
    if (slot.voice && fx.type === "compressor" && resolveRackKey(fx, this.options.sidechain) !== slot.keyedWith) {
      this.buildVoice(slot);
      this.rebuildCount += 1;
    } else if (slot.voice && !paramsEqual(prev.params, fx.params)) {
      if (!slot.voice.update(fx.params, smooth)) {
        this.buildVoice(slot);
        this.rebuildCount += 1;
      }
    }
  }

  /** A lane that was removed returns its param to the static value instead of holding the old curve. */
  private clearRemovedAutomation(slot: RackSlot, prev: AudioRackEffect, next: AudioRackEffect): void {
    for (const [key, target] of Object.entries(slot.voice?.automatable ?? {})) {
      if (!prev.automation?.[key]?.length || next.automation?.[key]?.length) continue;
      const stored = next.params[key];
      if (typeof stored !== "number") continue;
      target.param.cancelScheduledValues(0);
      target.param.setValueAtTime(target.toParam(stored), this.ctx.currentTime);
    }
  }

  private disposeSlot(slot: RackSlot): void {
    this.releaseVoice(slot);
    for (const node of [slot.input, slot.dry, slot.wet, slot.output]) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }

  dispose(): void {
    for (const slot of this.slots) this.disposeSlot(slot);
    this.slots = [];
    try {
      this.input.disconnect();
      this.output.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

function paramsEqual(
  a: AudioRackEffect["params"],
  b: AudioRackEffect["params"],
): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** The rack bus for a layout: the unchanged stereo `AudioRackBus`, or the 5.1 pair-split one. */
export function createRackBus(ctx: BaseAudioContext, rack: AudioRack | undefined, options: AudioRackBusOptions): RackBusLike {
  return options.surround
    ? new AudioRackBus(ctx, rack, { live: options.live, channels: SURROUND_CHANNELS, sidechain: options.sidechain })
    : new AudioRackBus(ctx, rack, options);
}
