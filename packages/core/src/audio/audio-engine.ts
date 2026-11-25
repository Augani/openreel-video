import type { Timeline, Track, Clip, Effect } from "../types/timeline";
import { hasAnySoloedTrack, isTrackAudible } from "./track-audibility";
import type { AudioEffectParams } from "../types/effects";
import type { MediaItem, Project } from "../types/project";
import type {
  AudioEngineConfig,
  AudioTrackRenderInfo,
  AudioClipRenderInfo,
  AudioChannelState,
  RenderedAudio,
  LoudnessMetrics,
  TimeRange,
} from "./types";
import { DEFAULT_AUDIO_CONFIG } from "./types";
import { AudioEffectsEngine } from "./audio-effects-engine";
import { ensureRepairWorklet } from "./repair/repair-node";
import { hasModulatedCreativeFx, offlineClipChainClockOffset, resampleToTimelineRate } from "./clip-chain-clock";
import { ensureCreativeFxWorklet } from "./creative/creative-fx-node";
import { projectUsesCreativeFx } from "./creative/creative-fx-usage";
import { MASTER_OWNER, SidechainKeyHub, timelineHasSidechain } from "./sidechain";
import { isRepairEffectType } from "./repair/repair-dsp";
import { projectUsesRepairEffects, repairWarmupSeconds } from "./repair/repair-definitions";
import {
  getPanFromAudioEffects,
  splitProfileAwareNoiseReductionEffects,
} from "./audio-effect-routing";
import { resolveClipAudioEffects } from "./clip-audio-effects";
import {
  resolveClipPanAutomation,
  resolveClipPitchCorrection,
  resolveClipVolumeAutomation,
} from "./clip-audio-resolution";
import { scheduleVolumeAutomationOnGain } from "./clip-volume-automation";
import { schedulePanAutomationOnParam } from "./clip-pan-automation";
import { shouldPreservePitch, timeStretchChannels } from "./time-stretch";
import { getSharedStretchCache } from "./stretch-cache";
import { getSharedSpectralRepairCache } from "./spectral/spectral-repair-cache";
import { SPECTRAL_REPAIR_EFFECT_TYPE, getSpectralRepairRegions, type SpectralRegion } from "./spectral/spectral-regions";
import { ENHANCE_SPEECH_EFFECT_TYPE, getEnhanceSpeechBalance, getEnhanceSpeechMix } from "./enhance/enhance-effect";
import { REDUCE_REVERB_EFFECT_TYPE, getReduceReverbParams, hasReduceReverb } from "./reverb/reverb-effect";
import { getSharedReduceReverbCache } from "./reverb/reverb-cache";
import type { ReduceReverbParams } from "./reverb/reverb-params";
import { getSharedEnhanceSpeechCache } from "./enhance/enhance-cache";
import { NATIVE_PLUGIN_EFFECT_TYPE, hasNativePlugins, nativePluginSteps } from "./native-plugin/native-plugin-effect";
import { getNativePluginBackend, getSharedNativePluginCache } from "./native-plugin/native-plugin-cache";
import { MASTER_RACK_TARGET, activePluginRackTargets, applyRackStemsToTimeline, isSunkTrack, rackStemTrackId, projectHasPluginRacks, timelineHasClipPreviewBypass } from "./native-plugin/native-plugin-rack";
import { resolveRackStems, stemmedTargets, type RackStemResult } from "./native-plugin/rack-stems";
import { audioRangeFingerprint } from "./mixdown-cache";
import { hasAudioRouting, getAudioBuses } from "./audio-routing";
import { AudioRoutingGraph, buildOfflineTrackChain } from "./audio-routing-graph";
import { planTimelineDelayCompensation, rackLatencySamples } from "./effect-latency";
import { scheduleClipFadeEnvelope } from "./clip-fade-envelope";
import { getTrackTransitionAudioFades } from "./transition-audio-fades";
import { channelMapNeedsWideSource, mapAudioBuffer, resolveClipChannelMap, wideDecodeChannels, type ClipChannelMap } from "./channel-map";
import { createSurroundPanner, fallbackDecodeChannels, isSurroundLayout, mixChannelCount, resolveSurroundPan } from "./surround";
import {
  createRackBus,
  rackHasAutomation,
  estimateRackTailSeconds,
  rackHasProcessing,
  rackVolume,
} from "./track-audio-rack";
import {
  getCompoundClipId,
  getProjectClipCapabilities,
  trackHasAudioItems,
} from "../timeline/timeline-items";

interface AudioRenderOptions { preview?: boolean }

/**
 * Sources whose decoded PCM would exceed this are streamed (decoded per clip range, never held as a
 * whole-file buffer). 8 MB is about 22 s of 48 kHz stereo float: the old 120 s duration threshold
 * left every short source as a whole-file buffer, and a short clip of a big 4K file still paid for
 * the ffmpeg route's whole-file copy.
 */
const SEGMENTED_AUDIO_DECODE_MIN_BYTES = 8 * 1024 * 1024;
/** A container this large is never read whole into ffmpeg.wasm just to get at its audio track. */
const SEGMENTED_AUDIO_DECODE_MIN_FILE_BYTES = 32 * 1024 * 1024;
/** After a failed (not "no audio") decode a source is left alone this long, then tried again. */
const FAILED_AUDIO_DECODE_RETRY_MS = 5000;
// Time arithmetic can put an aligned boundary a fraction above its integer frame.
// An extra zero sample would shift every sample when that range is reversed.
const audioFrameCount = (seconds: number, sampleRate: number) => Math.max(1, Math.ceil(seconds * sampleRate - 1e-7));

type MediaBunnyAudioInput = {
  getPrimaryAudioTrack(): Promise<import("mediabunny").InputAudioTrack | null>;
  getAudioTracks(): Promise<import("mediabunny").InputAudioTrack[]>;
  [Symbol.dispose]?: () => void;
};

export class SegmentedAudioDecoder {
  private input: MediaBunnyAudioInput | null = null;
  private sink: InstanceType<typeof import("mediabunny").AudioBufferSink> | null = null;
  private initialized = false;

  constructor(
    private readonly file: File | Blob,
    private readonly audioTrackIndex: number = 0,
  ) {}

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      const { Input, ALL_FORMATS, BlobSource, AudioBufferSink } =
        await import("mediabunny");

      this.input = new Input({
        source: new BlobSource(this.file),
        formats: ALL_FORMATS,
      }) as unknown as MediaBunnyAudioInput;

      const audioTracks = await this.input.getAudioTracks();
      let audioTrack = audioTracks[this.audioTrackIndex] ?? null;
      if (!audioTrack && this.audioTrackIndex === 0) {
        audioTrack = (await this.input.getPrimaryAudioTrack()) ?? audioTracks[0] ?? null;
      }

      if (!audioTrack) {
        this.dispose();
        return false;
      }

      const canDecode = await audioTrack.canDecode();
      if (!canDecode) {
        this.dispose();
        return false;
      }

      this.sink = new AudioBufferSink(audioTrack);
      this.initialized = true;
      return true;
    } catch {
      this.dispose();
      return false;
    }
  }

  async *buffers(
    startTime: number,
    endTime: number,
  ): AsyncGenerator<import("mediabunny").WrappedAudioBuffer, void, unknown> {
    if (!this.sink) {
      return;
    }

    for await (const wrapped of this.sink.buffers(startTime, endTime)) {
      yield wrapped;
    }
  }

  dispose(): void {
    if (this.input) {
      this.input[Symbol.dispose]?.();
      this.input = null;
    }

    this.sink = null;
    this.initialized = false;
  }
}

/**
 * AudioEngine handles audio rendering and mixing for video projects.
 * Manages audio context, multiple tracks, and applies effects.
 *
 * Usage:
 * ```ts
 * const engine = new AudioEngine({ sampleRate: 48000 });
 * await engine.initialize();
 * const audio = await engine.renderAudio(project, 0, 5);
 * ```
 */
export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private initialized = false;
  private config: AudioEngineConfig;
  private trackNodes: Map<string, AudioTrackNodes> = new Map();
  private mediaBuffers: Map<string, AudioBuffer> = new Map();
  private noAudioMedia: Set<string> = new Set();
  /** Source key -> time of its last failed decode. Unlike `noAudioMedia` this expires, so a transient failure heals. */
  private failedAudioDecodes: Map<string, number> = new Map();
  /** Per offline render: where the clip currently being rendered should connect. */
  private offlineBuses = new WeakMap<BaseAudioContext, { current: AudioNode }>();
  private audioSourceIds = new WeakMap<Blob, number>();
  private nextAudioSourceId = 0;
  private currentAudioSourceKeys = new Map<string, string>();
  private mediaBufferBytes = 0;
  private readonly maxMediaBufferBytes = 128 * 1024 * 1024;
  private segmentedAudioDecoders: Map<string, SegmentedAudioDecoder> = new Map();
  private effectsEngine: AudioEffectsEngine | null = null;

  /**
   * Creates a new AudioEngine instance.
   *
   * @param config - Optional audio configuration
   */
  constructor(config: Partial<AudioEngineConfig> = {}) {
    this.config = { ...DEFAULT_AUDIO_CONFIG, ...config };
  }

  /**
   * Initializes the AudioEngine and creates the audio context.
   * Must be called before rendering audio.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate,
        latencyHint: this.config.latencyHint,
      });

      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
      this.effectsEngine = new AudioEffectsEngine();
      await this.effectsEngine.initialize();

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `AudioEngine initialization failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  /**
   * Checks if the AudioEngine is initialized.
   *
   * @returns true if engine is ready for rendering, false otherwise
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Gets the underlying Web Audio API AudioContext.
   * Useful for advanced audio processing and effects.
   *
   * @returns AudioContext instance
   * @throws Error if engine is not initialized
   */
  getAudioContext(): AudioContext {
    this.ensureInitialized();
    return this.audioContext!;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.audioContext) {
      throw new Error("AudioEngine not initialized. Call initialize() first.");
    }
  }

  /**
   * Renders audio for a time range, mixing all active audio tracks.
   * Respects muting, solo, and effects on each track.
   *
   * @param project - The project containing timeline and media
   * @param startTime - Start time in seconds
   * @param duration - Duration to render in seconds
   * @returns Rendered audio buffer with metadata
   */
  async renderAudio(
    project: Project,
    startTime: number,
    duration: number,
    options: AudioRenderOptions = {},
  ): Promise<RenderedAudio> {
    this.ensureInitialized();
    return this.renderAudioWithHistory(project, startTime, duration, new Set(), new Map(), options.preview === true);
  }

  private effectHistorySeconds(project: Project, startTime: number, duration: number, preview: boolean): number {
    let history = 0;
    const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
    for (const track of project.timeline.tracks) {
      if (track.hidden || track.muted) continue;
      for (const clip of track.clips) {
        if (clip.startTime >= startTime + duration || clip.startTime + clip.duration <= startTime) continue;
        let tail = 0;
        for (const effect of resolveClipAudioEffects(clip, project.timeline)) {
          if (!effect.enabled || (preview && effect.metadata?.previewBypass === true)) continue;
          const p = effect.params;
          if (effect.type === "reverb" && number(p.wetLevel, 0.5) > 0) {
            tail += Math.max(0, 0.5 + number(p.roomSize, 0.5) * 3.5) + Math.max(0, Math.min(0.1, number(p.preDelay, 0) / 1000));
          } else if (effect.type === "delay" && number(p.wetLevel, 0.5) > 0) {
            const feedback = Math.max(0, Math.min(0.95, number(p.feedback, 0.3)));
            const repeats = feedback > 0 ? Math.ceil(Math.log(0.00000001) / Math.log(feedback)) : 1;
            tail += Math.max(0, Math.min(2, number(p.time, 0.5))) * repeats;
          } else if (effect.type === "compressor") {
            tail += 18 * (Math.max(0, Math.min(1, number(p.attack, 0.003))) + Math.max(0.01, Math.min(3, number(p.release, 0.25)))) + 0.006;
          } else if (effect.type === "eq" && Array.isArray(p.bands)) {
            tail += Math.max(0, ...p.bands.map((band: { frequency?: number; q?: number; gain?: number; type?: string }) =>
              band.gain === 0 && (!band.type || band.type === "peaking") ? 0 : 18 * Math.max(0.1, Math.min(18, number(band.q, 1))) / Math.max(20, number(band.frequency, 1000))));
          } else if (effect.type === "noiseReduction") tail += 1 + 8192 / (project.settings.sampleRate || this.config.sampleRate);
          else if (isRepairEffectType(effect.type)) tail += repairWarmupSeconds(effect.type) + 2048 / (project.settings.sampleRate || this.config.sampleRate);
        }
        const rate = Number.isFinite(clip.speed) && clip.speed !== 0 ? Math.abs(clip.speed!) : 1;
        history = Math.max(history, tail / rate);
      }
    }
    let rackTail = 0;
    for (const track of project.timeline.tracks) {
      if (track.hidden || track.muted) continue;
      rackTail += estimateRackTailSeconds(track.audioRack, project.settings.sampleRate || this.config.sampleRate);
    }
    rackTail += estimateRackTailSeconds(project.timeline.masterAudioRack, project.settings.sampleRate || this.config.sampleRate);
    for (const bus of getAudioBuses(project.timeline)) {
      rackTail += estimateRackTailSeconds(bus.rack, project.settings.sampleRate || this.config.sampleRate);
    }
    return history > 0 || rackTail > 0 ? history + rackTail : 0;
  }

  private async renderAudioWithHistory(
    project: Project, startTime: number, duration: number, ancestors: Set<string>,
    mixes: Map<string, Promise<AudioBuffer>>, preview: boolean,
  ): Promise<RenderedAudio> {
    const rate = project.settings.sampleRate || this.config.sampleRate;
    const history = this.effectHistorySeconds(project, startTime, duration, preview);
    if (!(history > 0) || startTime <= 0) return this.renderAudioRange(project, startTime, duration, ancestors, mixes, preview);
    const historyFrames = Math.ceil((history * rate + 128) / 128) * 128;
    const renderStart = Math.max(0, startTime - historyFrames / rate);
    const offset = startTime - renderStart;
    const mixed = await this.renderAudioRange(project, renderStart, duration + offset, ancestors, mixes, preview);
    return { ...mixed, startTime, duration,
      buffer: this.copyAudioRange(mixed.buffer, Math.round(offset * rate), audioFrameCount(duration, rate)) };
  }

  private async renderAudioRange(
    project: Project,
    startTime: number,
    duration: number,
    ancestors: Set<string>,
    mixes: Map<string, Promise<AudioBuffer>>,
    preview: boolean,
  ): Promise<RenderedAudio> {
    // Hosted plugins on tracks and buses: their dry stems are rendered (whole timeline), run through the plugin helper once
    // (cached, shared with the live preview) and substituted for the signal they replace.
    const rackStems = projectHasPluginRacks(project.timeline) ? await this.resolvePluginRackStems(project, { preview }, ancestors, mixes) : new Map<string, RackStemResult>();
    const stemmed = stemmedTargets(rackStems);
    if (stemmed.size > 0) project = { ...project, timeline: applyRackStemsToTimeline(project.timeline, stemmed) };
    const { mediaLibrary, settings } = project;
    const sampleRate = settings.sampleRate || this.config.sampleRate;
    const surround = isSurroundLayout(settings);
    const channels = mixChannelCount(settings, this.config.channels);
    // Audio Channels: a clip mapped to 5.1 or to a source channel beyond L/R needs the file's own channels,
    // not the stereo fold-down the ffmpeg decode would otherwise give a stereo sequence.
    const widest = this.widestMappedSource(project);
    this.setDecodeSurround(surround || widest > 0, Math.max(6, wideDecodeChannels(widest)));
    const safeDuration = Math.max(duration, 0.001);
    const frameCount = audioFrameCount(safeDuration, sampleRate);
    // Plugin delay compensation: every path is aligned to the slowest, so the
    // whole mix leaves the graph `latencyFrames` late. Render that many extra
    // frames and drop the leading ones: effect latency never shifts the audio
    // against the picture (sample exact; see effect-latency.ts).
    const pdc = planTimelineDelayCompensation(project.timeline, sampleRate);
    const latencyFrames = Math.round(pdc.masterLatency * sampleRate) + rackLatencySamples(project.timeline.masterAudioRack, sampleRate);
    const offlineContext = new OfflineAudioContext(
      channels,
      frameCount + latencyFrames,
      sampleRate,
    );
    const audioTracks = this.getAudioTracksAtTime(
      project,
      startTime,
      duration,
      preview,
      surround,
    );
    const hasSoloTracks = project.timeline.tracks.some((track) =>
      !track.hidden && track.solo && track.clips.some((clip) => getProjectClipCapabilities(project, clip).audio),
    );
    // Repair effects live in an AudioWorklet module that must be loaded into this context first.
    if (projectUsesRepairEffects(project, surround)) await ensureRepairWorklet(offlineContext);
    // Creative effects (chorus, phaser, distortion, ...) are a second, lazily loaded worklet.
    if (projectUsesCreativeFx(project)) await ensureCreativeFxWorklet(offlineContext);
    const mixBuses = this.buildOfflineRackBuses(offlineContext, project, { start: startTime, duration }, pdc.trackDelay, surround);
    const sunkTracks = new Set(project.timeline.tracks.filter(isSunkTrack).map((t) => t.id));
    for (const trackInfo of audioTracks) {
      // A stemmed track plays its processed stem (below); tracks parked on the rack-stem sink are replaced by a bus's stem.
      if (stemmed.has(trackInfo.trackId) || sunkTracks.has(trackInfo.trackId)) continue;
      if (this.isTrackMuted(trackInfo, hasSoloTracks)) continue;
      this.offlineBuses.set(offlineContext, { current: mixBuses.trackInput(trackInfo.trackId) });

      for (const clipInfo of trackInfo.clips) {
        if (clipInfo.compoundClipId) {
          const id = clipInfo.compoundClipId;
          const definition = project.compoundClips?.find((item) => item.id === id);
          if (!definition || ancestors.has(id) || ancestors.size >= 32) continue;
          const sourceStart = Math.max(0, clipInfo.sourceTime);
          const sourceDuration = Math.min(clipInfo.duration * (clipInfo.speed ?? 1), definition.content.duration - sourceStart);
          if (!(sourceDuration > 0) || !Number.isFinite(sourceDuration)) continue;
          const key = JSON.stringify([[...ancestors], id, sourceStart, sourceDuration]);
          let mixed = mixes.get(key);
          if (!mixed) {
            // The master rack belongs to the outer mix only; keeping it here would apply it twice.
            const { masterAudioRack: _outerMaster, masterPluginRack: _outerMasterPlugins, audioBuses: _outerBuses, ...outerTimeline } = project.timeline;
            void _outerMaster;
            void _outerMasterPlugins;
            void _outerBuses;
            // The nest brings its own buses (its sequence's mixer), never the parent's.
            const nestedProject: Project = { ...project, timeline: { ...outerTimeline,
              tracks: definition.content.tracks, duration: definition.content.duration,
              ...(definition.content.audioBuses?.length ? { audioBuses: definition.content.audioBuses } : {}) } };
            mixed = this.renderAudioWithHistory(nestedProject, sourceStart, sourceDuration, new Set(ancestors).add(id), mixes, preview)
              .then((audio) => audio.buffer);
            mixes.set(key, mixed);
          }
          await this.renderBufferToContext(offlineContext, await mixed, clipInfo, startTime, 0);
          continue;
        }
        const mediaItem = mediaLibrary.items.find(
          (m) => m.id === clipInfo.mediaId,
        );
        if (!mediaItem) continue;
        await this.renderClipToContext(
          offlineContext,
          mediaItem,
          clipInfo,
          startTime,
          preview || ancestors.size > 0,
        );
      }
    }
    for (const [targetId, stem] of rackStems) {
      if (!stem.buffer || stem.allBypassed) continue;
      const trackId = project.timeline.tracks.some((t) => t.id === targetId) ? targetId : rackStemTrackId(targetId);
      if (sunkTracks.has(trackId)) continue;
      this.offlineBuses.set(offlineContext, { current: mixBuses.trackInput(trackId) });
      await this.renderBufferToContext(offlineContext, stem.buffer, this.rackStemClipInfo(targetId, startTime, duration), startTime, startTime);
    }
    const rendered = await offlineContext.startRendering();
    const renderedBuffer = latencyFrames > 0 ? this.copyAudioRange(rendered, latencyFrames, frameCount) : rendered;

    return {
      buffer: renderedBuffer,
      startTime,
      duration,
      channels,
      sampleRate,
    };
  }

  /**
   * Determines if a track should be muted during rendering.
   * Accounts for both explicit muting and solo mode logic.
   *
   * @param trackInfo - Track render information with mute/solo flags
   * @param hasSoloTracks - Whether any tracks have solo enabled
   * @returns true if the track should be muted, false otherwise
   */
  isTrackMuted(
    trackInfo: AudioTrackRenderInfo,
    hasSoloTracks: boolean,
  ): boolean {
    return !isTrackAudible(trackInfo, hasSoloTracks);
  }

  /**
   * Gets which tracks are audible based on mute and solo state.
   *
   * @param tracks - Array of tracks to evaluate
   * @returns Map of trackId to audibility boolean
   */
  getEffectiveTrackAudibility(tracks: Track[]): Map<string, boolean> {
    const audibility = new Map<string, boolean>();
    const hasSoloTracks = hasAnySoloedTrack(tracks);

    // Not muted AND (nothing soloed OR this track is soloed OR it is solo-safe).
    for (const track of tracks) audibility.set(track.id, isTrackAudible(track, hasSoloTracks));

    return audibility;
  }

  private getAudioTracksAtTime(
    project: Project,
    startTime: number,
    duration: number,
    preview: boolean,
    surround = false,
  ): AudioTrackRenderInfo[] {
    const result: AudioTrackRenderInfo[] = [];
    const endTime = startTime + duration;
    const { timeline } = project;

    const mediaById = new Map(project.mediaLibrary.items.map((item) => [item.id, item] as const));
    timeline.tracks.forEach((track, index) => {
      if (track.hidden) return;
      const clips = this.getClipsInRange(track, startTime, endTime).filter(
        (clip) => getProjectClipCapabilities(project, clip).audio,
      );
      if (clips.length === 0) return;

      result.push({
        trackId: track.id,
        index,
        muted: track.muted,
        solo: track.solo,
        ...(track.soloSafe === true ? { soloSafe: true } : {}),
        clips: clips.map((clip) =>
          this.createClipRenderInfo(clip, startTime, endTime, timeline, track, preview, surround, resolveClipChannelMap(clip, mediaById.get(clip.mediaId))),
        ),
      });
    });

    return result;
  }

  private getClipsInRange(
    track: Track,
    startTime: number,
    endTime: number,
  ): Clip[] {
    return track.clips.filter((clip) => {
      const clipEnd = clip.startTime + clip.duration;
      return clip.startTime < endTime && clipEnd > startTime;
    });
  }

  private createClipRenderInfo(
    clip: Clip,
    rangeStart: number,
    rangeEnd: number,
    timeline: Timeline,
    track: Track,
    preview: boolean,
    surround = false,
    channelMap?: ClipChannelMap,
  ): AudioClipRenderInfo {
    const clipStart = Math.max(clip.startTime, rangeStart);
    const clipEnd = Math.min(clip.startTime + clip.duration, rangeEnd);
    const offsetInClip = clipStart - clip.startTime;
    const speed = Number.isFinite(clip.speed) && clip.speed !== 0 ? Math.abs(clip.speed!) : 1;
    const reversed = clip.reversed === true || (clip.speed ?? 1) < 0;
    const sourceTime = reversed
      ? clip.outPoint - (offsetInClip + clipEnd - clipStart) * speed
      : clip.inPoint + offsetInClip * speed;
    const clipAudioEffects = resolveClipAudioEffects(clip, timeline).filter((effect) => !preview || effect.metadata?.previewBypass !== true);
    const pan = getPanFromAudioEffects(
      (clipAudioEffects.length > 0 ? clipAudioEffects : clip.effects).filter((effect) => effect.enabled),
    );
    const transitionFades = getTrackTransitionAudioFades(track, clip.id);

    return {
      clipId: clip.id,
      mediaId: clip.mediaId,
      sourceTime,
      clipOffset: offsetInClip,
      timelineStartTime: clipStart,
      duration: clipEnd - clipStart,
      clipDuration: clip.duration,
      volume: clip.volume,
      volumeAutomation: resolveClipVolumeAutomation(clip, timeline),
      pan,
      panAutomation: resolveClipPanAutomation(clip, timeline),
      pitchCorrection: resolveClipPitchCorrection(clip, timeline),
      ...(surround ? { surroundPan: resolveSurroundPan(clip, track) } : {}),
      ...(channelMap ? { channelMap } : {}),
      effects: clipAudioEffects,
      fadeIn: clip.fade?.fadeIn,
      fadeOut: clip.fade?.fadeOut,
      fadeOrigin: clip.fade?.origin,
      transitionFadeIn: transitionFades.fadeIn,
      transitionFadeOut: transitionFades.fadeOut,
      speed,
      reversed,
      compoundClipId: getCompoundClipId(clip) ?? undefined,
      audioTrackIndex: clip.audioTrackIndex,
    };
  }

  private getAudioSourceKey(mediaItem: MediaItem, audioTrackIndex: number): string {
    let sourceId = 0;
    if (mediaItem.blob) {
      sourceId = this.audioSourceIds.get(mediaItem.blob) ?? ++this.nextAudioSourceId;
      this.audioSourceIds.set(mediaItem.blob, sourceId);
    }
    const logicalKey = `${mediaItem.id}:${audioTrackIndex}`, key = `${logicalKey}:${sourceId}`;
    const previous = this.currentAudioSourceKeys.get(logicalKey);
    if (previous && previous !== key) {
      const cached = this.mediaBuffers.get(previous);
      if (cached) this.mediaBufferBytes -= cached.length * cached.numberOfChannels * 4;
      this.mediaBuffers.delete(previous); this.noAudioMedia.delete(previous); this.failedAudioDecodes.delete(previous);
      this.segmentedAudioDecoders.get(previous)?.dispose(); this.segmentedAudioDecoders.delete(previous);
    }
    this.currentAudioSourceKeys.set(logicalKey, key);
    return key;
  }

  private cacheAudioBuffer(key: string, buffer: AudioBuffer): void {
    const bytes = buffer.length * buffer.numberOfChannels * 4;
    const existing = this.mediaBuffers.get(key);
    if (existing) { this.mediaBufferBytes -= existing.length * existing.numberOfChannels * 4; this.mediaBuffers.delete(key); }
    if (bytes > this.maxMediaBufferBytes) return;
    while (this.mediaBufferBytes + bytes > this.maxMediaBufferBytes && this.mediaBuffers.size > 0) {
      const oldest = this.mediaBuffers.keys().next().value!;
      const cached = this.mediaBuffers.get(oldest)!;
      this.mediaBufferBytes -= cached.length * cached.numberOfChannels * 4;
      this.mediaBuffers.delete(oldest);
    }
    this.mediaBuffers.set(key, buffer); this.mediaBufferBytes += bytes;
  }

  /** True while decoding for a 5.1 sequence: sources keep their own channels (up to 6) instead of being folded to stereo. */
  private decodeSurround = false;

  /** Most channels a wide decode keeps: six, or the widest source a mapped clip reads (multichannel source patching). */
  private decodeChannelCap = 6;

  /** The widest source (in channels) read by a clip whose channel map needs the file's own channels; 0 when none does. */
  private widestMappedSource(project: Project): number {
    const mediaById = new Map(project.mediaLibrary.items.map((item) => [item.id, item] as const));
    let widest = 0;
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        const media = mediaById.get(clip.mediaId);
        const channels = media?.metadata.channels;
        if (channelMapNeedsWideSource(resolveClipChannelMap(clip, media), channels)) widest = Math.max(widest, channels ?? 2);
      }
    }
    return widest;
  }

  private setDecodeSurround(surround: boolean, cap = 6): void {
    if (this.decodeSurround === surround && this.decodeChannelCap === cap) return;
    // Cached buffers were decoded for the other layout.
    this.decodeSurround = surround;
    this.decodeChannelCap = cap;
    this.mediaBuffers.clear();
    this.mediaBufferBytes = 0;
  }

  private async getAudioBuffer(
    mediaItem: MediaItem,
    context: BaseAudioContext,
    audioTrackIndex: number = 0,
  ): Promise<AudioBuffer | null> {
    const cacheKey = this.getAudioSourceKey(mediaItem, audioTrackIndex);
    const cached = this.mediaBuffers.get(cacheKey);
    if (cached) { this.mediaBuffers.delete(cacheKey); this.mediaBuffers.set(cacheKey, cached); return cached; }
    if (this.noAudioMedia.has(cacheKey)) return null;
    if (this.isAudioDecodeCoolingDown(cacheKey)) return null;

    if (!mediaItem.blob) {
      console.warn(`No blob available for media item ${mediaItem.id}`);
      return null;
    }

    try {
      const audioBuffer = await this.extractAudioFromVideo(
        mediaItem,
        context,
        audioTrackIndex,
      );
      if (audioBuffer) {
        this.failedAudioDecodes.delete(cacheKey);
        this.cacheAudioBuffer(cacheKey, audioBuffer);
        return audioBuffer;
      }
    } catch (error) {
      if (error instanceof Error && error.name === "NoAudioStreamError") {
        this.noAudioMedia.add(cacheKey);
        return null;
      }
    }

    if (audioTrackIndex === 0) {
      try {
        const arrayBuffer = await mediaItem.blob.arrayBuffer();
        const audioBuffer = await context.decodeAudioData(arrayBuffer);
        this.failedAudioDecodes.delete(cacheKey);
        this.cacheAudioBuffer(cacheKey, audioBuffer);
        return audioBuffer;
      } catch {
        this.failedAudioDecodes.set(cacheKey, Date.now());
        return null;
      }
    }

    this.failedAudioDecodes.set(cacheKey, Date.now());
    return null;
  }

  private isAudioDecodeCoolingDown(cacheKey: string): boolean {
    const failedAt = this.failedAudioDecodes.get(cacheKey);
    if (failedAt === undefined) return false;
    if (Date.now() - failedAt < FAILED_AUDIO_DECODE_RETRY_MS) return true;
    this.failedAudioDecodes.delete(cacheKey);
    return false;
  }

  private async extractAudioFromVideo(
    mediaItem: MediaItem,
    context: BaseAudioContext,
    audioTrackIndex: number = 0,
  ): Promise<AudioBuffer | null> {
    if (!mediaItem.blob) return null;

    try {
      const { extractAudioWav } = await import("../media/extract-audio");
      const channels = fallbackDecodeChannels(this.decodeSurround ? "5.1" : "stereo", mediaItem.metadata.channels, this.decodeChannelCap);
      const wavBlob = channels === undefined
        ? await extractAudioWav(mediaItem.blob, audioTrackIndex)
        : await extractAudioWav(mediaItem.blob, audioTrackIndex, { channels });
      const arrayBuffer = await wavBlob.arrayBuffer();
      return await context.decodeAudioData(arrayBuffer);
    } catch (error) {
      if (error instanceof Error && error.name === "NoAudioStreamError") {
        throw error;
      }
      return null;
    }
  }

  private async renderClipToContext(
    context: OfflineAudioContext,
    mediaItem: MediaItem,
    clipInfo: AudioClipRenderInfo,
    renderStartTime: number,
    preferSegments = false,
  ): Promise<void> {
    if (this.noAudioMedia.has(this.getAudioSourceKey(mediaItem, clipInfo.audioTrackIndex ?? 0))) return;
    // Spectral repair processes the whole decoded source (the same samples the preview plays), so such clips skip the streaming decode.
    if (getSpectralRepairRegions(clipInfo.effects).length === 0 && getEnhanceSpeechMix(clipInfo.effects) === 0 && !hasReduceReverb(clipInfo.effects) && !hasNativePlugins(clipInfo.effects) && this.shouldUseSegmentedAudioDecoding(mediaItem, preferSegments)) {
      const renderedSegment = await this.renderClipToContextFromSegments(
        context,
        mediaItem,
        clipInfo,
        renderStartTime,
      );
      if (renderedSegment) {
        return;
      }
    }

    const audioBuffer = await this.getAudioBuffer(mediaItem, context, clipInfo.audioTrackIndex ?? 0);
    if (!audioBuffer) {
      return;
    }

    await this.renderBufferToContext(context, audioBuffer, clipInfo, renderStartTime);
  }

  private async renderBufferToContext(
    context: OfflineAudioContext,
    audioBuffer: AudioBuffer,
    clipInfo: AudioClipRenderInfo,
    renderStartTime: number,
    sourceOffset = clipInfo.sourceTime,
  ): Promise<void> {
    // Spectral repair: the clip's region edits are applied to the whole decoded source (regions are source-time) through
    // the cache the live preview shares, so preview and export play the same samples; everything below sees the repaired audio.
    if (!clipInfo.compoundClipId) {
      const regions = getSpectralRepairRegions(clipInfo.effects);
      if (regions.length > 0) audioBuffer = await this.repairSpectrally(audioBuffer, regions);
      // Reduce Reverb runs on the repaired whole source, the same cached job the preview plays; Enhance Speech then runs on its result
      // (the order is fixed: spectral repair, Reduce Reverb, Enhance Speech, hosted plugins, the live chain).
      const reverbParams = getReduceReverbParams(clipInfo.effects);
      if (reverbParams) audioBuffer = await this.reduceReverb(audioBuffer, reverbParams);
      // Enhance Speech runs on the (repaired, dereverberated) whole source through the cache the live preview shares.
      const enhanceMix = getEnhanceSpeechMix(clipInfo.effects);
      if (enhanceMix > 0) audioBuffer = await this.enhanceSpeech(audioBuffer, enhanceMix, getEnhanceSpeechBalance(clipInfo.effects));
      // Hosted plugins run last on the whole source, through the cache the live preview shares.
      if (hasNativePlugins(clipInfo.effects)) audioBuffer = await this.renderNativePlugins(audioBuffer, clipInfo.effects);
    }
    // Audio Channels: every later stage (reverse, stretch, effects, panner) sees the clip's channels, not the file's.
    audioBuffer = mapAudioBuffer(context, audioBuffer, clipInfo.channelMap);
    const source = context.createBufferSource();

    const speed = clipInfo.speed || 1;
    const reversed = clipInfo.reversed || false;

    const sourceDuration = Math.min(clipInfo.duration * speed, Math.max(0, audioBuffer.duration - sourceOffset));
    if (!(sourceDuration > 0)) return;
    let processingBuffer = audioBuffer, processingOffset = sourceOffset;
    if (reversed) {
      processingBuffer = this.extractAudioSegment(audioBuffer, sourceOffset, sourceDuration);
      for (let channel = 0; channel < processingBuffer.numberOfChannels; channel++) processingBuffer.getChannelData(channel).reverse();
      processingOffset = 0;
    }
    // Maintain audio pitch: time-stretch the source excerpt to timeline length and play it at 1x,
    // instead of letting playbackRate resample it (which shifts pitch with speed).
    const stretch = shouldPreservePitch(speed, clipInfo.pitchCorrection);
    let playSpeed = speed, processDuration = sourceDuration;
    if (stretch) {
      // Shared with the preview: the same clip range at the same speed is stretched once (off the main thread
      // where workers exist) and reused by later exports and passes.
      const cached = await getSharedStretchCache((channels, sampleRate) => this.buildStretchBuffer(channels, sampleRate)).request({
        buffer: audioBuffer, speed, start: sourceOffset, end: sourceOffset + sourceDuration,
      });
      if (cached) {
        processingBuffer = reversed ? this.reversedCopy(cached) : cached;
      } else {
        const excerpt = reversed ? processingBuffer : this.extractAudioSegment(audioBuffer, sourceOffset, sourceDuration);
        processingBuffer = this.stretchAudioBuffer(excerpt, speed);
      }
      processingOffset = 0;
      playSpeed = 1;
      processDuration = processingBuffer.duration;
    }
    // Modulated effects (chorus, flanger, phaser) hear the signal after the speed change, as in the live chain: when the
    // speed is applied by playbackRate (no pitch-preserving stretch), bring the excerpt to timeline rate first.
    if (!stretch && playSpeed !== 1 && hasModulatedCreativeFx(clipInfo.effects)) {
      const excerpt = this.extractAudioSegment(processingBuffer, processingOffset, processDuration);
      const channelData = Array.from({ length: excerpt.numberOfChannels }, (_, c) => excerpt.getChannelData(c));
      processingBuffer = this.buildStretchBuffer(resampleToTimelineRate(channelData, playSpeed), excerpt.sampleRate);
      processingOffset = 0;
      playSpeed = 1;
      processDuration = processingBuffer.duration;
    }
    const processedClip = await this.processClipBuffer(processingBuffer, { ...clipInfo, sourceTime: processingOffset, duration: processDuration });
    source.buffer = processedClip.buffer;
    source.playbackRate.value = playSpeed;

    const { volumeGainNode, fadeGainNode, pannerNode } = this.createClipOutputNodes(
      context,
      clipInfo,
      processedClip.buffer.numberOfChannels,
    );
    source.connect(volumeGainNode);
    const contextStartTime = Math.max(
      0,
      clipInfo.timelineStartTime - renderStartTime,
    );
    this.applyVolumeAutomation(volumeGainNode, clipInfo, contextStartTime);
    this.applyFades(fadeGainNode, clipInfo, contextStartTime);
    this.applyPanAutomation(pannerNode, clipInfo, contextStartTime);

    const startOffset = processedClip.startOffset;

    source.start(
      contextStartTime,
      Math.max(0, startOffset),
      Math.min(processDuration, processedClip.renderDuration),
    );
    source.stop(contextStartTime + clipInfo.duration);
  }

  private shouldUseSegmentedAudioDecoding(mediaItem: MediaItem, preferSegments: boolean): boolean {
    const estimatedBytes = mediaItem.metadata.duration * (mediaItem.metadata.sampleRate || this.config.sampleRate)
      * (mediaItem.metadata.channels || this.config.channels) * 4;
    const fileBytes = mediaItem.blob?.size ?? 0;
    // A 5.1 sequence keeps the long-source rule only: its short sources are decoded by ffmpeg with an
    // explicit channel count, which the streaming path does not reproduce.
    if (this.decodeSurround) {
      return preferSegments || mediaItem.metadata.duration >= 120 || estimatedBytes > this.maxMediaBufferBytes;
    }
    return preferSegments
      || estimatedBytes > SEGMENTED_AUDIO_DECODE_MIN_BYTES
      || fileBytes > SEGMENTED_AUDIO_DECODE_MIN_FILE_BYTES;
  }

  private async processClipBuffer(
    audioBuffer: AudioBuffer,
    clipInfo: AudioClipRenderInfo,
  ): Promise<{
    buffer: AudioBuffer;
    startOffset: number;
    renderDuration: number;
  }> {
    const enabledEffects = clipInfo.effects.filter(
      (effect) =>
        effect.enabled && effect.type !== "pan" && effect.type !== "fadeIn" && effect.type !== "fadeOut" && effect.type !== SPECTRAL_REPAIR_EFFECT_TYPE && effect.type !== ENHANCE_SPEECH_EFFECT_TYPE && effect.type !== REDUCE_REVERB_EFFECT_TYPE && effect.type !== NATIVE_PLUGIN_EFFECT_TYPE,
    );

    if (
      enabledEffects.length === 0 ||
      !this.effectsEngine
    ) {
      return {
        buffer: audioBuffer,
        startOffset: clipInfo.sourceTime,
        renderDuration: clipInfo.duration,
      };
    }

    const segmentBuffer = this.extractAudioSegment(
      audioBuffer,
      clipInfo.sourceTime,
      clipInfo.duration,
    );
    const { profileAwareNoiseEffects, realtimeEffects } =
      splitProfileAwareNoiseReductionEffects(enabledEffects);

    let processedBuffer = segmentBuffer;

    for (const effect of profileAwareNoiseEffects) {
      const params = effect.params as AudioEffectParams["noiseReduction"];
      if (!params.profile) {
        continue;
      }

      processedBuffer = await this.effectsEngine.applyNoiseReductionWithProfileData(
        processedBuffer,
        params.profile,
        params.reduction ?? 0.5,
        params.focus ?? "balanced",
        params.threshold ?? -40,
      );
    }

    if (realtimeEffects.length > 0) {
      const result = await this.effectsEngine.applyEffectChain(
        processedBuffer,
        realtimeEffects,
        { timelineStart: offlineClipChainClockOffset(clipInfo.timelineStartTime) },
      );
      processedBuffer = result.buffer;
    }

    return {
      buffer: processedBuffer,
      startOffset: 0,
      renderDuration: processedBuffer.duration,
    };
  }

  private applyPanAutomation(pannerNode: AudioNode, clipInfo: AudioClipRenderInfo, contextStartTime: number): void {
    if (!("pan" in pannerNode) || clipInfo.surroundPan) return;
    schedulePanAutomationOnParam(
      (pannerNode as StereoPannerNode).pan,
      clipInfo.panAutomation,
      clipInfo.pan,
      clipInfo.clipOffset,
      clipInfo.duration,
      contextStartTime,
    );
  }

  /** The source buffer with spectral regions applied: cached and computed off the main thread, with an inline fallback so an export is never silently unrepaired. */
  private async repairSpectrally(buffer: AudioBuffer, regions: SpectralRegion[]): Promise<AudioBuffer> {
    const cached = await getSharedSpectralRepairCache((channels, sampleRate) => this.buildStretchBuffer(channels, sampleRate)).request({ buffer, regions });
    if (cached) return cached;
    const { applySpectralRegions } = await import("./spectral/spectral-dsp");
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
    return this.buildStretchBuffer(applySpectralRegions(channels, buffer.sampleRate, regions), buffer.sampleRate);
  }

  /**
   * The source buffer enhanced by the speech model at `mix` percent: the cached, off-thread job the preview shares.
   * An export never silently drops the effect: a user-cancelled job is retried, and a failure (for example the model
   * files cannot be loaded) fails the render with the reason.
   */
  private async enhanceSpeech(buffer: AudioBuffer, mix: number, balance = 100): Promise<AudioBuffer> {
    const cache = getSharedEnhanceSpeechCache((channels, sampleRate) => this.buildStretchBuffer(channels, sampleRate));
    let result = await cache.request({ buffer, mix, balance });
    if (!result && cache.status(buffer).state !== "failed") result = await cache.request({ buffer, mix, balance });
    if (!result) throw new Error(`Enhance Speech could not run: ${cache.status(buffer).error ?? "the job was cancelled"}`);
    return result;
  }

  /** The source with late reverb removed: the cached, off-thread job the preview shares; fails the render like Enhance Speech rather than dropping the effect. */
  private async reduceReverb(buffer: AudioBuffer, params: ReduceReverbParams): Promise<AudioBuffer> {
    const cache = getSharedReduceReverbCache((channels, sampleRate) => this.buildStretchBuffer(channels, sampleRate));
    let result = await cache.request({ buffer, params });
    if (!result && cache.status(buffer, params).state !== "failed") result = await cache.request({ buffer, params });
    if (!result) throw new Error(`Reduce Reverb could not run: ${cache.status(buffer, params).error ?? "the job was cancelled"}`);
    return result;
  }

  /** What the last mixdown (or stem resolution) found out about hosted plugins on tracks and buses: bypassed effect ids with the reason, per target. */
  private rackPluginReport = new Map<string, ReadonlyMap<string, string>>();

  /** Bumped whenever a resolution bypassed a plugin (see RackStemDeps.bypassEvents). */
  private rackBypassEvents = 0;

  /** Plugins on tracks / buses that were bypassed in the last render (not installed, blocked, no host), per track or bus id. */
  getPluginRackReport(): ReadonlyMap<string, ReadonlyMap<string, string>> {
    return this.rackPluginReport;
  }

  private rackStemClipInfo(targetId: string, startTime: number, duration: number): AudioClipRenderInfo {
    return {
      clipId: `rack-stem:${targetId}`,
      mediaId: "",
      sourceTime: startTime,
      clipOffset: 0,
      timelineStartTime: startTime,
      duration,
      clipDuration: duration,
      volume: 1,
      volumeAutomation: [],
      pan: 0,
      effects: [],
      speed: 1,
    };
  }

  /**
   * The processed stem of every track and bus that carries hosted plugins: its dry mixdown over the whole timeline run
   * through the plugin chain (latency compensated, automation from the rack's keyframes). Cached by the exact input, so the
   * live preview and every export window share one render. A plugin that cannot run is bypassed and reported through
   * {@link getPluginRackReport}; one that fails while rendering rejects.
   */
  async resolvePluginRackStems(
    project: Project,
    options: { preview?: boolean } = {},
    ancestors: Set<string> = new Set(),
    mixes: Map<string, Promise<AudioBuffer>> = new Map(),
  ): Promise<Map<string, RackStemResult>> {
    this.ensureInitialized();
    // A preview render only differs from an export render when a clip effect is set to "hear dry": otherwise they share one cached stem.
    const wantsPreview = options.preview === true;
    const preview = wantsPreview && timelineHasClipPreviewBypass(project.timeline);
    const results = await resolveRackStems(project, {
      renderStem: async (stemProject, seconds) => (await this.renderAudioWithHistory(stemProject, 0, seconds, ancestors, mixes, preview)).buffer,
      runChain: async (buffer, steps, label) => {
        try {
          const outcome = await getSharedNativePluginCache((channels, sampleRate) => this.buildStretchBuffer(channels, sampleRate)).request(buffer, steps, { label });
          return { buffer: outcome.buffer, bypassed: outcome.bypassed };
        } catch (error) {
          throw new Error(`A hosted audio plugin could not run: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      fingerprint: (stemProject, seconds) => audioRangeFingerprint(stemProject, 0, seconds),
      hasHost: getNativePluginBackend() !== undefined,
      audibility: this.getEffectiveTrackAudibility(project.timeline.tracks),
      preview: wantsPreview,
      renderPreview: preview,
      surround: isSurroundLayout(project.settings),
      bypassEvents: () => this.rackBypassEvents,
    });
    // Nested resolutions (the stem of a bus resolves the racks upstream of it first) report too: merge per target.
    const report = new Map(this.rackPluginReport);
    // With a master stem playing, the tracks' and buses' own results came from the nested resolution (their entries stay).
    const masterPlays = stemmedTargets(results).has(MASTER_RACK_TARGET);
    for (const target of activePluginRackTargets(project.timeline)) if (!masterPlays || target.kind === "master") report.delete(target.id);
    for (const [id, result] of results) if (result.bypassed.size > 0) report.set(id, result.bypassed);
    if ([...results.values()].some((result) => result.bypassed.size > 0)) this.rackBypassEvents += 1;
    this.rackPluginReport = report;
    return results;
  }

  /**
   * The source buffer rendered through the clip's hosted plugins (latency compensated, automation applied): the cached,
   * off-thread job the preview shares. A plugin that is not installed, blocked or has no host is bypassed (reported through
   * the cache); a plugin that fails while rendering fails the export with the reason, never a silently different mix.
   */
  private async renderNativePlugins(buffer: AudioBuffer, effects: readonly Effect[]): Promise<AudioBuffer> {
    const cache = getSharedNativePluginCache((channels, sampleRate) => this.buildStretchBuffer(channels, sampleRate));
    try {
      return (await cache.request(buffer, nativePluginSteps(effects))).buffer;
    } catch (error) {
      throw new Error(`A hosted audio plugin could not run: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildStretchBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
    const out = this.audioContext!.createBuffer(channels.length, Math.max(1, channels[0]?.length ?? 1), sampleRate);
    channels.forEach((data, c) => out.getChannelData(c).set(data));
    return out;
  }

  /** A reversed copy; the (shared, cached) source is never modified. */
  private reversedCopy(buffer: AudioBuffer): AudioBuffer {
    const out = this.audioContext!.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) out.getChannelData(c).set(buffer.getChannelData(c).slice().reverse());
    return out;
  }

  private stretchAudioBuffer(buffer: AudioBuffer, speed: number): AudioBuffer {
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    const stretched = timeStretchChannels(channels, buffer.sampleRate, speed);
    const out = this.audioContext!.createBuffer(buffer.numberOfChannels, Math.max(1, stretched[0]?.length ?? 1), buffer.sampleRate);
    stretched.forEach((data, c) => out.getChannelData(c).set(data));
    return out;
  }

  private copyAudioRange(sourceBuffer: AudioBuffer, startSample: number, length: number): AudioBuffer {
    const segmentBuffer = this.audioContext!.createBuffer(sourceBuffer.numberOfChannels, length, sourceBuffer.sampleRate);
    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
      segmentBuffer.getChannelData(channel).set(sourceBuffer.getChannelData(channel).subarray(startSample, startSample + length));
    }
    return segmentBuffer;
  }

  private extractAudioSegment(sourceBuffer: AudioBuffer, startTime: number, duration: number): AudioBuffer {
    return this.copyAudioRange(sourceBuffer, Math.max(0, Math.floor(startTime * sourceBuffer.sampleRate + 1e-7)), audioFrameCount(duration, sourceBuffer.sampleRate));
  }

  private async renderClipToContextFromSegments(
    context: OfflineAudioContext,
    mediaItem: MediaItem,
    clipInfo: AudioClipRenderInfo,
    renderStartTime: number,
  ): Promise<boolean> {
    const decoder = await this.getSegmentedAudioDecoder(mediaItem, clipInfo.audioTrackIndex ?? 0);
    if (!decoder) {
      return false;
    }

    const rangeStart = Math.max(0, clipInfo.sourceTime);
    const rangeDuration = clipInfo.duration * (clipInfo.speed ?? 1);
    const rangeEnd = rangeStart + rangeDuration;
    if (rangeEnd <= rangeStart) {
      return false;
    }

    if ((clipInfo.speed ?? 1) !== 1 || clipInfo.reversed || clipInfo.effects.some((effect) => effect.enabled && effect.type !== "pan")) {
      let assembled: AudioBuffer | null = null;
      for await (const wrapped of decoder.buffers(rangeStart, rangeEnd)) {
        const overlapStart = Math.max(rangeStart, wrapped.timestamp);
        const overlapEnd = Math.min(rangeEnd, wrapped.timestamp + wrapped.duration);
        if (overlapEnd <= overlapStart) continue;
        assembled ??= this.audioContext!.createBuffer(wrapped.buffer.numberOfChannels,
          audioFrameCount(rangeDuration, wrapped.buffer.sampleRate), wrapped.buffer.sampleRate);
        for (let channel = 0; channel < assembled.numberOfChannels; channel++) {
          const source = wrapped.buffer.getChannelData(channel), target = assembled.getChannelData(channel);
          const from = Math.max(0, Math.round((overlapStart - wrapped.timestamp) * wrapped.buffer.sampleRate));
          const to = Math.max(0, Math.round((overlapStart - rangeStart) * assembled.sampleRate));
          const count = Math.min(source.length - from, target.length - to,
            audioFrameCount(overlapEnd - overlapStart, assembled.sampleRate));
          if (count > 0) target.set(source.subarray(from, from + count), to);
        }
      }
      if (assembled) await this.renderBufferToContext(context, assembled, clipInfo, renderStartTime, 0);
      return true;
    }
    const contextStartTime = Math.max(
      0,
      clipInfo.timelineStartTime - renderStartTime,
    );
    let volumeGainNode: GainNode | undefined;

    for await (const wrapped of decoder.buffers(rangeStart, rangeEnd)) {
      const bufferStart = wrapped.timestamp;
      const bufferEnd = wrapped.timestamp + wrapped.duration;
      const overlapStart = Math.max(rangeStart, bufferStart);
      const overlapEnd = Math.min(rangeEnd, bufferEnd);

      if (overlapEnd <= overlapStart) {
        continue;
      }

      if (!volumeGainNode) {
        // Created on the first segment: a 5.1 mix needs the source's channel count to route it.
        const nodes = this.createClipOutputNodes(context, clipInfo, wrapped.buffer.numberOfChannels);
        volumeGainNode = nodes.volumeGainNode;
        this.applyVolumeAutomation(volumeGainNode, clipInfo, contextStartTime);
        this.applyFades(nodes.fadeGainNode, clipInfo, contextStartTime);
        // Once per clip over the full clip window (not per decoded segment).
        this.applyPanAutomation(nodes.pannerNode, clipInfo, contextStartTime);
      }
      const source = context.createBufferSource();
      source.buffer = wrapped.buffer;
      source.connect(volumeGainNode);
      source.start(
        contextStartTime + (overlapStart - rangeStart),
        overlapStart - bufferStart,
        overlapEnd - overlapStart,
      );
    }

    return true;
  }

  /**
   * Per-track rack buses and the master rack for an offline render. Tracks and
   * projects without racks connect straight to the destination, so their graph
   * (and samples) are unchanged. Node order mirrors RealtimeAudioGraph:
   * clips -> track rack -> pan -> volume -> master volume -> master rack.
   */
  private buildOfflineRackBuses(
    context: OfflineAudioContext,
    project: Project,
    window: { start: number; duration: number },
    trackDelay?: ReadonlyMap<string, number>,
    surround = false,
  ): { trackInput(trackId: string): AudioNode } {
    const master = project.timeline.masterAudioRack;
    let masterIn: AudioNode = context.destination;
    // Sidechain keys (a compressor listening to another track or bus) meet in one hub per render.
    const keys = timelineHasSidechain(project.timeline) ? new SidechainKeyHub(context) : undefined;
    keys?.setTimeline(project.timeline);
    if (master && (rackHasProcessing(master) || rackVolume(master) !== 1)) {
      const volume = context.createGain();
      volume.gain.value = rackVolume(master);
      const bus = createRackBus(context, master, { live: false, surround, sidechain: keys ? { hub: keys, ownerId: MASTER_OWNER } : undefined });
      if (window) bus.anchorTimeline?.(window.start, 0);
      if (window && rackHasAutomation(master)) bus.scheduleAutomation?.(window.start, window.duration, 0);
      volume.connect(bus.input);
      bus.output.connect(context.destination);
      masterIn = volume;
    }
    // Projects without buses/sends skip the routing graph entirely, so their
    // node graph (and samples) are exactly what they were before routing existed.
    const routing = hasAudioRouting(project.timeline)
      ? new AudioRoutingGraph(context, masterIn, { live: false, surround, sidechain: keys, window: { timelineStart: window.start, duration: window.duration } })
      : null;
    routing?.configure(project.timeline);
    const inputs = new Map<string, AudioNode>();
    for (const track of project.timeline.tracks) {
      const input = buildOfflineTrackChain(context, routing, track, masterIn, routing ? 0 : (trackDelay?.get(track.id) ?? 0), surround, window ? { timelineStart: window.start, duration: window.duration } : undefined, keys);
      if (input) inputs.set(track.id, input);
    }
    return { trackInput: (trackId) => inputs.get(trackId) ?? masterIn };
  }

  private createClipOutputNodes(
    context: OfflineAudioContext,
    clipInfo: AudioClipRenderInfo,
    sourceChannels = 2,
  ): {
    volumeGainNode: GainNode;
    fadeGainNode: GainNode;
    pannerNode: AudioNode;
  } {
    const volumeGainNode = context.createGain();
    volumeGainNode.gain.value = clipInfo.volume;

    const fadeGainNode = context.createGain();
    fadeGainNode.gain.value = 1;

    if (clipInfo.surroundPan) {
      // 5.1 mix: the surround panner (mono/stereo are positioned, 5.1 passes through) replaces the stereo panner.
      // The volume/fade gains keep the source's channels (max mode), the panner reads them discretely.
      const panner = createSurroundPanner(context, sourceChannels, clipInfo.surroundPan);
      volumeGainNode.connect(fadeGainNode);
      fadeGainNode.connect(panner.input);
      panner.output.connect(this.offlineBuses.get(context)?.current ?? context.destination);
      return { volumeGainNode, fadeGainNode, pannerNode: panner.output };
    }

    const pannerNode = context.createStereoPanner();
    pannerNode.pan.value = Math.max(-1, Math.min(1, clipInfo.pan));

    volumeGainNode.connect(fadeGainNode);
    fadeGainNode.connect(pannerNode);
    pannerNode.connect(this.offlineBuses.get(context)?.current ?? context.destination);

    return { volumeGainNode, fadeGainNode, pannerNode };
  }

  private applyVolumeAutomation(
    gainNode: GainNode,
    clipInfo: AudioClipRenderInfo,
    startTime: number,
  ): void {
    scheduleVolumeAutomationOnGain(
      gainNode,
      clipInfo.volumeAutomation,
      clipInfo.volume,
      clipInfo.clipOffset,
      clipInfo.duration,
      startTime,
    );
  }

  private async getSegmentedAudioDecoder(
    mediaItem: MediaItem,
    audioTrackIndex: number = 0,
  ): Promise<SegmentedAudioDecoder | null> {
    if (!mediaItem.blob) {
      return null;
    }

    const cacheKey = this.getAudioSourceKey(mediaItem, audioTrackIndex);
    const cached = this.segmentedAudioDecoders.get(cacheKey);
    if (cached) {
      return cached;
    }

    const decoder = new SegmentedAudioDecoder(mediaItem.blob, audioTrackIndex);
    const initialized = await decoder.initialize();
    if (!initialized) {
      return null;
    }

    this.segmentedAudioDecoders.set(cacheKey, decoder);
    return decoder;
  }

  private applyFades(
    gainNode: GainNode,
    clipInfo: AudioClipRenderInfo,
    startTime: number,
  ): void {
    scheduleClipFadeEnvelope(gainNode.gain, {
      startTime,
      clipOffset: clipInfo.clipOffset,
      rangeDuration: clipInfo.duration,
      clipDuration: clipInfo.clipDuration,
      fadeIn: clipInfo.fadeIn,
      fadeOut: clipInfo.fadeOut,
      fadeOrigin: clipInfo.fadeOrigin,
      transitionFadeIn: clipInfo.transitionFadeIn,
      transitionFadeOut: clipInfo.transitionFadeOut,
    });
  }

  async mixTracks(
    buffers: AudioBuffer[],
    volumes: number[],
    pans: number[],
  ): Promise<AudioBuffer> {
    this.ensureInitialized();

    if (buffers.length === 0) {
      return this.audioContext!.createBuffer(
        this.config.channels,
        this.config.sampleRate,
        this.config.sampleRate,
      );
    }
    const maxLength = Math.max(...buffers.map((b) => b.length));
    const sampleRate = buffers[0].sampleRate;
    const offlineContext = new OfflineAudioContext(
      this.config.channels,
      maxLength,
      sampleRate,
    );
    for (let i = 0; i < buffers.length; i++) {
      const source = offlineContext.createBufferSource();
      source.buffer = buffers[i];

      const gain = offlineContext.createGain();
      gain.gain.value = volumes[i] ?? 1;

      const panner = offlineContext.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pans[i] ?? 0));

      source.connect(gain);
      gain.connect(panner);
      panner.connect(offlineContext.destination);

      source.start(0);
    }

    return offlineContext.startRendering();
  }

  getChannelStates(project: Project): AudioChannelState[] {
    return project.timeline.tracks
      .filter((track) => trackHasAudioItems(project, track.id))
      .map((track) => ({
        trackId: track.id,
        volume: 1, // Default volume, would be stored in track
        pan: 0, // Default pan
        muted: track.muted,
        solo: track.solo,
        peakLevel: 0,
        rmsLevel: 0,
      }));
  }

  async applyEffect(buffer: AudioBuffer, effect: Effect): Promise<AudioBuffer> {
    this.ensureInitialized();

    if (!effect.enabled) return buffer;

    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate,
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    const effectNode = this.createEffectNode(offlineContext, effect);

    if (effectNode) {
      source.connect(effectNode);
      effectNode.connect(offlineContext.destination);
    } else {
      source.connect(offlineContext.destination);
    }

    source.start(0);
    return offlineContext.startRendering();
  }

  private createEffectNode(
    context: BaseAudioContext,
    effect: Effect,
  ): AudioNode | null {
    const params = effect.params as Record<string, number>;

    switch (effect.type) {
      case "gain":
        const gainNode = context.createGain();
        gainNode.gain.value = params.value ?? 1;
        return gainNode;

      case "pan":
        const pannerNode = context.createStereoPanner();
        pannerNode.pan.value = Math.max(-1, Math.min(1, params.value ?? 0));
        return pannerNode;

      case "eq":
        return this.createEQNode(context, effect);

      case "compressor":
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = params.threshold ?? -24;
        compressor.ratio.value = params.ratio ?? 4;
        compressor.attack.value = params.attack ?? 0.003;
        compressor.release.value = params.release ?? 0.25;
        compressor.knee.value = params.knee ?? 30;
        return compressor;

      case "delay":
        const delay = context.createDelay(2);
        delay.delayTime.value = params.time ?? 0.5;
        return delay;

      default:
        return null;
    }
  }

  private createEQNode(
    context: BaseAudioContext,
    effect: Effect,
  ): AudioNode | null {
    const bands = (
      effect.params as {
        bands?: Array<{
          type: string;
          frequency: number;
          gain: number;
          q: number;
        }>;
      }
    ).bands;
    if (!bands || bands.length === 0) return null;

    let firstNode: BiquadFilterNode | null = null;
    let lastNode: BiquadFilterNode | null = null;

    for (const band of bands) {
      const filter = context.createBiquadFilter();
      filter.type = band.type as BiquadFilterType;
      filter.frequency.value = band.frequency;
      filter.gain.value = band.gain;
      filter.Q.value = band.q;

      if (!firstNode) {
        firstNode = filter;
      }
      if (lastNode) {
        lastNode.connect(filter);
      }
      lastNode = filter;
    }

    return firstNode;
  }

  detectSilence(buffer: AudioBuffer, threshold: number = -60): TimeRange[] {
    const silentRanges: TimeRange[] = [];
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const thresholdLinear = Math.pow(10, threshold / 20);

    let silenceStart: number | null = null;
    const windowSize = Math.floor(sampleRate * 0.1); // 100ms window

    for (let i = 0; i < channelData.length; i += windowSize) {
      const end = Math.min(i + windowSize, channelData.length);
      let maxAmp = 0;

      for (let j = i; j < end; j++) {
        maxAmp = Math.max(maxAmp, Math.abs(channelData[j]));
      }

      const isSilent = maxAmp < thresholdLinear;
      const currentTime = i / sampleRate;

      if (isSilent && silenceStart === null) {
        silenceStart = currentTime;
      } else if (!isSilent && silenceStart !== null) {
        silentRanges.push({ start: silenceStart, end: currentTime });
        silenceStart = null;
      }
    }
    if (silenceStart !== null) {
      silentRanges.push({
        start: silenceStart,
        end: buffer.duration,
      });
    }

    return silentRanges;
  }

  measureLoudness(buffer: AudioBuffer): LoudnessMetrics {
    const channelData = buffer.getChannelData(0);
    let sumSquares = 0;
    let peak = 0;

    for (let i = 0; i < channelData.length; i++) {
      const sample = channelData[i];
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }

    const rms = Math.sqrt(sumSquares / channelData.length);
    const rmsDb = 20 * Math.log10(rms || 0.0001);
    const peakDb = 20 * Math.log10(peak || 0.0001);

    // Approximate LUFS (simplified - real implementation would use K-weighting)
    const lufs = rmsDb - 0.691; // Rough approximation

    return {
      integrated: lufs,
      shortTerm: lufs,
      momentary: lufs,
      truePeak: peakDb,
      range: 10, // Placeholder
    };
  }

  clearCache(): void {
    this.mediaBuffers.clear();
    this.mediaBufferBytes = 0;
    this.noAudioMedia.clear();
    this.failedAudioDecodes.clear();
    this.currentAudioSourceKeys.clear();

    for (const decoder of this.segmentedAudioDecoders.values()) {
      decoder.dispose();
    }
    this.segmentedAudioDecoders.clear();
  }

  async resume(): Promise<void> {
    if (this.audioContext?.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  async suspend(): Promise<void> {
    if (this.audioContext?.state === "running") {
      await this.audioContext.suspend();
    }
  }

  async dispose(): Promise<void> {
    this.clearCache();
    this.trackNodes.clear();
    await this.effectsEngine?.dispose();
    this.effectsEngine = null;

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.masterGain = null;
    this.initialized = false;
  }
}

interface AudioTrackNodes {
  gainNode: GainNode;
  pannerNode: StereoPannerNode;
  effectNodes: AudioNode[];
}
let audioEngineInstance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!audioEngineInstance) {
    audioEngineInstance = new AudioEngine();
  }
  return audioEngineInstance;
}
