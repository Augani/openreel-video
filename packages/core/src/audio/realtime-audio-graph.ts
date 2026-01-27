import {
  getMasterClock,
  MasterTimelineClock,
} from "../playback/master-timeline-clock";
import type { Effect } from "../types/timeline";

export interface AudioClipSchedule {
  clipId: string;
  trackId: string;
  audioBuffer: AudioBuffer;
  startTime: number;
  endTime: number;
  mediaOffset: number;
  volume: number;
  pan: number;
  effects: Effect[];
  speed: number;
}

export interface TrackConfig {
  trackId: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  effects: Effect[];
}

interface ScheduledSource {
  clipId: string;
  source: AudioBufferSourceNode;
  startedAt: number;
  duration: number;
}

interface ReverbNodes {
  inputGain: GainNode;
  dryGain: GainNode;
  wetGain: GainNode;
  convolver: ConvolverNode;
  outputGain: GainNode;
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
  inputGain: GainNode;
  effectChainInput: AudioNode;
  effectChainOutput: AudioNode;
  panNode: StereoPannerNode;
  outputGain: GainNode;
  compressor: DynamicsCompressorNode | null;
  eqFilters: BiquadFilterNode[];
  reverbNodes: ReverbNodes | null;
  delayNodes: DelayNodes | null;
}

export class RealtimeAudioGraph {
  private audioContext: AudioContext;
  private masterClock: MasterTimelineClock;
  private masterGain: GainNode;
  private trackNodes: Map<string, TrackNodes> = new Map();
  private scheduledSources: Map<string, ScheduledSource[]> = new Map();
  private trackConfigs: Map<string, TrackConfig> = new Map();
  private hasSoloTracks = false;
  private impulseResponseCache: Map<string, AudioBuffer> = new Map();
  private isPlaying = false;
  private lastScheduledTime = 0;
  private scheduleAheadTime = 0.2;
  private schedulerIntervalId: number | null = null;

  constructor(masterClock?: MasterTimelineClock) {
    this.masterClock = masterClock || getMasterClock();
    this.audioContext = this.masterClock.getAudioContext();
    this.masterGain = this.audioContext.createGain();
    this.masterGain.connect(this.audioContext.destination);
  }

  getAudioContext(): AudioContext {
    return this.audioContext;
  }

  getMasterGain(): GainNode {
    return this.masterGain;
  }

  setMasterVolume(volume: number): void {
    this.masterGain.gain.setValueAtTime(
      Math.max(0, Math.min(4, volume)),
      this.audioContext.currentTime,
    );
  }

  createTrack(config: TrackConfig): void {
    this.removeTrack(config.trackId);
    this.trackConfigs.set(config.trackId, config);

    const inputGain = this.audioContext.createGain();
    const panNode = this.audioContext.createStereoPanner();
    panNode.pan.value = Math.max(-1, Math.min(1, config.pan));
    const outputGain = this.audioContext.createGain();
    outputGain.gain.value = config.volume;

    const {
      effectChainInput,
      effectChainOutput,
      compressor,
      eqFilters,
      reverbNodes,
      delayNodes,
    } = this.buildEffectChain(config.effects);

    inputGain.connect(effectChainInput);
    effectChainOutput.connect(panNode);
    panNode.connect(outputGain);
    outputGain.connect(this.masterGain);

    const trackNode: TrackNodes = {
      inputGain,
      effectChainInput,
      effectChainOutput,
      panNode,
      outputGain,
      compressor,
      eqFilters,
      reverbNodes,
      delayNodes,
    };

    this.trackNodes.set(config.trackId, trackNode);
    this.scheduledSources.set(config.trackId, []);
    this.updateTrackAudibility(config.trackId);
    this.updateSoloState();
  }

  private buildEffectChain(effects: Effect[]): {
    effectChainInput: AudioNode;
    effectChainOutput: AudioNode;
    compressor: DynamicsCompressorNode | null;
    eqFilters: BiquadFilterNode[];
    reverbNodes: ReverbNodes | null;
    delayNodes: DelayNodes | null;
  } {
    const passthrough = this.audioContext.createGain();
    let compressor: DynamicsCompressorNode | null = null;
    const eqFilters: BiquadFilterNode[] = [];
    let reverbNodes: ReverbNodes | null = null;
    let delayNodes: DelayNodes | null = null;

    const enabledEffects = effects.filter((e) => e.enabled);
    if (enabledEffects.length === 0) {
      return {
        effectChainInput: passthrough,
        effectChainOutput: passthrough,
        compressor,
        eqFilters,
        reverbNodes,
        delayNodes,
      };
    }

    let currentNode: AudioNode = passthrough;
    let firstNode: AudioNode = passthrough;

    for (const effect of enabledEffects) {
      switch (effect.type) {
        case "compressor": {
          compressor = this.createCompressorNode(effect);
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
          }
          break;
        }
        case "reverb": {
          reverbNodes = this.createReverbNodes(effect);
          currentNode.connect(reverbNodes.inputGain);
          currentNode = reverbNodes.outputGain;
          break;
        }
        case "delay": {
          delayNodes = this.createDelayNodes(effect);
          currentNode.connect(delayNodes.inputGain);
          currentNode = delayNodes.outputGain;
          break;
        }
      }
    }

    return {
      effectChainInput: firstNode,
      effectChainOutput: currentNode,
      compressor,
      eqFilters,
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

  private createReverbNodes(effect: Effect): ReverbNodes {
    const params = effect.params as Record<string, number>;
    const roomSize = params.roomSize ?? 0.5;
    const damping = params.damping ?? 0.5;
    const wetLevel = params.wetLevel ?? 0.5;
    const dryLevel = params.dryLevel ?? 0.7;

    const inputGain = this.audioContext.createGain();
    const dryGain = this.audioContext.createGain();
    const wetGain = this.audioContext.createGain();
    const convolver = this.audioContext.createConvolver();
    const outputGain = this.audioContext.createGain();

    dryGain.gain.value = dryLevel;
    wetGain.gain.value = wetLevel;

    const impulseResponse = this.getOrCreateImpulseResponse(roomSize, damping);
    convolver.buffer = impulseResponse;

    inputGain.connect(dryGain);
    dryGain.connect(outputGain);
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

  private createDelayNodes(effect: Effect): DelayNodes {
    const params = effect.params as Record<string, number>;
    const time = params.time ?? 0.5;
    const feedback = params.feedback ?? 0.3;
    const wetLevel = params.wetLevel ?? 0.5;

    const inputGain = this.audioContext.createGain();
    const delayNode = this.audioContext.createDelay(2);
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
      for (const scheduled of sources) {
        try {
          scheduled.source.stop();
          scheduled.source.disconnect();
        } catch {}
      }
    }
    this.scheduledSources.delete(trackId);

    const nodes = this.trackNodes.get(trackId);
    if (nodes) {
      nodes.inputGain.disconnect();
      nodes.panNode.disconnect();
      nodes.outputGain.disconnect();
      if (nodes.compressor) nodes.compressor.disconnect();
      for (const filter of nodes.eqFilters) filter.disconnect();
      if (nodes.reverbNodes) {
        nodes.reverbNodes.inputGain.disconnect();
        nodes.reverbNodes.dryGain.disconnect();
        nodes.reverbNodes.wetGain.disconnect();
        nodes.reverbNodes.convolver.disconnect();
        nodes.reverbNodes.outputGain.disconnect();
      }
      if (nodes.delayNodes) {
        nodes.delayNodes.inputGain.disconnect();
        nodes.delayNodes.delayNode.disconnect();
        nodes.delayNodes.feedbackGain.disconnect();
        nodes.delayNodes.wetGain.disconnect();
        nodes.delayNodes.dryGain.disconnect();
        nodes.delayNodes.outputGain.disconnect();
      }
    }
    this.trackNodes.delete(trackId);
    this.trackConfigs.delete(trackId);
    this.updateSoloState();
  }

  updateTrackVolume(trackId: string, volume: number): void {
    const nodes = this.trackNodes.get(trackId);
    const config = this.trackConfigs.get(trackId);
    if (nodes && config) {
      config.volume = Math.max(0, Math.min(4, volume));
      this.updateTrackAudibility(trackId);
    }
  }

  updateTrackPan(trackId: string, pan: number): void {
    const nodes = this.trackNodes.get(trackId);
    if (nodes) {
      nodes.panNode.pan.setValueAtTime(
        Math.max(-1, Math.min(1, pan)),
        this.audioContext.currentTime,
      );
    }
    const config = this.trackConfigs.get(trackId);
    if (config) {
      config.pan = pan;
    }
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

    let audible = true;
    if (config.muted) {
      audible = false;
    } else if (this.hasSoloTracks && !config.solo) {
      audible = false;
    }

    const targetGain = audible ? config.volume : 0;
    nodes.outputGain.gain.setValueAtTime(
      targetGain,
      this.audioContext.currentTime,
    );
  }

  updateTrackEffects(trackId: string, effects: Effect[]): void {
    const config = this.trackConfigs.get(trackId);
    if (config) {
      config.effects = effects;
      this.createTrack(config);
    }
  }

  scheduleClip(schedule: AudioClipSchedule): void {
    const existingNodes = this.trackNodes.get(schedule.trackId);
    const existingConfig = this.trackConfigs.get(schedule.trackId);

    if (!existingNodes) {
      this.createTrack({
        trackId: schedule.trackId,
        volume: schedule.volume,
        pan: schedule.pan,
        muted: false,
        solo: false,
        effects: schedule.effects,
      });
    } else if (
      existingConfig &&
      JSON.stringify(existingConfig.effects) !==
        JSON.stringify(schedule.effects)
    ) {
      this.updateTrackEffects(schedule.trackId, schedule.effects);
    }

    const trackNodes = this.trackNodes.get(schedule.trackId);
    if (!trackNodes) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = schedule.audioBuffer;
    source.playbackRate.value = schedule.speed;

    const clipGain = this.audioContext.createGain();
    clipGain.gain.value = schedule.volume;

    source.connect(clipGain);
    clipGain.connect(trackNodes.inputGain);

    const contextStartTime =
      this.audioContext.currentTime +
      schedule.startTime -
      this.masterClock.currentTime;
    const duration = schedule.endTime - schedule.startTime;

    if (contextStartTime > this.audioContext.currentTime) {
      source.start(contextStartTime, schedule.mediaOffset, duration);
    } else {
      const offset =
        this.masterClock.currentTime -
        schedule.startTime +
        schedule.mediaOffset;
      const remainingDuration =
        duration - (this.masterClock.currentTime - schedule.startTime);
      if (remainingDuration > 0 && offset < schedule.audioBuffer.duration) {
        source.start(0, offset, remainingDuration);
      }
    }

    const scheduled: ScheduledSource = {
      clipId: schedule.clipId,
      source,
      startedAt: schedule.startTime,
      duration,
    };

    const sources = this.scheduledSources.get(schedule.trackId) || [];
    sources.push(scheduled);
    this.scheduledSources.set(schedule.trackId, sources);

    source.onended = () => {
      const trackSources = this.scheduledSources.get(schedule.trackId);
      if (trackSources) {
        const index = trackSources.indexOf(scheduled);
        if (index > -1) {
          trackSources.splice(index, 1);
        }
      }
    };
  }

  scheduleClips(schedules: AudioClipSchedule[]): void {
    for (const schedule of schedules) {
      this.scheduleClip(schedule);
    }
  }

  stopAllClips(): void {
    for (const [, sources] of this.scheduledSources) {
      for (const scheduled of sources) {
        try {
          scheduled.source.stop();
          scheduled.source.disconnect();
        } catch {}
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
          scheduled.source.disconnect();
        } catch {}
        sources.splice(index, 1);
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
    this.lastScheduledTime = this.masterClock.currentTime;

    const scheduleAudio = () => {
      if (!this.isPlaying) return;

      const currentTime = this.masterClock.currentTime;
      const scheduleUntil = currentTime + this.scheduleAheadTime;

      if (scheduleUntil > this.lastScheduledTime) {
        const clips = getClipsAtTime(this.lastScheduledTime);
        for (const clip of clips) {
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
        }
        this.lastScheduledTime = scheduleUntil;
      }
    };

    this.schedulerIntervalId = window.setInterval(scheduleAudio, 100);
    scheduleAudio();
  }

  stopScheduler(): void {
    this.isPlaying = false;
    if (this.schedulerIntervalId !== null) {
      window.clearInterval(this.schedulerIntervalId);
      this.schedulerIntervalId = null;
    }
    this.stopAllClips();
  }

  seekTo(time: number): void {
    this.stopAllClips();
    this.lastScheduledTime = time;
  }

  dispose(): void {
    this.stopScheduler();
    for (const trackId of Array.from(this.trackNodes.keys())) {
      this.removeTrack(trackId);
    }
    this.impulseResponseCache.clear();
    this.masterGain.disconnect();
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

export function disposeRealtimeAudioGraph(): void {
  if (realtimeAudioGraphInstance) {
    realtimeAudioGraphInstance.dispose();
    realtimeAudioGraphInstance = null;
  }
}
