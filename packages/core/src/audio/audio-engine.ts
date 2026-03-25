import type { Timeline, Track, Clip, Effect } from "../types/timeline";
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

const SEGMENTED_AUDIO_DECODE_THRESHOLD_SECONDS = 120;

type MediaBunnyAudioInput = {
  getPrimaryAudioTrack(): Promise<import("mediabunny").InputAudioTrack | null>;
  getAudioTracks(): Promise<import("mediabunny").InputAudioTrack[]>;
  [Symbol.dispose]?: () => void;
};

class SegmentedAudioDecoder {
  private input: MediaBunnyAudioInput | null = null;
  private sink: InstanceType<typeof import("mediabunny").AudioBufferSink> | null = null;
  private initialized = false;

  constructor(private readonly file: File | Blob) {}

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      const { Input, ALL_FORMATS, BlobSource, AudioBufferSink } =
        await import("mediabunny");

      this.input = new Input({
        source: new BlobSource(this.file),
        formats: ALL_FORMATS,
      }) as unknown as MediaBunnyAudioInput;

      let audioTrack = await this.input.getPrimaryAudioTrack();
      if (!audioTrack) {
        const audioTracks = await this.input.getAudioTracks();
        audioTrack = audioTracks[0] ?? null;
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
  private segmentedAudioDecoders: Map<string, SegmentedAudioDecoder> = new Map();

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
  ): Promise<RenderedAudio> {
    this.ensureInitialized();

    const { timeline, mediaLibrary, settings } = project;
    const sampleRate = settings.sampleRate || this.config.sampleRate;
    const channels = settings.channels || this.config.channels;
    const safeDuration = Math.max(duration, 0.001);
    const frameCount = Math.max(1, Math.ceil(safeDuration * sampleRate));
    const offlineContext = new OfflineAudioContext(
      channels,
      frameCount,
      sampleRate,
    );
    const audioTracks = this.getAudioTracksAtTime(
      timeline,
      startTime,
      duration,
    );
    const hasSoloTracks = audioTracks.some((t) => t.solo);
    for (const trackInfo of audioTracks) {
      if (this.isTrackMuted(trackInfo, hasSoloTracks)) continue;

      for (const clipInfo of trackInfo.clips) {
        const mediaItem = mediaLibrary.items.find(
          (m) => m.id === clipInfo.mediaId,
        );
        if (!mediaItem) continue;
        await this.renderClipToContext(
          offlineContext,
          mediaItem,
          clipInfo,
          startTime,
        );
      }
    }
    const renderedBuffer = await offlineContext.startRendering();

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
    if (trackInfo.muted) return true;
    if (hasSoloTracks && !trackInfo.solo) return true;

    return false;
  }

  /**
   * Gets which tracks are audible based on mute and solo state.
   *
   * @param tracks - Array of tracks to evaluate
   * @returns Map of trackId to audibility boolean
   */
  getEffectiveTrackAudibility(tracks: Track[]): Map<string, boolean> {
    const audibility = new Map<string, boolean>();
    const hasSoloTracks = tracks.some((t) => t.solo);

    for (const track of tracks) {
      // Track is audible if:
      // 1. Not muted AND
      // 2. Either no tracks are soloed OR this track is soloed
      const isAudible = !track.muted && (!hasSoloTracks || track.solo);
      audibility.set(track.id, isAudible);
    }

    return audibility;
  }

  private getAudioTracksAtTime(
    timeline: Timeline,
    startTime: number,
    duration: number,
  ): AudioTrackRenderInfo[] {
    const result: AudioTrackRenderInfo[] = [];
    const endTime = startTime + duration;

    timeline.tracks.forEach((track, index) => {
      if (track.type !== "audio" && track.type !== "video") return;

      const clips = this.getClipsInRange(track, startTime, endTime);
      if (clips.length === 0) return;

      result.push({
        trackId: track.id,
        index,
        muted: track.muted,
        solo: track.solo,
        clips: clips.map((clip) =>
          this.createClipRenderInfo(clip, startTime, endTime),
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
  ): AudioClipRenderInfo {
    const clipStart = Math.max(clip.startTime, rangeStart);
    const clipEnd = Math.min(clip.startTime + clip.duration, rangeEnd);
    const offsetInClip = clipStart - clip.startTime;
    const sourceTime = clip.inPoint + offsetInClip;
    const panEffect = clip.effects.find((e) => e.type === "pan");
    const pan =
      panEffect && typeof panEffect.params.value === "number"
        ? panEffect.params.value
        : 0;

    return {
      clipId: clip.id,
      mediaId: clip.mediaId,
      sourceTime,
      timelineStartTime: clipStart,
      duration: clipEnd - clipStart,
      volume: clip.volume,
      pan,
      effects: clip.effects,
      fadeIn: clip.fade?.fadeIn,
      fadeOut: clip.fade?.fadeOut,
      speed: (clip as any).speed || 1,
      reversed: (clip as any).reversed || false,
    };
  }

  private async getAudioBuffer(
    mediaItem: MediaItem,
    context: BaseAudioContext,
  ): Promise<AudioBuffer | null> {
    const cached = this.mediaBuffers.get(mediaItem.id);
    if (cached) return cached;

    if (!mediaItem.blob) {
      console.warn(`No blob available for media item ${mediaItem.id}`);
      return null;
    }

    try {
      const arrayBuffer = await mediaItem.blob.arrayBuffer();
      const audioBuffer = await context.decodeAudioData(arrayBuffer);

      this.mediaBuffers.set(mediaItem.id, audioBuffer);
      return audioBuffer;
    } catch (error) {
      if (mediaItem.type === "video") {
        try {
          const audioBuffer = await this.extractAudioFromVideo(
            mediaItem,
            context,
          );
          if (audioBuffer) {
            this.mediaBuffers.set(mediaItem.id, audioBuffer);
            return audioBuffer;
          }
        } catch (videoError) {
          // Video audio extraction failed
        }
      }
      return null;
    }
  }

  private async extractAudioFromVideo(
    mediaItem: MediaItem,
    context: BaseAudioContext,
  ): Promise<AudioBuffer | null> {
    if (!mediaItem.blob) return null;

    try {
      const mediabunny = await import("mediabunny");
      const { Input, ALL_FORMATS, BlobSource, AudioSampleSink } = mediabunny;

      const input = new Input({
        source: new BlobSource(mediaItem.blob),
        formats: ALL_FORMATS,
      });

      let audioTrack = await input.getPrimaryAudioTrack();
      if (!audioTrack) {
        const audioTracks = await input.getAudioTracks();
        if (audioTracks.length > 0) {
          audioTrack = audioTracks[0];
        }
      }

      if (!audioTrack) {
        input[Symbol.dispose]?.();
        return null;
      }

      const canDecode = await audioTrack.canDecode();
      if (!canDecode) {
        input[Symbol.dispose]?.();
        return null;
      }

      const duration = await audioTrack.computeDuration();
      if (!duration || duration <= 0) {
        input[Symbol.dispose]?.();
        return null;
      }

      const sampleRate = context.sampleRate;
      const channels = 2;
      const samplesPerSecond = 1000;
      const totalSamplePoints = Math.ceil(duration * samplesPerSecond);

      const sink = new AudioSampleSink(audioTrack);
      const timestamps = Array.from(
        { length: totalSamplePoints },
        (_, i) => i / samplesPerSecond,
      );

      const allSamples: Float32Array[] = [];

      for await (const sample of sink.samplesAtTimestamps(timestamps)) {
        if (!sample) {
          allSamples.push(new Float32Array(0));
          continue;
        }
        const bytesNeeded = sample.allocationSize({
          format: "f32",
          planeIndex: 0,
        });
        const floats = new Float32Array(bytesNeeded / 4);
        sample.copyTo(floats, { format: "f32", planeIndex: 0 });
        allSamples.push(floats);
        sample.close();
      }

      input[Symbol.dispose]?.();

      const totalFrames = Math.ceil(duration * sampleRate);
      const leftChannel = new Float32Array(totalFrames);
      const rightChannel = new Float32Array(totalFrames);

      let frameIndex = 0;
      for (const sampleData of allSamples) {
        if (sampleData.length === 0) continue;
        const numChannels = sampleData.length >= 2 ? 2 : 1;
        const framesInSample = Math.floor(sampleData.length / numChannels);

        for (let i = 0; i < framesInSample && frameIndex < totalFrames; i++) {
          if (numChannels === 2) {
            leftChannel[frameIndex] = sampleData[i * 2] || 0;
            rightChannel[frameIndex] = sampleData[i * 2 + 1] || 0;
          } else {
            leftChannel[frameIndex] = sampleData[i] || 0;
            rightChannel[frameIndex] = sampleData[i] || 0;
          }
          frameIndex++;
        }
      }

      if (frameIndex === 0) {
        return null;
      }

      const audioBuffer = context.createBuffer(channels, frameIndex, sampleRate);
      audioBuffer.copyToChannel(leftChannel.subarray(0, frameIndex), 0);
      audioBuffer.copyToChannel(rightChannel.subarray(0, frameIndex), 1);

      return audioBuffer;
    } catch (error) {
      return null;
    }
  }

  private async renderClipToContext(
    context: OfflineAudioContext,
    mediaItem: MediaItem,
    clipInfo: AudioClipRenderInfo,
    renderStartTime: number,
  ): Promise<void> {
    if (this.shouldUseSegmentedAudioDecoding(mediaItem, clipInfo)) {
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

    const audioBuffer = await this.getAudioBuffer(mediaItem, context);
    if (!audioBuffer) {
      return;
    }

    const { gainNode } = this.createClipOutputNodes(context, clipInfo);
    const source = context.createBufferSource();
    source.buffer = audioBuffer;

    const speed = clipInfo.speed || 1;
    const reversed = clipInfo.reversed || false;

    source.playbackRate.value = reversed ? -speed : speed;

    source.connect(gainNode);
    const contextStartTime = Math.max(
      0,
      clipInfo.timelineStartTime - renderStartTime,
    );
    this.applyFades(gainNode, clipInfo, contextStartTime);

    const startOffset = reversed
      ? audioBuffer.duration - clipInfo.sourceTime
      : clipInfo.sourceTime;

    source.start(contextStartTime, startOffset, clipInfo.duration);
  }

  private shouldUseSegmentedAudioDecoding(
    mediaItem: MediaItem,
    clipInfo: AudioClipRenderInfo,
  ): boolean {
    return (
      mediaItem.metadata.duration >= SEGMENTED_AUDIO_DECODE_THRESHOLD_SECONDS &&
      (clipInfo.speed || 1) === 1 &&
      !clipInfo.reversed
    );
  }

  private async renderClipToContextFromSegments(
    context: OfflineAudioContext,
    mediaItem: MediaItem,
    clipInfo: AudioClipRenderInfo,
    renderStartTime: number,
  ): Promise<boolean> {
    const decoder = await this.getSegmentedAudioDecoder(mediaItem);
    if (!decoder) {
      return false;
    }

    const rangeStart = Math.max(0, clipInfo.sourceTime);
    const rangeEnd = rangeStart + clipInfo.duration;
    if (rangeEnd <= rangeStart) {
      return false;
    }

    const { gainNode } = this.createClipOutputNodes(context, clipInfo);
    const contextStartTime = Math.max(
      0,
      clipInfo.timelineStartTime - renderStartTime,
    );
    this.applyFades(gainNode, clipInfo, contextStartTime);

    let rendered = false;

    for await (const wrapped of decoder.buffers(rangeStart, rangeEnd)) {
      const bufferStart = wrapped.timestamp;
      const bufferEnd = wrapped.timestamp + wrapped.duration;
      const overlapStart = Math.max(rangeStart, bufferStart);
      const overlapEnd = Math.min(rangeEnd, bufferEnd);

      if (overlapEnd <= overlapStart) {
        continue;
      }

      const source = context.createBufferSource();
      source.buffer = wrapped.buffer;
      source.connect(gainNode);
      source.start(
        contextStartTime + (overlapStart - rangeStart),
        overlapStart - bufferStart,
        overlapEnd - overlapStart,
      );
      rendered = true;
    }

    return rendered;
  }

  private createClipOutputNodes(
    context: OfflineAudioContext,
    clipInfo: AudioClipRenderInfo,
  ): {
    gainNode: GainNode;
    pannerNode: StereoPannerNode;
  } {
    const gainNode = context.createGain();
    gainNode.gain.value = clipInfo.volume;

    const pannerNode = context.createStereoPanner();
    pannerNode.pan.value = Math.max(-1, Math.min(1, clipInfo.pan));

    gainNode.connect(pannerNode);
    pannerNode.connect(context.destination);

    return { gainNode, pannerNode };
  }

  private async getSegmentedAudioDecoder(
    mediaItem: MediaItem,
  ): Promise<SegmentedAudioDecoder | null> {
    if (!mediaItem.blob) {
      return null;
    }

    const cached = this.segmentedAudioDecoders.get(mediaItem.id);
    if (cached) {
      return cached;
    }

    const decoder = new SegmentedAudioDecoder(mediaItem.blob);
    const initialized = await decoder.initialize();
    if (!initialized) {
      return null;
    }

    this.segmentedAudioDecoders.set(mediaItem.id, decoder);
    return decoder;
  }

  private applyFades(
    gainNode: GainNode,
    clipInfo: AudioClipRenderInfo,
    startTime: number,
  ): void {
    const { fadeIn, fadeOut, duration, volume } = clipInfo;

    if (fadeIn && fadeIn > 0) {
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(volume, startTime + fadeIn);
    }

    if (fadeOut && fadeOut > 0) {
      const fadeOutStart = startTime + duration - fadeOut;
      gainNode.gain.setValueAtTime(volume, fadeOutStart);
      gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    }
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

  getChannelStates(timeline: Timeline): AudioChannelState[] {
    return timeline.tracks
      .filter((track) => track.type === "audio" || track.type === "video")
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

export async function initializeAudioEngine(): Promise<AudioEngine> {
  const engine = getAudioEngine();
  await engine.initialize();
  return engine;
}
