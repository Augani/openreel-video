import {
  getMasterClock,
  MasterTimelineClock,
} from "../playback/master-timeline-clock";
import type { AutomationPoint, ClipFade, Effect } from "../types/timeline";
import { createNoiseReductionNodeChain } from "./audio-effects-engine";
import { createRepairChainNode, ensureRepairWorklet } from "./repair/repair-node";
import { isRepairEffectType, type RepairParams } from "./repair/repair-dsp";
import { sanitizeRepairParams } from "./repair/repair-definitions";
import { scheduleVolumeAutomationOnGain } from "./clip-volume-automation";
import { scheduleClipFadeEnvelope } from "./clip-fade-envelope";
import { getPanFromAudioEffects } from "./audio-effect-routing";
import type { AudioRack, Timeline } from "../types/timeline";
import { AudioRoutingGraph } from "./audio-routing-graph";
import { schedulePanAutomationOnParam } from "./clip-pan-automation";
import { shouldPreservePitch } from "./time-stretch";
import { SCRUB_GRAIN_SECONDS, SCRUB_MAX_GRAINS, planScrubGrains } from "./scrub-grain";
import { StretchCache, getSharedStretchCache, type StretchRequest, type StretchRunner } from "./stretch-cache";
import { SpectralRepairCache, getSharedSpectralRepairCache, type SpectralRepairRequest } from "./spectral/spectral-repair-cache";
import { SPECTRAL_REPAIR_EFFECT_TYPE, getSpectralRepairRegions, spectralRegionsKey } from "./spectral/spectral-regions";
import type { SpectralBackend } from "./spectral/spectral-worker-client";
import { createRackBus, rackPan, rackVolume, type RackBusLike } from "./track-audio-rack";
import { createLinkedCompressorStage, createMultichannelConvolver, needsMultichannelNodes, pinChannels } from "./multichannel-fx";
import { mapAudioBuffer, type ClipChannelMap } from "./channel-map";
import { createSurroundPanner, resolveSurroundPan, type ChannelLayout, type SurroundPannerNodes } from "./surround";
import { effectChainLatencySamples, rackLatencySamples } from "./effect-latency";
import { isTrackAudible } from "./track-audibility";
import { getAudioOutputRouter } from "./audio-output-device";

export interface AudioClipSchedule {
  clipId: string;
  trackId: string;
  audioBuffer: AudioBuffer;
  /** Audio Channels mapping applied to `audioBuffer` when the clip is scheduled. */
  channelMap?: ClipChannelMap;
  startTime: number;
  endTime: number;
  mediaOffset: number;
  volume: number;
  volumeAutomation: AutomationPoint[];
  pan: number;
  /** Time-varying pan lane (clip-relative seconds, -1..1). */
  panAutomation?: AutomationPoint[];
  effects: Effect[];
  speed: number;
  /** Maintain audio pitch when speed != 1 (default true). Preview plays a cached stretched render. */
  pitchCorrection?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  fadeOrigin?: ClipFade["origin"];
  transitionFadeIn?: number;
  transitionFadeOut?: number;
}

interface TrackConfig {
  trackId: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  /** Solo Safe: stays audible while other tracks are soloed. */
  soloSafe?: boolean;
  effects: Effect[];
}

interface ScheduledSource {
  release: () => void;
  clipId: string;
  trackId: string;
  /** 5.1 mix: the clip's surround panner, re-aimed live when the mixer moves it. */
  panner?: SurroundPannerNodes;
  source: AudioBufferSourceNode;
  startedAt: number;
  duration: number;
  /** The schedule this source was built from, so it can be rebuilt (e.g. when the pitch-preserving stretch becomes ready). */
  schedule: AudioClipSchedule;
  /** True when the source plays the pitch-preserving stretch (false: plain playbackRate resampling). */
  stretched: boolean;
  /** Fades the source out over `seconds` and detaches it from the track (used to swap it for a rebuilt one). */
  retire: (seconds: number) => void;
  /** Spectral repair: the original schedule while the source plays the unrepaired audio, until the cached repair is ready. */
  spectralWait?: AudioClipSchedule;
}

/** Click-free hand-over between a resampled source and its pitch-preserving replacement. */
const STRETCH_SWAP_FADE_SECONDS = 0.02;

interface ReverbNodes {
  inputGain: GainNode;
  dryGain: GainNode;
  wetGain: GainNode;
  convolver: ConvolverNode;
  outputGain: GainNode;
  /** 5.1: the per-channel convolvers and their splitter/merger (the nodes above then only mark the first). */
  extraNodes?: AudioNode[];
}

interface DelayNodes {
  inputGain: GainNode;
  delayNode: DelayNode;
  feedbackGain: GainNode;
  wetGain: GainNode;
  dryGain: GainNode;
  outputGain: GainNode;
}

interface TrackNodes {
  ownedEffectNodes: AudioNode[];
  inputGain: GainNode;
  effectChainInput: AudioNode;
  effectChainOutput: AudioNode;
  /** Stereo panner; a unity gain in a 5.1 mix (surround positions live on clips/tracks). */
  panNode: StereoPannerNode | GainNode;
  outputGain: GainNode;
  compressor: DynamicsCompressorNode | null;
  eqFilters: BiquadFilterNode[];
  noiseReductionNodes: AudioNode[];
  reverbNodes: ReverbNodes | null;
  delayNodes: DelayNodes | null;
  /** Premiere-style effect rack, between the legacy chain and the pan/volume stage. */
  rackBus: RackBusLike;
  /** Post-pan, pre-fader tap for pre-fader sends; muted/solo-gated like the fader. */
  preFaderGate: GainNode;
}

/** How far ahead of "now" a clip that is already playing is started (see scheduleClip). */
export const SCHEDULE_START_LOOKAHEAD_SECONDS = 0.02;

export class RealtimeAudioGraph {
  private audioContext: AudioContext;
  private masterClock: MasterTimelineClock;
  private masterGain: GainNode;
  /** Post-master-rack unity node; the destination feed and the metering tap. */
  private masterOutput: GainNode;
  private masterBus: RackBusLike;
  /** 5.1 sequence: every bus carries six discrete channels; monitoring downmixes at the device (ITU-R BS.775, see surround.ts). */
  private surround = false;
  private surroundTimeline: Pick<Timeline, "tracks"> = { tracks: [] };
  private trackRacks: Map<string, AudioRack | undefined> = new Map();
  private trackNodes: Map<string, TrackNodes> = new Map();
  private scheduledSources: Map<string, ScheduledSource[]> = new Map();
  private trackConfigs: Map<string, TrackConfig> = new Map();
  private hasSoloTracks = false;
  private impulseResponseCache: Map<string, AudioBuffer> = new Map();
  private isPlaying = false;
  private lastScheduledTime = 0;
  private seekPending = false;
  private scheduleAheadTime = 0.2;
  private schedulerIntervalId: number | null = null;
  private scheduleAudioNow: (() => void) | null = null;
  /** Persist mixer volume/pan so they survive track recreate (e.g. on seek). */
  private trackVolumeOverrides: Map<string, number> = new Map();
  private trackPanOverrides: Map<string, number> = new Map();
  private masterVolumeOverride = 1;
  private previewMuted = false;
  /** Buses and sends (Audio Track Mixer); empty graph = every track plays into the master. */
  private routing: AudioRoutingGraph;
  private routingTimeline: Pick<Timeline, "tracks" | "audioBuses"> = { tracks: [] };
  private routingHorizon = 3600;
  /** Track fader / pan automation: lane signature per track, to re-schedule only on change, play or seek. */
  private trackAutomationSignature = new Map<string, string>();
  private trackLatencySeconds = new Map<string, number>();
  private masterRack: AudioRack | undefined;

  constructor(masterClock?: MasterTimelineClock) {
    this.masterClock = masterClock || getMasterClock();
    this.audioContext = this.masterClock.getAudioContext();
    // Repair effects (DeHum, DeClick, ...) run in a worklet; start loading it up front.
    void ensureRepairWorklet(this.audioContext);
    this.masterGain = this.audioContext.createGain();
    this.masterOutput = this.audioContext.createGain();
    this.masterBus = createRackBus(this.audioContext, undefined, { live: true });
    this.masterGain.connect(this.masterBus.input);
    this.masterBus.output.connect(this.masterOutput);
    this.masterOutput.connect(this.audioContext.destination);
    // Monitor device chosen in Preferences / the mixer (no-op until one is picked).
    getAudioOutputRouter().attach(this.audioContext, this.masterOutput);
    this.routing = new AudioRoutingGraph(this.audioContext, this.masterGain, {
      live: true,
      getTimelineTime: () => this.masterClock.currentTime,
      getHorizon: () => this.routingHorizon,
    });
  }

  getAudioContext(): AudioContext {
    return this.audioContext;
  }

  /** Channels of the live mix (2, or 6 for a 5.1 sequence): what the loudness tap and meters read. */
  getMixChannelCount(): number {
    return this.surround ? 6 : 2;
  }

  /**
   * Switches the live mix between stereo and 5.1 and tells it where the surround
   * positions live. Changing the layout rebuilds the master rack, the bus graph and every
   * track (the node topology differs); calling it again with the same layout only re-aims the
   * panners of clips that are already scheduled.
   */
  setChannelLayout(layout: ChannelLayout, timeline: Pick<Timeline, "tracks" | "audioBuses"> & { duration?: number }): void {
    this.surroundTimeline = timeline;
    const surround = layout === "5.1";
    if (surround === this.surround) {
      this.refreshSurroundPans();
      return;
    }
    this.surround = surround;
    this.stopAllClips();
    this.masterBus.dispose();
    this.masterBus = createRackBus(this.audioContext, this.masterRack, { live: true, surround });
    this.masterGain.connect(this.masterBus.input);
    this.masterBus.output.connect(this.masterOutput);
    this.routing.dispose();
    this.routing = new AudioRoutingGraph(this.audioContext, this.masterGain, {
      live: true,
      surround,
      getTimelineTime: () => this.masterClock.currentTime,
      getHorizon: () => this.routingHorizon,
    });
    this.routing.configure(timeline);
    for (const config of [...this.trackConfigs.values()]) this.createTrack(config);
    this.refreshLatency();
    // The sources scheduled ahead of the playhead went with the old topology: rewind the scheduling
    // horizon to "now" and, when playing, schedule the clips that are sounding again straight away
    // (they join at the right media offset) instead of waiting for the next scheduler tick.
    this.lastScheduledTime = this.masterClock.currentTime;
    if (this.isPlaying && this.masterClock.isPlaying && this.scheduleAudioNow) this.scheduleAudioNow();
  }

  private surroundPanFor(clipId: string, trackId: string) {
    const track = this.surroundTimeline.tracks.find((t) => t.id === trackId);
    return resolveSurroundPan(track?.clips.find((c) => c.id === clipId), track);
  }

  /** Re-aim the surround panners of the clips already scheduled (a puck moved in the mixer). */
  private refreshSurroundPans(): void {
    if (!this.surround) return;
    for (const sources of this.scheduledSources.values()) {
      for (const scheduled of sources) scheduled.panner?.setPan(this.surroundPanFor(scheduled.clipId, scheduled.trackId), this.audioContext.currentTime);
    }
  }
  /** Final master signal (after the master rack) for a silent metering tap. */
  getMasterGain(): GainNode {
    return this.masterOutput;
  }

  /**
   * Apply a track's effect rack incrementally: bypass is a gain crossfade and
   * parameter edits retarget AudioParams. Volume and pan follow the rack and
   * live on the bus gain/pan nodes, so clip automation (per-clip gains) is
   * never touched.
   */
  setTrackRack(trackId: string, rack: AudioRack | undefined): void {
    this.trackRacks.set(trackId, rack);
    this.updateTrackVolume(trackId, rackVolume(rack));
    this.updateTrackPan(trackId, rackPan(rack));
    this.trackNodes.get(trackId)?.rackBus.update(rack);
    this.refreshLatency();
  }

  setMasterRack(rack: AudioRack | undefined): void {
    this.masterRack = rack;
    this.masterBus.update(rack);
    this.setMasterVolume(rackVolume(rack));
    this.refreshLatency();
  }

  /**
   * Plugin delay compensation. Every track reports its own latency (track
   * effect chain + rack); the routing graph delays the faster paths so all
   * parallel paths reach the master together, and the master rack's latency is
   * common to all of them.
   */
  private refreshLatency(): void {
    const rate = this.audioContext.sampleRate || 48000;
    const latencies = new Map<string, number>();
    for (const [trackId, config] of this.trackConfigs) {
      const seconds = (effectChainLatencySamples(config.effects, rate) + rackLatencySamples(this.trackRacks.get(trackId), rate)) / rate;
      latencies.set(trackId, seconds);
      this.trackLatencySeconds.set(trackId, seconds);
    }
    this.routing.setLatencies(latencies, rackLatencySamples(this.masterRack, rate) / rate);
  }

  /**
   * Seconds between a clip's audio entering the graph and leaving it once every
   * path is aligned. The scheduler starts sources this much early, so effect
   * latency never moves audio against the picture.
   */
  getPlaybackLatencySeconds(): number {
    return this.routing.getTotalLatencySeconds();
  }

  /**
   * Mirrors the project's buses, track outputs and sends into the live graph.
   * Structural changes rewire the affected tracks; level/fader/rack/mute edits
   * only retarget AudioParams. Safe to call with every timeline change.
   */
  setRouting(timeline: Pick<Timeline, "tracks" | "audioBuses"> & { duration?: number }): void {
    this.routingTimeline = timeline;
    this.surroundTimeline = timeline;
    this.refreshSurroundPans();
    this.routingHorizon = Math.max(10, (timeline.duration ?? 0) + 30);
    const structural = this.routing.configure(timeline);
    this.refreshLatency();
    this.syncTrackAutomation(false);
    if (!structural) return;
    for (const trackId of this.trackNodes.keys()) this.wireTrackRouting(trackId, true);
  }

  /** Re-anchor bus fader / send automation to the playhead (play, seek). */
  syncRoutingAutomation(): void {
    this.routing.scheduleAutomation(this.masterClock.currentTime, this.routingHorizon, this.audioContext.currentTime);
    this.syncTrackAutomation(true);
  }

  /**
   * Track fader / pan lanes (Track.automation). They replace the rack fader / pan while they
   * play and are re-anchored to the playhead on play, seek and lane edits.
   */
  private syncTrackAutomation(force: boolean, timelineTime?: number): void {
    for (const track of this.routingTimeline.tracks) {
      const signature = JSON.stringify(track.automation ?? null);
      const known = this.trackAutomationSignature.get(track.id);
      if (!force && (known ?? "null") === signature) continue;
      this.trackAutomationSignature.set(track.id, signature);
      this.applyTrackAutomation(track.id, timelineTime);
    }
  }

  private applyTrackAutomation(trackId: string, timelineTime?: number): void {
    const nodes = this.trackNodes.get(trackId);
    const config = this.trackConfigs.get(trackId);
    if (!nodes || !config) return;
    const lanes = this.routingTimeline.tracks.find((t) => t.id === trackId)?.automation;
    const now = this.audioContext.currentTime;
    const hasVolume = (lanes?.volume?.length ?? 0) > 0;
    const hasPan = (lanes?.pan?.length ?? 0) > 0;
    const audible = isTrackAudible(config, this.hasSoloTracks);
    const time = timelineTime ?? this.masterClock.currentTime;
    const ctxStart = now + (this.trackLatencySeconds.get(trackId) ?? 0) - this.routing.getTotalLatencySeconds();
    if (hasVolume && audible && lanes?.volume) {
      scheduleVolumeAutomationOnGain(nodes.outputGain, lanes.volume, config.volume, time, this.routingHorizon, ctxStart);
    } else {
      nodes.outputGain.gain.cancelScheduledValues(now);
      nodes.outputGain.gain.setValueAtTime(audible ? config.volume : 0, now);
    }
    if ("pan" in nodes.panNode) {
      if (hasPan && lanes?.pan) {
        schedulePanAutomationOnParam(nodes.panNode.pan, lanes.pan, config.pan, time, this.routingHorizon, ctxStart);
      } else {
        nodes.panNode.pan.cancelScheduledValues(now);
        nodes.panNode.pan.setValueAtTime(Math.max(-1, Math.min(1, config.pan)), now);
      }
    }
  }

  /** Draft bus rack (fader, pan, effects) from the mixer; never touches history. */
  setBusRack(busId: string, rack: AudioRack | undefined): void {
    this.routing.previewBusRack(busId, rack);
  }

  getBusOutputGain(busId: string): GainNode | undefined {
    return this.routing.getBusOutput(busId);
  }

  getBusRackBus(busId: string): RackBusLike | undefined {
    return this.routing.getBusRackBus(busId);
  }

  private wireTrackRouting(trackId: string, rewire = false): void {
    const nodes = this.trackNodes.get(trackId);
    if (!nodes) return;
    const track = this.routingTimeline.tracks.find((t) => t.id === trackId);
    if (rewire) {
      nodes.outputGain.disconnect();
      try {
        nodes.panNode.disconnect(nodes.preFaderGate);
      } catch {
        /* the pre-fader tap was never connected */
      }
    }
    this.routing.connectTrackOutput(trackId, nodes.outputGain, track?.output);
    if (track && (track.sends?.length ?? 0) > 0) {
      nodes.panNode.connect(nodes.preFaderGate);
      this.routing.connectSends(track, nodes.preFaderGate, nodes.outputGain);
    } else this.routing.disconnectSends(trackId);
  }

  getTrackRackBus(trackId: string): RackBusLike | undefined {
    return this.trackNodes.get(trackId)?.rackBus;
  }

  getMasterRackBus(): RackBusLike {
    return this.masterBus;
  }

  /** Post-pan, post-volume and post-mute signal for a silent metering tap. */
  getTrackOutputGain(trackId: string): GainNode | undefined {
    return this.trackNodes.get(trackId)?.outputGain;
  }

  /** Set master volume from the mixer (1 = 0 dB, 4 = +12 dB). Persists across preview mute. */
  setMasterVolume(volume: number): void {
    this.masterVolumeOverride = Math.max(0, Math.min(4, volume));
    this.applyMasterGain();
  }

  /** Mute/unmute preview without changing mixer master volume. */
  setPreviewMuted(muted: boolean): void {
    this.previewMuted = muted;
    this.applyMasterGain();
  }

  private applyMasterGain(): void {
    const v = this.previewMuted ? 0 : this.masterVolumeOverride;
    this.masterGain.gain.setValueAtTime(v, this.audioContext.currentTime);
  }

  createTrack(config: TrackConfig): void {
    this.removeTrack(config.trackId);
    config.volume = this.trackVolumeOverrides.get(config.trackId) ?? config.volume;
    config.pan = this.trackPanOverrides.get(config.trackId) ?? config.pan;
    this.trackConfigs.set(config.trackId, config);

    const inputGain = this.audioContext.createGain();
    const panNode = this.surround ? this.audioContext.createGain() : this.audioContext.createStereoPanner();
    if ("pan" in panNode) panNode.pan.value = Math.max(-1, Math.min(1, config.pan));
    const outputGain = this.audioContext.createGain();
    outputGain.gain.value = config.volume;

    const {
      effectChainInput,
      effectChainOutput,
      allNodes,
      compressor,
      eqFilters,
      noiseReductionNodes,
      reverbNodes,
      delayNodes,
    } = this.buildEffectChain(config.effects, this.surround ? 6 : 2);

    const rackBus = createRackBus(this.audioContext, this.trackRacks.get(config.trackId), { live: true, surround: this.surround });
    inputGain.connect(effectChainInput);
    effectChainOutput.connect(rackBus.input);
    const preFaderGate = this.audioContext.createGain();
    rackBus.output.connect(panNode);
    panNode.connect(outputGain);

    const trackNode: TrackNodes = {
      ownedEffectNodes: allNodes,
      inputGain,
      effectChainInput,
      effectChainOutput,
      panNode,
      outputGain,
      compressor,
      eqFilters,
      noiseReductionNodes,
      reverbNodes,
      delayNodes,
      rackBus,
      preFaderGate,
    };

    this.trackNodes.set(config.trackId, trackNode);
    this.scheduledSources.set(config.trackId, []);
    this.refreshLatency();
    this.wireTrackRouting(config.trackId);
    this.updateTrackAudibility(config.trackId);
    this.updateSoloState();
  }

  /**
   * `channels` is what flows through the chain: the clip's own channel count for a clip chain, the mix's for the
   * track chain. Above two channels the stereo-only nodes (compressor, convolver) are replaced by linked
   * N-channel ones so a 5.1 clip is not folded to stereo.
   */
  private buildEffectChain(effects: Effect[], channels = 2): {
    allNodes: AudioNode[];
    tailSeconds: number;
    effectChainInput: AudioNode;
    effectChainOutput: AudioNode;
    compressor: DynamicsCompressorNode | null;
    eqFilters: BiquadFilterNode[];
    noiseReductionNodes: AudioNode[];
    reverbNodes: ReverbNodes | null;
    delayNodes: DelayNodes | null;
  } {
    const passthrough = pinChannels(this.audioContext.createGain(), channels);
    const allNodes: AudioNode[] = [passthrough];
    let tailSeconds = 0;
    let compressor: DynamicsCompressorNode | null = null;
    const eqFilters: BiquadFilterNode[] = [];
    const noiseReductionNodes: AudioNode[] = [];
    let reverbNodes: ReverbNodes | null = null;
    let delayNodes: DelayNodes | null = null;

    const enabledEffects = effects.filter((e) => e.enabled);
    if (enabledEffects.length === 0) {
      return {
        allNodes, tailSeconds,
        effectChainInput: passthrough,
        effectChainOutput: passthrough,
        compressor,
        eqFilters,
        noiseReductionNodes,
        reverbNodes,
        delayNodes,
      };
    }

    let currentNode: AudioNode = passthrough;
    let firstNode: AudioNode = passthrough;

    for (const effect of enabledEffects) {
      switch (effect.type) {
        case "gain": {
          const gain = this.audioContext.createGain();
          gain.gain.value = typeof effect.params.value === "number" ? effect.params.value : 1;
          currentNode.connect(gain);
          currentNode = gain;
          allNodes.push(gain);
          break;
        }
        case "compressor": {
          if (needsMultichannelNodes(channels)) {
            const stage = createLinkedCompressorStage(this.audioContext, effect.params as Record<string, number>, { channels });
            allNodes.push(...stage.nodes);
            currentNode.connect(stage.input);
            currentNode = stage.output;
            break;
          }
          compressor = this.createCompressorNode(effect);
          allNodes.push(compressor);
          currentNode.connect(compressor);
          currentNode = compressor;
          break;
        }
        case "eq": {
          const filters = this.createEQFilters(effect);
          if (filters.length > 0) {
            currentNode.connect(filters[0]);
            for (let i = 1; i < filters.length; i++) {
              filters[i - 1].connect(filters[i]);
            }
            currentNode = filters[filters.length - 1];
            eqFilters.push(...filters);
            allNodes.push(...filters);
          }
          break;
        }
        case "noiseReduction": {
          const chain = createNoiseReductionNodeChain(this.audioContext, effect);
          currentNode.connect(chain.input);
          currentNode = chain.output;
          noiseReductionNodes.push(...chain.nodes);
          allNodes.push(...chain.nodes);
          break;
        }
        case "deHum":
        case "deClick":
        case "deClip":
        case "deEss":
        case "deReverb":
        case "gate":
        case "brickwallLimiter":
        case "lowPass": {
          if (!isRepairEffectType(effect.type)) break;
          const chain = createRepairChainNode(
            this.audioContext,
            effect.type,
            sanitizeRepairParams(effect.type, effect.params) as RepairParams,
            { meterId: effect.id, channels },
          );
          currentNode.connect(chain.input);
          currentNode = chain.output;
          allNodes.push(...chain.nodes);
          break;
        }
        case "reverb": {
          reverbNodes = this.createReverbNodes(effect, channels);
          allNodes.push(...(Object.values(reverbNodes).flat() as AudioNode[]));
          if (reverbNodes.wetGain.gain.value > 0) tailSeconds += reverbNodes.convolver.buffer?.duration ?? 0;
          currentNode.connect(reverbNodes.inputGain);
          currentNode = reverbNodes.outputGain;
          break;
        }
        case "delay": {
          delayNodes = this.createDelayNodes(effect, channels);
          allNodes.push(...Object.values(delayNodes));
          if (delayNodes.wetGain.gain.value > 0) {
            const feedback = Math.abs(delayNodes.feedbackGain.gain.value);
            const repeats = feedback > 0 && feedback < 1 ? Math.ceil(Math.log(0.00000001) / Math.log(feedback)) : 1;
            tailSeconds += delayNodes.delayNode.delayTime.value * repeats;
          }
          currentNode.connect(delayNodes.inputGain);
          currentNode = delayNodes.outputGain;
          break;
        }
      }
    }

    return {
      allNodes, tailSeconds,
      effectChainInput: firstNode,
      effectChainOutput: currentNode,
      compressor,
      eqFilters,
      noiseReductionNodes,
      reverbNodes,
      delayNodes,
    };
  }

  private createCompressorNode(effect: Effect): DynamicsCompressorNode {
    const params = effect.params as Record<string, number>;
    const compressor = this.audioContext.createDynamicsCompressor();
    compressor.threshold.value = params.threshold ?? -24;
    compressor.ratio.value = params.ratio ?? 4;
    compressor.attack.value = params.attack ?? 0.003;
    compressor.release.value = params.release ?? 0.25;
    compressor.knee.value = params.knee ?? 30;
    return compressor;
  }

  private createEQFilters(effect: Effect): BiquadFilterNode[] {
    const params = effect.params as {
      bands?: Array<{
        type: string;
        frequency: number;
        gain: number;
        q: number;
      }>;
    };
    const bands = params.bands || [];
    const filters: BiquadFilterNode[] = [];

    for (const band of bands) {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = band.type as BiquadFilterType;
      filter.frequency.value = Math.max(20, Math.min(20000, band.frequency));
      filter.gain.value = Math.max(-24, Math.min(24, band.gain));
      filter.Q.value = Math.max(0.1, Math.min(18, band.q));
      filters.push(filter);
    }

    return filters;
  }

  private createReverbNodes(effect: Effect, channels = 2): ReverbNodes {
    const params = effect.params as Record<string, number>;
    const roomSize = params.roomSize ?? 0.5;
    const damping = params.damping ?? 0.5;
    const wetLevel = params.wetLevel ?? 0.5;
    const dryLevel = params.dryLevel ?? 0.7;

    const inputGain = pinChannels(this.audioContext.createGain(), channels);
    const dryGain = this.audioContext.createGain();
    const wetGain = this.audioContext.createGain();
    const outputGain = this.audioContext.createGain();

    dryGain.gain.value = dryLevel;
    wetGain.gain.value = wetLevel;

    const impulseResponse = this.getOrCreateImpulseResponse(roomSize, damping);

    inputGain.connect(dryGain);
    dryGain.connect(outputGain);
    if (needsMultichannelNodes(channels)) {
      // One mono convolver per channel: the stereo-only ConvolverNode would fold a 5.1 signal.
      const multi = createMultichannelConvolver(this.audioContext, impulseResponse, channels);
      inputGain.connect(multi.input);
      multi.output.connect(wetGain);
      wetGain.connect(outputGain);
      return { inputGain, dryGain, wetGain, convolver: multi.primary, outputGain, extraNodes: multi.nodes };
    }
    const convolver = this.audioContext.createConvolver();
    convolver.buffer = impulseResponse;
    inputGain.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(outputGain);

    return { inputGain, dryGain, wetGain, convolver, outputGain };
  }

  private getOrCreateImpulseResponse(
    roomSize: number,
    damping: number,
  ): AudioBuffer {
    const key = `${roomSize.toFixed(2)}_${damping.toFixed(2)}`;

    if (this.impulseResponseCache.has(key)) {
      return this.impulseResponseCache.get(key)!;
    }

    const sampleRate = this.audioContext.sampleRate;
    const duration = 0.5 + roomSize * 3.5;
    const length = Math.floor(sampleRate * duration);
    const channels = 2;

    const impulseBuffer = this.audioContext.createBuffer(
      channels,
      length,
      sampleRate,
    );

    for (let channel = 0; channel < channels; channel++) {
      const channelData = impulseBuffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        const decay = Math.exp((-3 * t) / duration);
        const noise = (Math.random() * 2 - 1) * decay;
        const dampingFactor = 1 - (damping * t) / duration;
        channelData[i] = noise * dampingFactor;
      }
    }

    this.impulseResponseCache.set(key, impulseBuffer);
    return impulseBuffer;
  }

  private createDelayNodes(effect: Effect, channels = 2): DelayNodes {
    const params = effect.params as Record<string, number>;
    const time = params.time ?? 0.5;
    const feedback = params.feedback ?? 0.3;
    const wetLevel = params.wetLevel ?? 0.5;

    const inputGain = pinChannels(this.audioContext.createGain(), channels);
    const delayNode = pinChannels(this.audioContext.createDelay(2), channels);
    const feedbackGain = this.audioContext.createGain();
    const wetGain = this.audioContext.createGain();
    const dryGain = this.audioContext.createGain();
    const outputGain = this.audioContext.createGain();

    delayNode.delayTime.value = Math.max(0, Math.min(2, time));
    feedbackGain.gain.value = Math.max(0, Math.min(0.95, feedback));
    wetGain.gain.value = wetLevel;
    dryGain.gain.value = 1 - wetLevel;

    inputGain.connect(dryGain);
    dryGain.connect(outputGain);
    inputGain.connect(delayNode);
    delayNode.connect(feedbackGain);
    feedbackGain.connect(delayNode);
    delayNode.connect(wetGain);
    wetGain.connect(outputGain);

    return { inputGain, delayNode, feedbackGain, wetGain, dryGain, outputGain };
  }

  removeTrack(trackId: string): void {
    const sources = this.scheduledSources.get(trackId);
    if (sources) {
      for (const scheduled of [...sources]) {
        try { scheduled.source.stop(); } catch { /* Already ended. */ }
        scheduled.release();
      }
    }
    this.scheduledSources.delete(trackId);

    const nodes = this.trackNodes.get(trackId);
    if (nodes) {
      nodes.inputGain.disconnect();
      nodes.rackBus.dispose();
      nodes.panNode.disconnect();
      nodes.outputGain.disconnect();
      nodes.preFaderGate.disconnect();
      this.routing.disconnectSends(trackId);
      this.routing.disconnectTrackOutput(trackId);
      for (const node of new Set(nodes.ownedEffectNodes)) node.disconnect();
    }
    this.trackNodes.delete(trackId);
    this.trackConfigs.delete(trackId);
    this.refreshLatency();
    this.updateSoloState();
  }

  updateTrackVolume(trackId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(4, volume));
    this.trackVolumeOverrides.set(trackId, clamped);
    const nodes = this.trackNodes.get(trackId);
    const config = this.trackConfigs.get(trackId);
    if (nodes && config) {
      config.volume = clamped;
      this.updateTrackAudibility(trackId);
    }
  }

  updateTrackPan(trackId: string, pan: number): void {
    const clamped = Math.max(-1, Math.min(1, pan));
    this.trackPanOverrides.set(trackId, clamped);
    const nodes = this.trackNodes.get(trackId);
    if (nodes && "pan" in nodes.panNode) {
      nodes.panNode.pan.setValueAtTime(
        clamped,
        this.audioContext.currentTime,
      );
    }
    const config = this.trackConfigs.get(trackId);
    if (config) {
      config.pan = clamped;
    }
  }

  getTrackVolume(trackId: string): number {
    const config = this.trackConfigs.get(trackId);
    return this.trackVolumeOverrides.get(trackId) ?? config?.volume ?? 1;
  }

  getTrackPan(trackId: string): number {
    const config = this.trackConfigs.get(trackId);
    return this.trackPanOverrides.get(trackId) ?? config?.pan ?? 0;
  }

  getMasterVolume(): number {
    return this.masterVolumeOverride;
  }

  setTrackMuted(trackId: string, muted: boolean): void {
    const config = this.trackConfigs.get(trackId);
    if (config) {
      config.muted = muted;
      this.updateTrackAudibility(trackId);
    }
  }

  setTrackSolo(trackId: string, solo: boolean): void {
    const config = this.trackConfigs.get(trackId);
    if (config) {
      config.solo = solo;
      this.updateSoloState();
    }
  }

  setTrackSoloSafe(trackId: string, soloSafe: boolean): void {
    const config = this.trackConfigs.get(trackId);
    if (config) {
      config.soloSafe = soloSafe;
      this.updateTrackAudibility(trackId);
    }
  }

  /**
   * Mirrors the timeline's mute/solo state into the graph without recreating existing tracks. Tracks are otherwise
   * only created when playback starts, so scrubbing (or a solo toggled after the last play) needs this to be audible correctly.
   */
  syncTrackStates(states: ReadonlyArray<{ trackId: string; muted: boolean; solo: boolean; soloSafe?: boolean }>): void {
    for (const state of states) {
      const config = this.trackConfigs.get(state.trackId);
      if (!config) {
        this.createTrack({ trackId: state.trackId, volume: 1, pan: 0, muted: state.muted, solo: state.solo, soloSafe: state.soloSafe === true, effects: [] });
        continue;
      }
      config.muted = state.muted;
      config.solo = state.solo;
      config.soloSafe = state.soloSafe === true;
    }
    this.updateSoloState();
  }

  private updateSoloState(): void {
    this.hasSoloTracks = Array.from(this.trackConfigs.values()).some(
      (c) => c.solo,
    );
    for (const trackId of this.trackNodes.keys()) {
      this.updateTrackAudibility(trackId);
    }
  }

  private updateTrackAudibility(trackId: string): void {
    const nodes = this.trackNodes.get(trackId);
    const config = this.trackConfigs.get(trackId);
    if (!nodes || !config) return;

    const audible = isTrackAudible(config, this.hasSoloTracks);

    const targetGain = audible ? config.volume : 0;
    nodes.outputGain.gain.setValueAtTime(
      targetGain,
      this.audioContext.currentTime,
    );
    nodes.preFaderGate.gain.setValueAtTime(audible ? 1 : 0, this.audioContext.currentTime);
    const lanes = this.routingTimeline.tracks.find((t) => t.id === trackId)?.automation;
    if (lanes?.volume?.length || lanes?.pan?.length || this.trackAutomationSignature.get(trackId) !== undefined && this.trackAutomationSignature.get(trackId) !== "null") {
      this.applyTrackAutomation(trackId);
    }
  }

  updateTrackEffects(trackId: string, effects: Effect[]): void {
    const config = this.trackConfigs.get(trackId);
    if (config) {
      if (JSON.stringify(config.effects) === JSON.stringify(effects)) {
        return;
      }
      config.effects = effects;
      this.createTrack(config);
    }
  }

  private stretchCache: StretchCache | null = null;
  private stretchRunner: StretchRunner | undefined;
  private stretchUnsubscribe: (() => void) | null = null;

  /** Test / host hook: replaces how stretches are computed (default: a Web Worker). */
  setStretchRunner(runner: StretchRunner | undefined): void {
    this.stretchRunner = runner;
    this.stretchUnsubscribe?.();
    this.stretchUnsubscribe = null;
    this.stretchCache = null;
  }

  private getStretchCache(): StretchCache {
    if (!this.stretchCache) {
      const makeBuffer = (channels: Float32Array[], sampleRate: number): AudioBuffer => {
        const out = this.audioContext.createBuffer(channels.length, Math.max(1, channels[0]?.length ?? 1), sampleRate);
        channels.forEach((data, c) => out.getChannelData(c).set(data));
        return out;
      };
      // An injected runner gets a private cache; otherwise the process-wide one (survives graph re-creation, shared with export).
      this.stretchCache = this.stretchRunner
        ? new StretchCache({ runner: this.stretchRunner, maxEntriesPerBuffer: 6, makeBuffer })
        : getSharedStretchCache(makeBuffer);
      this.stretchUnsubscribe = this.stretchCache.onReady((request) => this.swapToStretched(request));
    }
    return this.stretchCache;
  }

  private stretchRequestFor(schedule: AudioClipSchedule): StretchRequest | null {
    const speed = Number.isFinite(schedule.speed) && schedule.speed > 0 ? schedule.speed : 1;
    if (!shouldPreservePitch(speed, schedule.pitchCorrection)) return null;
    return {
      buffer: schedule.audioBuffer,
      speed,
      start: schedule.mediaOffset,
      end: schedule.mediaOffset + (schedule.endTime - schedule.startTime) * speed,
    };
  }

  /**
   * Cached pitch-preserving render of only the clip's used source range at `speed`. The stretch is computed
   * off the main thread: until it is ready this returns null and the caller plays the clip resampled
   * (playbackRate), so playback never waits; `swapToStretched` then replaces the playing source.
   */
  private getStretchedBuffer(request: StretchRequest): AudioBuffer | null {
    const cache = this.getStretchCache();
    const ready = cache.peek(request);
    if (ready) return ready;
    void cache.request(request);
    return null;
  }

  /** A stretch finished: rebuild every source that is still playing that clip resampled, with a short crossfade. */
  private swapToStretched(request: StretchRequest): void {
    if (!this.isPlaying || !this.masterClock.isPlaying) return;
    const rebuild: AudioClipSchedule[] = [];
    for (const sources of this.scheduledSources.values()) {
      for (const scheduled of [...sources]) {
        if (scheduled.stretched || scheduled.schedule.audioBuffer !== request.buffer) continue;
        const wanted = this.stretchRequestFor(scheduled.schedule);
        if (!wanted || wanted.speed !== request.speed || Math.abs(wanted.start - request.start) > 1e-4 || Math.abs(wanted.end - request.end) > 1e-4) continue;
        scheduled.retire(STRETCH_SWAP_FADE_SECONDS);
        rebuild.push(scheduled.spectralWait ?? scheduled.schedule);
      }
    }
    this.scheduleBatch(() => { for (const schedule of rebuild) this.scheduleClip(schedule, { fadeInSeconds: STRETCH_SWAP_FADE_SECONDS }); });
  }

  /**
   * One (audio-context time, timeline time) pair for a whole scheduling batch. Clips that start
   * "now" begin at the audio thread's next render quantum, so their media offsets must all be
   * computed from the same instant: reading the clock per clip lets the audio clock advance
   * between two clips of one batch (several ms on a starved main thread), which starts them with
   * offsets that disagree by that gap and leaves sibling tracks out of sync (and out of phase).
   */
  private scheduleAnchor: { contextTime: number; timelineTime: number } | null = null;

  private captureScheduleAnchor(): { contextTime: number; timelineTime: number } {
    // The clock derives from the context time, so re-read until both reads saw the same context time.
    let contextTime = this.audioContext.currentTime;
    let timelineTime = this.masterClock.currentTime;
    for (let attempt = 0; attempt < 8 && this.audioContext.currentTime !== contextTime; attempt++) {
      contextTime = this.audioContext.currentTime;
      timelineTime = this.masterClock.currentTime;
    }
    return { contextTime, timelineTime };
  }

  private scheduleBatch(run: () => void): void {
    if (this.scheduleAnchor) { run(); return; }
    this.scheduleAnchor = this.captureScheduleAnchor();
    try { run(); } finally { this.scheduleAnchor = null; }
  }

  /** The schedule with its source buffer swapped for the clip's channels (cached per buffer + map), so stretch, rebuilds and scrub grains all see them. */
  private withChannelMap(schedule: AudioClipSchedule): AudioClipSchedule {
    if (!schedule.channelMap) return schedule;
    const { channelMap, ...rest } = schedule;
    return { ...rest, audioBuffer: mapAudioBuffer(this.audioContext, schedule.audioBuffer, channelMap) };
  }

  private spectralCache: SpectralRepairCache | null = null;
  private spectralBackend: SpectralBackend | undefined;
  private spectralUnsubscribe: (() => void) | null = null;

  /** Test / host hook: replaces where spectral repairs are computed (default: a Web Worker). */
  setSpectralBackend(backend: SpectralBackend | undefined): void {
    this.spectralBackend = backend;
    this.spectralUnsubscribe?.();
    this.spectralUnsubscribe = null;
    this.spectralCache = null;
  }

  private getSpectralCache(): SpectralRepairCache {
    if (!this.spectralCache) {
      const makeBuffer = (channels: Float32Array[], sampleRate: number): AudioBuffer => {
        const out = this.audioContext.createBuffer(channels.length, Math.max(1, channels[0]?.length ?? 1), sampleRate);
        channels.forEach((data, c) => out.getChannelData(c).set(data));
        return out;
      };
      // An injected backend gets a private cache; otherwise the process-wide one (shared with the export mixdown).
      this.spectralCache = this.spectralBackend
        ? new SpectralRepairCache({ backend: this.spectralBackend, makeBuffer })
        : getSharedSpectralRepairCache(makeBuffer);
      this.spectralUnsubscribe = this.spectralCache.onReady((request) => this.swapToSpectral(request));
    }
    return this.spectralCache;
  }

  /**
   * The schedule with the clip's spectral repair applied to its source buffer (regions are source-time, so this
   * happens before the channel map, stretch and offsets). The repair is computed once off the main thread; until it
   * is ready the clip plays the unrepaired audio and `swapToSpectral` replaces it.
   */
  private withSpectralRepair(schedule: AudioClipSchedule): { schedule: AudioClipSchedule; waiting: boolean } {
    const regions = getSpectralRepairRegions(schedule.effects);
    if (regions.length === 0) return { schedule, waiting: false };
    const effects = schedule.effects.filter((effect) => effect.type !== SPECTRAL_REPAIR_EFFECT_TYPE);
    const request: SpectralRepairRequest = { buffer: schedule.audioBuffer, regions };
    const cache = this.getSpectralCache();
    const ready = cache.peek(request);
    if (ready) return { schedule: { ...schedule, audioBuffer: ready, effects }, waiting: false };
    void cache.request(request);
    return { schedule: { ...schedule, effects }, waiting: true };
  }

  /**
   * The source buffer with these clip effects' spectral repair applied (awaiting the cached, off-thread job) and the
   * effects without the spectral entry, so a preview can schedule the repaired audio straight away. `key` identifies the
   * regions that were applied ("" when none, or when the repair could not be computed and the graph falls back to the original).
   */
  async prepareSpectralRepair(buffer: AudioBuffer, effects: readonly Effect[]): Promise<{ buffer: AudioBuffer; effects: Effect[]; key: string }> {
    const regions = getSpectralRepairRegions(effects);
    if (regions.length === 0) return { buffer, effects: [...effects], key: "" };
    const repaired = await this.getSpectralCache().request({ buffer, regions });
    if (!repaired) return { buffer, effects: [...effects], key: "" };
    return { buffer: repaired, effects: effects.filter((effect) => effect.type !== SPECTRAL_REPAIR_EFFECT_TYPE), key: spectralRegionsKey(regions) };
  }

  /** A repair finished: rebuild every source still playing that clip unrepaired, with a short crossfade. */
  private swapToSpectral(request: SpectralRepairRequest): void {
    if (!this.isPlaying || !this.masterClock.isPlaying) return;
    const key = spectralRegionsKey(request.regions);
    const rebuild: AudioClipSchedule[] = [];
    for (const sources of this.scheduledSources.values()) {
      for (const scheduled of [...sources]) {
        const waiting = scheduled.spectralWait;
        if (!waiting || waiting.audioBuffer !== request.buffer || spectralRegionsKey(getSpectralRepairRegions(waiting.effects)) !== key) continue;
        scheduled.retire(STRETCH_SWAP_FADE_SECONDS);
        rebuild.push(waiting);
      }
    }
    this.scheduleBatch(() => { for (const schedule of rebuild) this.scheduleClip(schedule, { fadeInSeconds: STRETCH_SWAP_FADE_SECONDS }); });
  }

  scheduleClip(rawSchedule: AudioClipSchedule, options: { fadeInSeconds?: number } = {}): void {
    const spectral = this.withSpectralRepair(rawSchedule);
    const schedule = this.withChannelMap(spectral.schedule);
    if (!this.trackNodes.has(schedule.trackId)) {
      this.createTrack({ trackId: schedule.trackId, volume: 1, pan: 0, muted: false, solo: false, effects: [] });
    }
    const trackNodes = this.trackNodes.get(schedule.trackId);
    if (!trackNodes) return;
    const rawSpeed = Number.isFinite(schedule.speed) && schedule.speed > 0 ? schedule.speed : 1;
    const stretchRequest = this.stretchRequestFor(schedule);
    const stretched = stretchRequest ? this.getStretchedBuffer(stretchRequest) : null;
    const clipBuffer = stretched ?? schedule.audioBuffer;
    const enabledEffects = schedule.effects.filter((effect) => effect.enabled);
    const processingEffects = enabledEffects.filter((effect) => effect.type !== "pan" && effect.type !== "fadeIn" && effect.type !== "fadeOut" && effect.type !== SPECTRAL_REPAIR_EFFECT_TYPE);
    const chain = processingEffects.length > 0 ? this.buildEffectChain(processingEffects, Math.max(1, clipBuffer.numberOfChannels)) : null;
    const source = this.audioContext.createBufferSource();
    source.buffer = clipBuffer;
    const speed = stretched ? 1 : rawSpeed;
    source.playbackRate.value = speed;
    const clipGain = this.audioContext.createGain();
    const fadeGain = this.audioContext.createGain();
    // Last stage before the panner: only moves when this source is swapped for a rebuilt one.
    const swapGain = this.audioContext.createGain();
    // 5.1: the surround panner (mono/stereo positioned, 5.1 passed through) instead of the stereo panner.
    const panner = this.surround
      ? createSurroundPanner(this.audioContext, clipBuffer.numberOfChannels, this.surroundPanFor(schedule.clipId, schedule.trackId))
      : undefined;
    const clipPan = panner ? panner.input : this.audioContext.createStereoPanner();
    let basePan = 0;
    if (!panner) {
      basePan = enabledEffects.some((effect) => effect.type === "pan")
        ? getPanFromAudioEffects(enabledEffects) : Math.max(-1, Math.min(1, schedule.pan));
      (clipPan as StereoPannerNode).pan.value = basePan;
    }
    if (chain) { source.connect(chain.effectChainInput); chain.effectChainOutput.connect(clipGain); }
    else source.connect(clipGain);
    clipGain.connect(fadeGain); fadeGain.connect(swapGain); swapGain.connect(clipPan);
    (panner ? panner.output : clipPan).connect(trackNodes.inputGain);
    const ownedNodes = new Set<AudioNode>([source, clipGain, fadeGain, swapGain, clipPan]);
    if (chain) for (const node of chain.allNodes) ownedNodes.add(node);
    let released = false, tailTimer: ReturnType<typeof setTimeout> | undefined;
    let scheduled: ScheduledSource | undefined = undefined;
    const release = () => {
      if (released) return;
      released = true; if (tailTimer !== undefined) clearTimeout(tailTimer);
      panner?.dispose();
      for (const node of ownedNodes) { try { node.disconnect(); } catch { /* Already disconnected. */ } }
      const sources = this.scheduledSources.get(schedule.trackId);
      if (sources && scheduled) { const index = sources.indexOf(scheduled); if (index >= 0) sources.splice(index, 1); }
    };
    const duration = schedule.endTime - schedule.startTime;
    // Latency compensation: the clip's own effect chain and the track/bus path
    // after it delay the sound, so the source runs `lead` early (or, when the
    // clip is already playing, starts `lead` further into the media). With no
    // lookahead effects `lead` is 0 and this is the plain schedule.
    const chainLatency = chain ? effectChainLatencySamples(processingEffects, this.audioContext.sampleRate || 48000) / (this.audioContext.sampleRate || 48000) : 0;
    const lead = this.routing.getTotalLatencySeconds() + chainLatency;
    const anchor = this.scheduleAnchor ?? this.captureScheduleAnchor();
    // Clips already under the playhead start SCHEDULE_START_LOOKAHEAD_SECONDS ahead of the anchor, at an
    // explicit context time, with their offset advanced by the same amount. A start("now") takes effect at
    // whichever render quantum the audio thread reaches when it handles that message, so two clips
    // scheduled in one batch can land quanta apart (2.7 ms each) and play out of phase; an explicit time
    // keeps them sample-aligned to each other and to the timeline as long as the batch finishes inside it.
    const effectiveNow = anchor.timelineTime + lead + SCHEDULE_START_LOOKAHEAD_SECONDS;
    const clipOffset = Math.max(0, effectiveNow - schedule.startTime);
    // The stretched render starts at the clip's first used source sample.
    const mediaOffset = stretched ? 0 : schedule.mediaOffset;
    const sourceOffset = clipOffset * speed + mediaOffset;
    const playbackDuration = Math.min(duration - clipOffset, (clipBuffer.duration - sourceOffset) / speed);
    const startsLater = schedule.startTime > effectiveNow;
    const sourceStartTime = anchor.contextTime + SCHEDULE_START_LOOKAHEAD_SECONDS + Math.max(0, schedule.startTime - effectiveNow);
    // Gains and fades sit after the clip chain: they see the signal chainLatency later.
    const playbackStartTime = sourceStartTime + chainLatency;
    if (!(playbackDuration > 0) || !Number.isFinite(playbackDuration)) { release(); return; }
    scheduleVolumeAutomationOnGain(clipGain, schedule.volumeAutomation, schedule.volume, clipOffset, playbackDuration, playbackStartTime);
    if (!panner) schedulePanAutomationOnParam((clipPan as StereoPannerNode).pan, schedule.panAutomation, basePan, clipOffset, playbackDuration, playbackStartTime);
    scheduleClipFadeEnvelope(fadeGain.gain, { startTime: playbackStartTime, clipOffset,
      rangeDuration: playbackDuration, clipDuration: duration, fadeIn: schedule.fadeIn, fadeOut: schedule.fadeOut,
      fadeOrigin: schedule.fadeOrigin, transitionFadeIn: schedule.transitionFadeIn, transitionFadeOut: schedule.transitionFadeOut });
    if (options.fadeInSeconds && !startsLater) {
      swapGain.gain.setValueAtTime(0, playbackStartTime);
      swapGain.gain.linearRampToValueAtTime(1, playbackStartTime + options.fadeInSeconds);
    }
    source.start(sourceStartTime, sourceOffset, playbackDuration * speed);
    // Shared by natural end and the stretch swap: effect tails (reverb, delay) ring out instead of being cut.
    const onSourceEnded = () => {
      if (released) return;
      const tail = chain?.tailSeconds ?? 0;
      if (tail > 0) { source.disconnect(); ownedNodes.delete(source); tailTimer = setTimeout(release, tail * 1000); }
      else release();
    };
    const retire = (seconds: number) => {
      if (released) return;
      const now = this.audioContext.currentTime;
      const list = this.scheduledSources.get(schedule.trackId);
      const at = list && scheduled ? list.indexOf(scheduled) : -1;
      if (list && at >= 0) list.splice(at, 1);
      swapGain.gain.cancelScheduledValues(now);
      swapGain.gain.setValueAtTime(1, now);
      swapGain.gain.linearRampToValueAtTime(0, now + seconds);
      try { source.stop(now + seconds + 0.005); } catch { /* Already ended. */ }
      source.onended = onSourceEnded;
    };
    scheduled = { clipId: schedule.clipId, trackId: schedule.trackId, panner, source, startedAt: schedule.startTime, duration: playbackDuration, release,
      schedule, stretched: !!stretched, retire, ...(spectral.waiting ? { spectralWait: rawSchedule } : {}) };
    const sources = this.scheduledSources.get(schedule.trackId) ?? [];
    sources.push(scheduled); this.scheduledSources.set(schedule.trackId, sources);
    source.onended = onSourceEnded;
  }

  private scrubGrains: Array<{ source: AudioBufferSourceNode; gain: GainNode; release: () => void }> = [];

  /**
   * Audible scrubbing: plays a short enveloped grain of each clip sounding at `time` through its track,
   * so track mute / solo / fader / automation apply exactly as in playback. Independent of the scheduler and the
   * master clock (they stay paused). Clip effects are not applied to grains. Reversed clips are not supported.
   * Returns how many grains started.
   */
  playScrubGrains(schedules: readonly AudioClipSchedule[], time: number, grainSeconds: number = SCRUB_GRAIN_SECONDS): number {
    const planned = planScrubGrains(schedules, time, grainSeconds);
    if (planned.length === 0) return 0;
    if (this.routingTimeline.tracks.some((t) => t.automation?.volume?.length || t.automation?.pan?.length)) {
      // The playhead is not where the (paused) clock says: place track automation at the scrub position.
      this.syncTrackAutomation(true, time);
    }
    const now = this.audioContext.currentTime;
    let started = 0;
    for (const grain of planned) {
      const { schedule } = grain;
      if (!this.trackNodes.has(schedule.trackId)) {
        this.createTrack({ trackId: schedule.trackId, volume: 1, pan: 0, muted: false, solo: false, effects: [] });
      }
      const trackNodes = this.trackNodes.get(schedule.trackId);
      if (!trackNodes) continue;
      while (this.scrubGrains.length >= SCRUB_MAX_GRAINS) this.scrubGrains[0].release();
      const source = this.audioContext.createBufferSource();
      source.buffer = this.withChannelMap(schedule).audioBuffer;
      const speed = Number.isFinite(schedule.speed) && schedule.speed > 0 ? schedule.speed : 1;
      source.playbackRate.value = speed;
      const gain = this.audioContext.createGain();
      const edge = Math.min(0.01, grain.duration / 4);
      const level = Math.max(0, Math.min(4, schedule.volume));
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + edge);
      gain.gain.setValueAtTime(level, now + Math.max(edge, grain.duration - edge));
      gain.gain.linearRampToValueAtTime(0, now + grain.duration);
      const panner = this.surround ? null : this.audioContext.createStereoPanner();
      if (panner) panner.pan.value = Math.max(-1, Math.min(1, schedule.pan));
      source.connect(gain);
      if (panner) { gain.connect(panner); panner.connect(trackNodes.inputGain); } else gain.connect(trackNodes.inputGain);
      let released = false;
      const entry = {
        source,
        gain,
        release: () => {
          if (released) return;
          released = true;
          try { source.stop(); } catch { /* Already ended. */ }
          for (const node of [source, gain, panner]) { try { node?.disconnect(); } catch { /* Already disconnected. */ } }
          const at = this.scrubGrains.indexOf(entry);
          if (at >= 0) this.scrubGrains.splice(at, 1);
        },
      };
      source.onended = entry.release;
      this.scrubGrains.push(entry);
      source.start(now, grain.sourceOffset, grain.sourceDuration);
      started += 1;
    }
    return started;
  }

  stopScrubGrains(): void {
    for (const grain of [...this.scrubGrains]) grain.release();
  }

  scheduleClips(schedules: AudioClipSchedule[]): void {
    this.scheduleBatch(() => { for (const schedule of schedules) this.scheduleClip(schedule); });
  }

  stopAllClips(): void {
    for (const [, sources] of this.scheduledSources) {
      for (const scheduled of [...sources]) {
        try { scheduled.source.stop(); } catch { /* Already ended. */ }
        scheduled.release();
      }
      sources.length = 0;
    }
  }

  stopClip(clipId: string): void {
    for (const [, sources] of this.scheduledSources) {
      const index = sources.findIndex((s) => s.clipId === clipId);
      if (index > -1) {
        const scheduled = sources[index];
        try {
          scheduled.source.stop();
        } catch { /* Already ended. */ }
        scheduled.release();
        break;
      }
    }
  }

  async resume(): Promise<void> {
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  async suspend(): Promise<void> {
    this.stopAllClips();
    if (this.audioContext.state === "running") {
      await this.audioContext.suspend();
    }
  }

  startScheduler(getClipsAtTime: (time: number) => AudioClipSchedule[]): void {
    if (this.schedulerIntervalId !== null) return;

    this.isPlaying = true;
    if (!this.seekPending) {
      this.lastScheduledTime = this.masterClock.currentTime;
    }
    this.seekPending = false;
    this.syncRoutingAutomation();

    const scheduleAudio = () => {
      if (!this.isPlaying || !this.masterClock.isPlaying) return;

      const currentTime = this.masterClock.currentTime;
      const scheduleUntil = currentTime + this.scheduleAheadTime;

      if (scheduleUntil > this.lastScheduledTime) {
        const clips = getClipsAtTime(this.lastScheduledTime);
        this.scheduleBatch(() => { for (const clip of clips) {
          if (
            clip.startTime <= scheduleUntil &&
            clip.endTime > this.lastScheduledTime
          ) {
            const existingSources =
              this.scheduledSources.get(clip.trackId) || [];
            const alreadyScheduled = existingSources.some(
              (s) => s.clipId === clip.clipId,
            );
            if (!alreadyScheduled) {
              this.scheduleClip(clip);
            }
          }
        } });
        this.lastScheduledTime = scheduleUntil;
      }
    };

    this.scheduleAudioNow = scheduleAudio;
    this.schedulerIntervalId = window.setInterval(scheduleAudio, 100);
    scheduleAudio();
  }

  stopScheduler(): void {
    this.isPlaying = false;
    this.scheduleAudioNow = null;
    if (this.schedulerIntervalId !== null) {
      window.clearInterval(this.schedulerIntervalId);
      this.schedulerIntervalId = null;
    }
    this.stopAllClips();
  }

  seekTo(time: number): void {
    this.stopAllClips();
    this.routing.scheduleAutomation(time, this.routingHorizon, this.audioContext.currentTime);
    this.syncTrackAutomation(true, time);
    this.lastScheduledTime = time;
    this.seekPending = true;
    if (this.isPlaying && this.masterClock.isPlaying && this.scheduleAudioNow) {
      // Loop wraps and playing seeks must replace stopped sources immediately,
      // rather than leaving silence until the next 100 ms scheduler tick.
      this.seekPending = false;
      this.scheduleAudioNow();
    }
  }

  dispose(): void {
    this.stopScrubGrains();
    this.stretchUnsubscribe?.();
    this.stretchUnsubscribe = null;
    this.stretchCache = null;
    this.spectralUnsubscribe?.();
    this.spectralUnsubscribe = null;
    this.spectralCache = null;
    this.stopScheduler();
    for (const trackId of Array.from(this.trackNodes.keys())) {
      this.removeTrack(trackId);
    }
    this.impulseResponseCache.clear();
    this.routing.dispose();
    this.masterBus.dispose();
    this.masterGain.disconnect();
    this.masterOutput.disconnect();
    getAudioOutputRouter().detach(this.audioContext);
  }
}

let realtimeAudioGraphInstance: RealtimeAudioGraph | null = null;

export function getRealtimeAudioGraph(): RealtimeAudioGraph {
  if (!realtimeAudioGraphInstance) {
    realtimeAudioGraphInstance = new RealtimeAudioGraph();
  }
  return realtimeAudioGraphInstance;
}

export function initializeRealtimeAudioGraph(
  masterClock?: MasterTimelineClock,
): RealtimeAudioGraph {
  if (realtimeAudioGraphInstance) {
    realtimeAudioGraphInstance.dispose();
  }
  realtimeAudioGraphInstance = new RealtimeAudioGraph(masterClock);
  return realtimeAudioGraphInstance;
}
