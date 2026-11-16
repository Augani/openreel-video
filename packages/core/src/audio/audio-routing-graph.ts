import type { AudioBus, AudioSend, AutomationPoint, Timeline, Track } from "../types/timeline";
import { scheduleVolumeAutomationOnGain } from "./clip-volume-automation";
import { schedulePanAutomationOnParam } from "./clip-pan-automation";
import { hasTrackAutomation } from "./track-automation";
import {
  computeBusAudibility,
  getAudioBuses,
  resolveOutputBusId,
  SEND_MAX_LEVEL,
} from "./audio-routing";
import { createRackBus, rackHasProcessing, rackPan, rackVolume, type RackBusLike } from "./track-audio-rack";
import { planTimelineDelayCompensation, type PdcPlan } from "./effect-latency";

/** Longest compensation delay a graph will insert (seconds). Real chains are tens of ms. */
const MAX_PDC_SECONDS = 2;
const EMPTY_PLAN: PdcPlan = {
  trackDelay: new Map(),
  sendDelay: new Map(),
  busDelay: new Map(),
  busArrival: new Map(),
  masterLatency: 0,
};

/** A DelayNode that exists only while its delay is non-zero, rewired in place. */
class PdcDelay {
  private node: DelayNode | null = null;
  private seconds = 0;
  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly source: AudioNode,
    private readonly destination: AudioNode,
  ) {}
  /** Connects source -> (delay) -> destination for `seconds` of compensation. */
  set(seconds: number): void {
    const wanted = Math.min(MAX_PDC_SECONDS, Math.max(0, seconds));
    // Whole samples: a fractional delay would interpolate and soften transients.
    const rate = this.ctx.sampleRate;
    const snapped = rate > 0 ? Math.round(wanted * rate) / rate : wanted;
    if (snapped > 0 && !this.node) {
      this.safeDisconnect(this.source, this.destination);
      this.node = this.ctx.createDelay(MAX_PDC_SECONDS);
      this.source.connect(this.node);
      this.node.connect(this.destination);
    } else if (!(snapped > 0) && this.node) {
      this.dispose(false);
      this.source.connect(this.destination);
    }
    if (this.node && snapped !== this.seconds) this.node.delayTime.setValueAtTime(snapped, 0);
    this.seconds = snapped;
  }
  get delay(): number {
    return this.seconds;
  }
  private safeDisconnect(from: AudioNode, to: AudioNode): void {
    try {
      from.disconnect(to);
    } catch {
      /* not connected */
    }
  }
  dispose(disconnectSource = true): void {
    if (this.node) {
      this.safeDisconnect(this.source, this.node);
      try {
        this.node.disconnect();
      } catch {
        /* already disconnected */
      }
      this.node = null;
    } else if (disconnectSource) this.safeDisconnect(this.source, this.destination);
    this.seconds = 0;
  }
}


/**
 * The bus/send node graph, shared by the realtime graph and the offline
 * mixdown so both build the SAME nodes in the SAME order:
 *
 *   track:  ... -> rack -> pan -> fader -> (output bus | master)
 *                          |        \
 *                          |         +-> post-fader send gain -> bus input
 *                          +-> (gate) -> pre-fader send gain -> bus input
 *   bus:    input (sum) -> rack -> pan -> fader (volume, automation, mute/solo)
 *               -> (output bus | master)
 *
 * Offline renders `live: false` (values are set directly, automation is
 * scheduled for the render window); live buses smooth changes and are
 * incrementally reconciled by `configure()`.
 */

type RoutingTimeline = Pick<Timeline, "tracks" | "audioBuses">;

interface BusNodes {
  readonly id: string;
  readonly input: GainNode;
  readonly rackBus: RackBusLike;
  /** Stereo panner; in a 5.1 mix a unity gain (the surround panner lives on the clips/tracks, see surround.ts). */
  readonly pan: StereoPannerNode | GainNode;
  readonly fader: GainNode;
  /** Where `fader` is currently connected. */
  connectedTo: AudioNode | null;
  /** Plugin delay compensation between the fader and its destination. */
  pdc: PdcDelay | null;
  bus: AudioBus;
}

interface SendNodes {
  readonly trackId: string;
  /** The track tap feeding `gain`; disconnected with it so rewiring never leaves orphan fan-out. */
  readonly source: AudioNode;
  send: AudioSend;
  readonly gain: GainNode;
  readonly pdc: PdcDelay;
}

export interface RoutingGraphOptions {
  readonly live: boolean;
  /** 5.1 sequence: buses carry six discrete channels. */
  readonly surround?: boolean;
  /** Live only: current timeline time, used to re-anchor automation when params change. */
  readonly getTimelineTime?: () => number;
  /** Live only: how far ahead (seconds) automation is scheduled. */
  readonly getHorizon?: () => number;
  /** Offline only: the rendered window (context time 0 = `timelineStart`). */
  readonly window?: { readonly timelineStart: number; readonly duration: number };
}

/** Everything that changes the node topology (as opposed to node parameters). */
export function routingStructureSignature(timeline: RoutingTimeline): string {
  return JSON.stringify([
    getAudioBuses(timeline).map((b) => [b.id, b.output ?? null]),
    timeline.tracks.map((t) => [t.id, t.output ?? null, (t.sends ?? []).map((s) => [s.id, s.busId, s.preFader])]),
  ]);
}

export class AudioRoutingGraph {
  private readonly buses = new Map<string, BusNodes>();
  private readonly sends = new Map<string, SendNodes[]>();
  private timeline: RoutingTimeline = { tracks: [] };
  private signature = "";
  private anchor: { timelineStart: number; duration: number; ctxStart: number } | null;
  /** Plugin delay compensation: latency of every parallel path, aligned (see effect-latency.ts). */
  private plan: PdcPlan = EMPTY_PLAN;
  private trackLatencies: ReadonlyMap<string, number> | undefined;
  private masterRackLatency = 0;
  private readonly trackOutputs = new Map<string, PdcDelay>();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly masterIn: AudioNode,
    private readonly options: RoutingGraphOptions,
  ) {
    this.anchor = options.window
      ? { timelineStart: options.window.timelineStart, duration: Math.max(0.001, options.window.duration), ctxStart: 0 }
      : null;
  }

  /**
   * Builds or reconciles the bus graph for `timeline`. Returns true when the
   * topology changed, i.e. every track must call `connectTrack` again.
   */
  configure(timeline: RoutingTimeline): boolean {
    this.timeline = timeline;
    const next = routingStructureSignature(timeline);
    const structural = next !== this.signature;
    this.refreshPlan();
    if (structural) {
      this.teardown();
      this.signature = next;
      for (const bus of getAudioBuses(timeline)) this.createBus(bus);
      for (const nodes of this.buses.values()) this.connectBus(nodes);
    }
    this.updateParams();
    return structural;
  }

  /**
   * Live graphs know more than the timeline (track-level effect chains, draft
   * racks): they report each track's total latency (seconds) and the master
   * rack's. Without an entry a track's latency is its rack's.
   */
  setLatencies(trackLatencies: ReadonlyMap<string, number> | undefined, masterRackLatencySeconds = 0): void {
    this.trackLatencies = trackLatencies;
    this.masterRackLatency = masterRackLatencySeconds;
    this.refreshPlan();
    this.applyDelays();
  }

  private refreshPlan(): void {
    // A live graph can hold tracks the timeline snapshot has not caught up with
    // (auto-created on first clip); they play into the master.
    const known = new Set(this.timeline.tracks.map((t) => t.id));
    const extra = [...(this.trackLatencies?.keys() ?? [])].filter((id) => !known.has(id)).map((id) => ({ id }) as Track);
    const timeline = extra.length ? { ...this.timeline, tracks: [...this.timeline.tracks, ...extra] } : this.timeline;
    this.plan = planTimelineDelayCompensation(timeline, this.ctx.sampleRate || 48000, this.trackLatencies);
  }

  /** The compensation currently planned (read-only; for tests and the UI). */
  getDelayPlan(): PdcPlan {
    return this.plan;
  }

  /**
   * Latency (s) every path has from a track's clip sum to the graph output once
   * compensated: the aligned bus/master latency plus the master rack's own.
   * Offline renders drop this many leading samples; the live scheduler starts
   * sources this much early.
   */
  getTotalLatencySeconds(): number {
    return this.plan.masterLatency + this.masterRackLatency;
  }

  /** Plugin delay (s) applied after this track's output. */
  getTrackDelaySeconds(trackId: string): number {
    return this.plan.trackDelay.get(trackId) ?? 0;
  }

  /** Re-applies the planned delays to the live nodes (zero delays remove the node). */
  private applyDelays(): void {
    for (const [trackId, pdc] of this.trackOutputs) pdc.set(this.plan.trackDelay.get(trackId) ?? 0);
    for (const nodes of this.buses.values()) nodes.pdc?.set(this.plan.busDelay.get(nodes.id) ?? 0);
    for (const list of this.sends.values()) for (const node of list) node.pdc.set(this.plan.sendDelay.get(node.send.id) ?? 0);
  }

  /**
   * Connects a track's post-fader output to the bus/master named by `output`,
   * through its compensation delay. Call after `configure()` (and after the
   * caller disconnected the track's previous output).
   */
  connectTrackOutput(trackId: string, source: AudioNode, output: string | undefined): void {
    this.trackOutputs.get(trackId)?.dispose(false);
    const destination = this.outputFor(output);
    const pdc = new PdcDelay(this.ctx, source, destination);
    this.trackOutputs.set(trackId, pdc);
    source.connect(destination);
    pdc.set(this.plan.trackDelay.get(trackId) ?? 0);
  }

  disconnectTrackOutput(trackId: string): void {
    this.trackOutputs.get(trackId)?.dispose(false);
    this.trackOutputs.delete(trackId);
  }

  private createBus(bus: AudioBus): void {
    const input = this.ctx.createGain();
    const rackBus = createRackBus(this.ctx, bus.rack, { live: this.options.live, surround: this.options.surround });
    const pan = this.options.surround ? this.ctx.createGain() : this.ctx.createStereoPanner();
    const fader = this.ctx.createGain();
    input.connect(rackBus.input);
    rackBus.output.connect(pan);
    pan.connect(fader);
    this.buses.set(bus.id, { id: bus.id, input, rackBus, pan, fader, connectedTo: null, pdc: null, bus });
  }

  private connectBus(nodes: BusNodes): void {
    const target = this.outputFor(nodes.bus.output);
    nodes.fader.connect(target);
    nodes.connectedTo = target;
    nodes.pdc = new PdcDelay(this.ctx, nodes.fader, target);
    nodes.pdc.set(this.plan.busDelay.get(nodes.id) ?? 0);
  }

  /** The node a track/bus with this output assignment plays into. */
  outputFor(output: string | undefined): AudioNode {
    const id = resolveOutputBusId(this.timeline, output);
    return (id ? this.buses.get(id)?.input : undefined) ?? this.masterIn;
  }

  getBusInput(busId: string): AudioNode | undefined {
    return this.buses.get(busId)?.input;
  }

  /** Post-fader bus signal, for metering. */
  getBusOutput(busId: string): GainNode | undefined {
    return this.buses.get(busId)?.fader;
  }

  /** Applies a draft rack (fader/pan/effects) to a live bus without touching the project. */
  previewBusRack(busId: string, rack: AudioBus["rack"]): void {
    this.timeline = {
      ...this.timeline,
      audioBuses: getAudioBuses(this.timeline).map((b) => (b.id === busId ? { ...b, rack } : b)),
    };
    this.updateParams();
  }

  getBusRackBus(busId: string): RackBusLike | undefined {
    return this.buses.get(busId)?.rackBus;
  }

  /**
   * Wires one track's pre/post-fader taps to its send buses. Call after
   * `configure()` reported a structural change and when the track is (re)built.
   */
  connectSends(track: Pick<Track, "id" | "sends">, preFader: AudioNode, postFader: AudioNode): void {
    this.disconnectSends(track.id);
    const list: SendNodes[] = [];
    for (const send of track.sends ?? []) {
      const bus = this.buses.get(send.busId);
      if (!bus) continue;
      const gain = this.ctx.createGain();
      gain.gain.value = this.sendBase(send);
      const source = send.preFader ? preFader : postFader;
      source.connect(gain);
      gain.connect(bus.input);
      const pdc = new PdcDelay(this.ctx, gain, bus.input);
      pdc.set(this.plan.sendDelay.get(send.id) ?? 0);
      list.push({ trackId: track.id, source, send, gain, pdc });
    }
    if (list.length) {
      this.sends.set(track.id, list);
      this.scheduleSendAutomation(list);
    }
  }

  disconnectSends(trackId: string): void {
    for (const node of this.sends.get(trackId) ?? []) {
      node.pdc.dispose(false);
      try {
        node.source.disconnect(node.gain);
      } catch {
        /* source already disconnected */
      }
      try {
        node.gain.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.sends.delete(trackId);
  }

  private sendBase(send: AudioSend): number {
    return send.muted ? 0 : Math.max(0, Math.min(SEND_MAX_LEVEL, send.level));
  }

  private busBase(nodes: BusNodes, audible: boolean): number {
    return audible ? rackVolume(nodes.bus.rack) : 0;
  }

  /** Pushes bus racks, pan, fader, mute/solo and send levels without rebuilding. */
  private updateParams(): void {
    const buses = getAudioBuses(this.timeline);
    const audibility = computeBusAudibility(buses);
    const byId = new Map(buses.map((b) => [b.id, b]));
    const now = this.ctx.currentTime;
    for (const nodes of this.buses.values()) {
      const bus = byId.get(nodes.id);
      if (!bus) continue;
      nodes.bus = bus;
      nodes.rackBus.update(bus.rack);
      if ("pan" in nodes.pan) nodes.pan.pan.setValueAtTime(Math.max(-1, Math.min(1, rackPan(bus.rack))), now);
      const audible = audibility.get(bus.id) !== false;
      const points = audible ? bus.automation?.volume : undefined;
      if (points && points.length > 0) this.scheduleFader(nodes, points);
      else {
        nodes.fader.gain.cancelScheduledValues(now);
        nodes.fader.gain.setValueAtTime(this.busBase(nodes, audible), now);
      }
    }
    for (const list of this.sends.values()) {
      const track = this.timeline.tracks.find((t) => t.id === list[0]?.trackId);
      for (const node of list) {
        const send = track?.sends?.find((s) => s.id === node.send.id);
        if (send) node.send = send;
      }
      this.scheduleSendAutomation(list);
    }
  }

  private window(): { timelineStart: number; duration: number; ctxStart: number } {
    if (this.anchor) return this.anchor;
    const timelineStart = this.options.getTimelineTime?.() ?? 0;
    const duration = this.options.getHorizon?.() ?? 3600;
    return { timelineStart, duration: Math.max(0.001, duration), ctxStart: this.ctx.currentTime };
  }

  /**
   * Context time at which timeline time `timelineStart` reaches a node that
   * sits `arrival` seconds after the clip sum. Offline renders drop the total
   * latency at the end (so a node sees time late by its arrival); a live graph's
   * sources start `total` early, so the node sees time `total - arrival` early.
   */
  private nodeCtxStart(ctxStart: number, arrival: number): number {
    return this.options.live ? ctxStart + arrival - this.getTotalLatencySeconds() : ctxStart + arrival;
  }

  private scheduleFader(nodes: BusNodes, points: readonly AutomationPoint[]): void {
    const w = this.window();
    const start = this.nodeCtxStart(w.ctxStart, this.plan.busArrival.get(nodes.id) ?? 0);
    scheduleVolumeAutomationOnGain(nodes.fader, points as AutomationPoint[], rackVolume(nodes.bus.rack), w.timelineStart, w.duration, start);
  }

  private scheduleSendAutomation(list: readonly SendNodes[]): void {
    const w = this.window();
    for (const node of list) {
      const points = node.send.automation;
      if (points && points.length > 0 && !node.send.muted) {
        const arrival = this.trackLatencies?.get(node.trackId) ?? this.rackArrival(node.trackId);
        scheduleVolumeAutomationOnGain(node.gain, points, node.send.level, w.timelineStart, w.duration, this.nodeCtxStart(w.ctxStart, arrival));
      } else {
        node.gain.gain.cancelScheduledValues(w.ctxStart);
        node.gain.gain.setValueAtTime(this.sendBase(node.send), w.ctxStart);
      }
    }
  }

  private rackArrival(trackId: string): number {
    const track = this.timeline.tracks.find((t) => t.id === trackId);
    return planTimelineDelayCompensation({ tracks: track ? [track] : [], audioBuses: [] }, this.ctx.sampleRate || 48000).masterLatency;
  }

  /** Live: re-anchor bus/send automation to `timelineStart` playing from `ctxStart` (call on play/seek). */
  scheduleAutomation(timelineStart: number, duration: number, ctxStart: number): void {
    const previous = this.anchor;
    this.anchor = { timelineStart, duration: Math.max(0.001, duration), ctxStart };
    this.updateParams();
    this.anchor = previous;
  }

  private teardown(): void {
    for (const trackId of [...this.sends.keys()]) this.disconnectSends(trackId);
    for (const pdc of this.trackOutputs.values()) pdc.dispose(false);
    this.trackOutputs.clear();
    for (const nodes of this.buses.values()) {
      nodes.pdc?.dispose(false);
      nodes.rackBus.dispose();
      for (const node of [nodes.input, nodes.pan, nodes.fader]) {
        try {
          node.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    }
    this.buses.clear();
  }

  dispose(): void {
    this.teardown();
    this.signature = "";
  }
}

/**
 * Offline per-track chain (rack -> pan -> fader -> output) shared with the unit
 * tests. Returns the node clips connect to, or undefined when the track needs no
 * chain (no rack, unity fader, centre pan, plays into the master with no sends),
 * in which case clips connect straight to `masterIn` exactly as before routing.
 */
export function buildOfflineTrackChain(
  ctx: BaseAudioContext,
  routing: AudioRoutingGraph | null,
  track: Pick<Track, "id" | "audioRack" | "output" | "sends" | "automation">,
  masterIn: AudioNode,
  /** Plugin delay compensation (s) for a track that plays straight into the master (no routing graph). */
  masterDelaySeconds = 0,
  /** 5.1 sequence: six discrete channels; the stereo pan stage becomes a unity gain (see surround.ts). */
  surround = false,
  /** The rendered window (context time 0 = `timelineStart`); needed to place track automation. */
  window?: { readonly timelineStart: number; readonly duration: number },
): AudioNode | undefined {
  const rack = track.audioRack;
  const automated = hasTrackAutomation(track) && !!window;
  const routed = !!routing && (routing.outputFor(track.output) !== masterIn || (track.sends?.length ?? 0) > 0);
  const hasRack = !!rack && (rackHasProcessing(rack) || rackVolume(rack) !== 1 || (!surround && rackPan(rack) !== 0));
  const compensated = masterDelaySeconds > 0 || (!!routing && routing.getTrackDelaySeconds(track.id) > 0);
  if (!routed && !hasRack && !compensated && !automated) return undefined;
  const bus = createRackBus(ctx, rack, { live: false, surround });
  const pan = surround ? ctx.createGain() : ctx.createStereoPanner();
  if ("pan" in pan) pan.pan.value = rackPan(rack);
  const volume = ctx.createGain();
  volume.gain.value = rackVolume(rack);
  if (automated && window) {
    // The lanes replace the rack fader / pan while they play; the rack values hold before the first point.
    if (track.automation?.volume?.length) {
      scheduleVolumeAutomationOnGain(volume, track.automation.volume, rackVolume(rack), window.timelineStart, window.duration, 0);
    }
    if (track.automation?.pan?.length && "pan" in pan) {
      schedulePanAutomationOnParam(pan.pan, track.automation.pan, rackPan(rack), window.timelineStart, window.duration, 0);
    }
  }
  bus.output.connect(pan);
  pan.connect(volume);
  if (routing) routing.connectTrackOutput(track.id, volume, track.output);
  else if (masterDelaySeconds > 0) {
    const delay = ctx.createDelay(MAX_PDC_SECONDS);
    delay.delayTime.value = Math.round(Math.min(MAX_PDC_SECONDS, masterDelaySeconds) * ctx.sampleRate) / ctx.sampleRate;
    volume.connect(delay);
    delay.connect(masterIn);
  } else volume.connect(masterIn);
  if (routing && (track.sends?.length ?? 0) > 0) routing.connectSends(track, pan, volume);
  return bus.input;
}
