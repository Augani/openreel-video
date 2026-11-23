/**
 * Processing latency of audio effects, and Plugin Delay Compensation (PDC).
 *
 * Lookahead / FFT effects output their result some samples after the input
 * that produced it. Left uncompensated, a click on the timeline comes out
 * late, and a track with a Limiter drifts against a track without one. This
 * module is the single source of truth for "how late is each effect" (pure,
 * context free, unit-tested in node) and plans where delay must be inserted
 * so that every parallel path of the routing graph reaches a summing point
 * aligned.
 *
 *   effect latency      effectLatencySamples / rackLatencySamples
 *   offline render      the renderer adds the chain latency to the render
 *                       length and drops that many leading samples (exact)
 *   routing graph       planDelayCompensation -> delay per track output, send
 *                       and bus output (AudioRoutingGraph)
 *   realtime transport  the graph reports its total latency and the scheduler
 *                       starts sources that much early
 */
import type { AudioRack, AudioRackEffectType, Timeline } from "../types/timeline";
import { getAudioBuses, resolveOutputBusId } from "./audio-routing";
import { REPAIR_EFFECT_DEFINITIONS, sanitizeRepairParams } from "./repair/repair-definitions";
import { isRepairEffectType, repairLatencySamples, type RepairParams } from "./repair/repair-dsp";

/**
 * Web Audio's DynamicsCompressorNode delays its signal by a fixed 6 ms
 * (the spec's "pre-delay" lookahead). Compressor and Limiter are built on it.
 * Verified against Chrome's OfflineAudioContext in the real-browser e2e.
 */
export const DYNAMICS_COMPRESSOR_LOOKAHEAD_SECONDS = 0.006;

/** Frames of the compressor lookahead at `sampleRate` (as Chromium computes it). */
export const compressorLookaheadSamples = (sampleRate: number): number =>
  Math.floor(DYNAMICS_COMPRESSOR_LOOKAHEAD_SECONDS * sampleRate);

type ParamBag = Readonly<Record<string, unknown>> | undefined;

/** Latency in samples an effect of `type` adds. Zero for effects that are zero-latency or unknown. */
export function effectLatencySamples(type: string, params: ParamBag, sampleRate: number): number {
  if (type === "compressor" || type === "limiter") return compressorLookaheadSamples(sampleRate);
  if (isRepairEffectType(type)) {
    // The worklet runs on sanitised params; the latency can depend on them (DeClick width).
    return repairLatencySamples(type, sampleRate, sanitizeRepairParams(type, params as Record<string, unknown> | undefined) as RepairParams);
  }
  return 0;
}

interface ChainEffect {
  readonly type: string;
  readonly enabled?: boolean;
  readonly bypassed?: boolean;
  readonly params?: ParamBag;
}

/** Total latency (samples) of effects connected in series; disabled/bypassed effects add none. */
export function effectChainLatencySamples(effects: readonly ChainEffect[] | undefined, sampleRate: number): number {
  let total = 0;
  for (const effect of effects ?? []) {
    if (effect.enabled === false || effect.bypassed === true) continue;
    total += effectLatencySamples(effect.type, effect.params, sampleRate);
  }
  return total;
}

export const rackLatencySamples = (rack: AudioRack | undefined, sampleRate: number): number =>
  effectChainLatencySamples(rack?.effects, sampleRate);

export const samplesToSeconds = (samples: number, sampleRate: number): number => samples / sampleRate;

export interface EffectLatencyInfo {
  readonly type: string;
  readonly label: string;
  readonly samples: number;
  readonly milliseconds: number;
  /** Why the effect is late (shown next to the number). */
  readonly reason: string;
}

const REASONS: Record<string, string> = {
  compressor: "Web Audio compressor lookahead",
  limiter: "Web Audio compressor lookahead",
  deClick: "Look-ahead window for click repair",
  deClip: "Look-ahead window for clip repair",
  deReverb: "One FFT frame",
  deEss: "Zero-latency detector band",
  deHum: "Zero-latency notch filters",
  gate: "Zero-latency gate",
  brickwallLimiter: "5 ms true-peak lookahead",
  lowPass: "Zero-latency filter",
};

const LABELS: Record<string, string> = {
  compressor: "Compressor",
  limiter: "Limiter",
};

/** The latency each effect that can have any (and each repair effect) reports at its default settings. */
export function listEffectLatencies(sampleRate: number): EffectLatencyInfo[] {
  const types: string[] = ["compressor", "limiter", ...Object.keys(REPAIR_EFFECT_DEFINITIONS)];
  return types.map((type) => {
    const samples = effectLatencySamples(type, undefined, sampleRate);
    const repair = (REPAIR_EFFECT_DEFINITIONS as Record<string, { label: string }>)[type];
    return {
      type,
      label: repair?.label ?? LABELS[type] ?? type,
      samples,
      milliseconds: (samples / sampleRate) * 1000,
      reason: REASONS[type] ?? "",
    };
  });
}

export type RackEffectLatencyType = AudioRackEffectType;

// ---------------------------------------------------------------------------
// Plugin Delay Compensation planner
// ---------------------------------------------------------------------------

export interface PdcTrack {
  readonly id: string;
  /** Seconds the track adds from its clips' summing point to its (post-fader) output. */
  readonly latency: number;
  /** Bus the track plays into; undefined/null = master. */
  readonly output?: string | null;
  readonly sends?: ReadonlyArray<{ readonly id: string; readonly busId: string }>;
}

export interface PdcBus {
  readonly id: string;
  readonly latency: number;
  readonly output?: string | null;
}

export interface PdcPlan {
  /** Delay (s) after each track's output, before it reaches its destination bus/master. */
  readonly trackDelay: ReadonlyMap<string, number>;
  /** Delay (s) after each send, before it reaches its bus input. */
  readonly sendDelay: ReadonlyMap<string, number>;
  /** Delay (s) after each bus output, before it reaches its destination. */
  readonly busDelay: ReadonlyMap<string, number>;
  /** Signal latency (s) from a track's summing point to the bus fader, per bus (after the bus rack). */
  readonly busArrival: ReadonlyMap<string, number>;
  /** Aligned latency (s) at the master input: every path through the graph has exactly this. */
  readonly masterLatency: number;
}

const EPS = 1e-12;

/**
 * Align every parallel path. A summing point (a bus input, the master) has
 * several inputs, each arriving with its own cumulative latency; every input
 * except the slowest is delayed by the difference, so all of them reach the
 * sum together. A bus's output latency is its aligned input latency plus its
 * own rack. Cycles are broken (the offender is routed to the master), exactly
 * as the routing graph itself does.
 */
export function planDelayCompensation(tracks: readonly PdcTrack[], buses: readonly PdcBus[]): PdcPlan {
  const busById = new Map(buses.map((bus) => [bus.id, bus]));
  const destinationOf = (output: string | null | undefined): string | null => (output && busById.has(output) ? output : null);

  interface Input {
    readonly kind: "track" | "send" | "bus";
    readonly id: string;
    readonly dest: string | null;
    readonly arrival: number;
  }

  const busArrival = new Map<string, number>(); // latency at a bus's fader (after rack)
  const inputsOf = new Map<string | null, Input[]>();
  const resolving = new Set<string>();

  const outputLatency = (busId: string): number => {
    const cached = busArrival.get(busId);
    if (cached !== undefined) return cached;
    const bus = busById.get(busId)!;
    if (resolving.has(busId)) return bus.latency; // cycle guard
    resolving.add(busId);
    let target = 0;
    for (const input of collectInputs(busId)) target = Math.max(target, input.arrival);
    resolving.delete(busId);
    const value = target + bus.latency;
    busArrival.set(busId, value);
    return value;
  };

  // Inputs of a summing point, with their arrival latencies.
  const collectInputs = (dest: string | null): Input[] => {
    const cached = inputsOf.get(dest);
    if (cached) return cached;
    const list: Input[] = [];
    inputsOf.set(dest, list);
    for (const track of tracks) {
      if (destinationOf(track.output) === dest) list.push({ kind: "track", id: track.id, dest, arrival: track.latency });
      for (const send of track.sends ?? []) {
        if (busById.has(send.busId) && send.busId === dest) list.push({ kind: "send", id: send.id, dest, arrival: track.latency });
      }
    }
    for (const bus of buses) {
      if (bus.id === dest || destinationOf(bus.output) !== dest) continue;
      list.push({ kind: "bus", id: bus.id, dest, arrival: outputLatency(bus.id) });
    }
    return list;
  };

  const trackDelay = new Map<string, number>();
  const sendDelay = new Map<string, number>();
  const busDelay = new Map<string, number>();
  const settle = (dest: string | null): number => {
    const inputs = collectInputs(dest);
    const target = inputs.reduce((max, input) => Math.max(max, input.arrival), 0);
    for (const input of inputs) {
      const delay = target - input.arrival;
      const map = input.kind === "track" ? trackDelay : input.kind === "send" ? sendDelay : busDelay;
      map.set(input.id, delay > EPS ? delay : 0);
    }
    return target;
  };

  for (const bus of buses) settle(bus.id);
  const masterLatency = settle(null);
  for (const bus of buses) outputLatency(bus.id);
  return { trackDelay, sendDelay, busDelay, busArrival, masterLatency };
}

/**
 * `planDelayCompensation` for a timeline. `trackLatency` gives each track's
 * latency in seconds (tracks absent from it use their rack alone); bus
 * latencies come from the bus racks. Outputs are resolved the way the routing
 * graph resolves them (dangling ids and cycles play into the master).
 */
export function planTimelineDelayCompensation(
  timeline: Pick<Timeline, "tracks" | "audioBuses">,
  sampleRate: number,
  trackLatency?: ReadonlyMap<string, number>,
  /** Extra seconds of latency per bus on top of its rack (live plugin inserts). */
  busExtraLatency?: ReadonlyMap<string, number>,
): PdcPlan {
  const buses = getAudioBuses(timeline);
  const resolved = new Map(buses.map((b) => [b.id, resolveOutputBusId(timeline, b.output) ?? null]));
  // Break routing loops the same way the graph does: a bus that can reach itself plays into the master.
  const reaches = (from: string): boolean => {
    let current = resolved.get(from) ?? null;
    for (let hops = 0; current && hops <= buses.length; hops++) {
      if (current === from) return true;
      current = resolved.get(current) ?? null;
    }
    return false;
  };
  return planDelayCompensation(
    timeline.tracks.map((track) => ({
      id: track.id,
      latency: trackLatency?.get(track.id) ?? rackLatencySamples(track.audioRack, sampleRate) / sampleRate,
      output: resolveOutputBusId(timeline, track.output) ?? null,
      sends: (track.sends ?? []).map((send) => ({ id: send.id, busId: send.busId })),
    })),
    buses.map((bus) => ({
      id: bus.id,
      latency: rackLatencySamples(bus.rack, sampleRate) / sampleRate + (busExtraLatency?.get(bus.id) ?? 0),
      output: reaches(bus.id) ? null : (resolved.get(bus.id) ?? null),
    })),
  );
}
