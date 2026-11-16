import type { AutomationPoint } from "../types/timeline";

type AutomationCurve =
  | "linear"
  | "exponential"
  | "logarithmic"
  | "s-curve"
  | "bezier";

interface AudioBezierControlPoints {
  readonly cp1x: number; // 0 to 1
  readonly cp1y: number; // 0 to 1
  readonly cp2x: number; // 0 to 1
  readonly cp2y: number; // 0 to 1
}

interface VolumeKeyframe extends AutomationPoint {
  readonly curve?: AutomationCurve;
  readonly bezierControls?: AudioBezierControlPoints;
}

interface FadeConfig {
  readonly duration: number; // In seconds
  readonly curve: AutomationCurve;
  readonly bezierControls?: AudioBezierControlPoints;
}

interface DuckingConfig {
  readonly threshold: number; // dB level to trigger ducking (-60 to 0)
  readonly reduction: number; // Amount to reduce background (0 to 1)
  readonly attack: number; // Time to duck in seconds
  readonly release: number; // Time to release in seconds
  readonly holdTime: number; // Minimum time to hold ducking
}

interface VolumeAutomationResult {
  readonly buffer: AudioBuffer;
  readonly appliedKeyframes: number;
}

const VOLUME_MIN = 0;
const VOLUME_MAX = 4;

export function clampVolume(volume: number): number {
  return Math.max(VOLUME_MIN, Math.min(VOLUME_MAX, volume));
}

class VolumeAutomation {
  private audioContext: AudioContext | OfflineAudioContext | null = null;
  private initialized = false;

  constructor(context?: AudioContext | OfflineAudioContext) {
    this.audioContext = context || null;
  }

  async initialize(
    context?: AudioContext | OfflineAudioContext,
  ): Promise<void> {
    if (context) {
      this.audioContext = context;
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext({
        latencyHint: "interactive",
        sampleRate: 48000,
      });
    }

    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized && this.audioContext !== null;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.audioContext) {
      throw new Error(
        "VolumeAutomation not initialized. Call initialize() first.",
      );
    }
  }

  async applyVolumeAutomation(
    buffer: AudioBuffer,
    keyframes: VolumeKeyframe[],
    baseVolume: number = 1,
  ): Promise<VolumeAutomationResult> {
    this.ensureInitialized();

    const clampedBaseVolume = clampVolume(baseVolume);
    if (keyframes.length === 0) {
      const result = await this.applyConstantVolume(buffer, clampedBaseVolume);
      return { buffer: result, appliedKeyframes: 0 };
    }
    const sortedKeyframes = [...keyframes].sort((a, b) => a.time - b.time);
    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate,
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = offlineContext.createGain();
    this.scheduleVolumeKeyframes(
      gainNode,
      sortedKeyframes,
      clampedBaseVolume,
      buffer.duration,
    );

    source.connect(gainNode);
    gainNode.connect(offlineContext.destination);
    source.start(0);

    const processedBuffer = await offlineContext.startRendering();

    return {
      buffer: processedBuffer,
      appliedKeyframes: sortedKeyframes.length,
    };
  }

  private scheduleVolumeKeyframes(
    gainNode: GainNode,
    keyframes: VolumeKeyframe[],
    baseVolume: number,
    duration: number,
  ): void {
    const firstKeyframe = keyframes[0];
    const initialValue =
      firstKeyframe && firstKeyframe.time === 0
        ? clampVolume(firstKeyframe.value)
        : baseVolume;

    gainNode.gain.setValueAtTime(initialValue, 0);
    for (let i = 0; i < keyframes.length; i++) {
      const kf = keyframes[i];
      const clampedValue = clampVolume(kf.value);
      const curve = kf.curve || "linear";

      if (kf.time === 0) {
        gainNode.gain.setValueAtTime(clampedValue, 0);
        continue;
      }
      const prevKf = i > 0 ? keyframes[i - 1] : null;
      const prevValue = prevKf ? clampVolume(prevKf.value) : baseVolume;
      const prevTime = prevKf ? prevKf.time : 0;

      this.applyInterpolation(
        gainNode,
        prevValue,
        clampedValue,
        prevTime,
        kf.time,
        curve,
        kf.bezierControls,
      );
    }

    // Hold last value until end
    const lastKeyframe = keyframes[keyframes.length - 1];
    if (lastKeyframe && lastKeyframe.time < duration) {
      gainNode.gain.setValueAtTime(
        clampVolume(lastKeyframe.value),
        lastKeyframe.time,
      );
    }
  }

  private applyInterpolation(
    gainNode: GainNode,
    fromValue: number,
    toValue: number,
    fromTime: number,
    toTime: number,
    curve: AutomationCurve,
    bezierControls?: AudioBezierControlPoints,
  ): void {
    switch (curve) {
      case "linear":
        gainNode.gain.linearRampToValueAtTime(toValue, toTime);
        break;

      case "exponential":
        // Exponential ramp can't handle zero values
        const expFrom = Math.max(0.0001, fromValue);
        const expTo = Math.max(0.0001, toValue);
        gainNode.gain.setValueAtTime(expFrom, fromTime);
        gainNode.gain.exponentialRampToValueAtTime(expTo, toTime);
        break;

      case "logarithmic":
        // Logarithmic curve using setValueCurveAtTime
        const logCurve = this.generateLogarithmicCurve(fromValue, toValue, 128);
        gainNode.gain.setValueCurveAtTime(
          logCurve,
          fromTime,
          toTime - fromTime,
        );
        break;

      case "s-curve":
        // S-curve (ease-in-out) using setValueCurveAtTime
        const sCurve = this.generateSCurve(fromValue, toValue, 128);
        gainNode.gain.setValueCurveAtTime(sCurve, fromTime, toTime - fromTime);
        break;

      case "bezier":
        // Bezier curve using setValueCurveAtTime
        const bezierCurve = this.generateBezierCurve(
          fromValue,
          toValue,
          bezierControls || { cp1x: 0.25, cp1y: 0.1, cp2x: 0.75, cp2y: 0.9 },
          128,
        );
        gainNode.gain.setValueCurveAtTime(
          bezierCurve,
          fromTime,
          toTime - fromTime,
        );
        break;

      default:
        gainNode.gain.linearRampToValueAtTime(toValue, toTime);
    }
  }

  private generateLogarithmicCurve(
    fromValue: number,
    toValue: number,
    samples: number,
  ): Float32Array {
    const curve = new Float32Array(samples);
    const range = toValue - fromValue;

    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      // Logarithmic interpolation
      const logT = Math.log10(1 + t * 9) / Math.log10(10);
      curve[i] = fromValue + range * logT;
    }

    return curve;
  }

  private generateSCurve(
    fromValue: number,
    toValue: number,
    samples: number,
  ): Float32Array {
    const curve = new Float32Array(samples);
    const range = toValue - fromValue;

    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      const smoothT = t * t * (3 - 2 * t);
      curve[i] = fromValue + range * smoothT;
    }

    return curve;
  }

  private generateBezierCurve(
    fromValue: number,
    toValue: number,
    controls: AudioBezierControlPoints,
    samples: number,
  ): Float32Array {
    const curve = new Float32Array(samples);

    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      // Cubic bezier calculation
      const bezierT = this.cubicBezier(t, 0, controls.cp1y, controls.cp2y, 1);
      curve[i] = fromValue + (toValue - fromValue) * bezierT;
    }

    return curve;
  }

  private cubicBezier(
    t: number,
    p0: number,
    p1: number,
    p2: number,
    p3: number,
  ): number {
    const oneMinusT = 1 - t;
    return (
      oneMinusT * oneMinusT * oneMinusT * p0 +
      3 * oneMinusT * oneMinusT * t * p1 +
      3 * oneMinusT * t * t * p2 +
      t * t * t * p3
    );
  }

  private async applyConstantVolume(
    buffer: AudioBuffer,
    volume: number,
  ): Promise<AudioBuffer> {
    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate,
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = offlineContext.createGain();
    gainNode.gain.value = clampVolume(volume);

    source.connect(gainNode);
    gainNode.connect(offlineContext.destination);
    source.start(0);

    return offlineContext.startRendering();
  }

  async applyFadeIn(
    buffer: AudioBuffer,
    config: FadeConfig,
    targetVolume: number = 1,
  ): Promise<AudioBuffer> {
    this.ensureInitialized();

    const clampedTarget = clampVolume(targetVolume);
    const fadeDuration = Math.min(config.duration, buffer.duration);

    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate,
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = offlineContext.createGain();
    gainNode.gain.setValueAtTime(0, 0);
    this.applyInterpolation(
      gainNode,
      0,
      clampedTarget,
      0,
      fadeDuration,
      config.curve,
      config.bezierControls,
    );

    // Hold at target volume after fade
    gainNode.gain.setValueAtTime(clampedTarget, fadeDuration);

    source.connect(gainNode);
    gainNode.connect(offlineContext.destination);
    source.start(0);

    return offlineContext.startRendering();
  }

  async applyFadeOut(
    buffer: AudioBuffer,
    config: FadeConfig,
    startVolume: number = 1,
  ): Promise<AudioBuffer> {
    this.ensureInitialized();

    const clampedStart = clampVolume(startVolume);
    const fadeDuration = Math.min(config.duration, buffer.duration);
    const fadeStartTime = buffer.duration - fadeDuration;

    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate,
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = offlineContext.createGain();

    // Hold at start volume until fade begins
    gainNode.gain.setValueAtTime(clampedStart, 0);
    gainNode.gain.setValueAtTime(clampedStart, fadeStartTime);
    this.applyInterpolation(
      gainNode,
      clampedStart,
      0,
      fadeStartTime,
      buffer.duration,
      config.curve,
      config.bezierControls,
    );

    source.connect(gainNode);
    gainNode.connect(offlineContext.destination);
    source.start(0);

    return offlineContext.startRendering();
  }

  async applyFades(
    buffer: AudioBuffer,
    fadeIn: FadeConfig,
    fadeOut: FadeConfig,
    volume: number = 1,
  ): Promise<AudioBuffer> {
    this.ensureInitialized();

    const clampedVolume = clampVolume(volume);
    const fadeInDuration = Math.min(fadeIn.duration, buffer.duration / 2);
    const fadeOutDuration = Math.min(fadeOut.duration, buffer.duration / 2);
    const fadeOutStart = buffer.duration - fadeOutDuration;

    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate,
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = offlineContext.createGain();

    // Fade in
    gainNode.gain.setValueAtTime(0, 0);
    this.applyInterpolation(
      gainNode,
      0,
      clampedVolume,
      0,
      fadeInDuration,
      fadeIn.curve,
      fadeIn.bezierControls,
    );

    // Hold at volume
    gainNode.gain.setValueAtTime(clampedVolume, fadeInDuration);
    gainNode.gain.setValueAtTime(clampedVolume, fadeOutStart);

    // Fade out
    this.applyInterpolation(
      gainNode,
      clampedVolume,
      0,
      fadeOutStart,
      buffer.duration,
      fadeOut.curve,
      fadeOut.bezierControls,
    );

    source.connect(gainNode);
    gainNode.connect(offlineContext.destination);
    source.start(0);

    return offlineContext.startRendering();
  }

  getVolumeAtTime(
    time: number,
    keyframes: VolumeKeyframe[],
    baseVolume: number = 1,
  ): number {
    if (keyframes.length === 0) {
      return clampVolume(baseVolume);
    }

    const sorted = [...keyframes].sort((a, b) => a.time - b.time);

    // Before first keyframe
    if (time <= sorted[0].time) {
      return clampVolume(sorted[0].value);
    }

    // After last keyframe
    if (time >= sorted[sorted.length - 1].time) {
      return clampVolume(sorted[sorted.length - 1].value);
    }
    let prevKf = sorted[0];
    let nextKf = sorted[1];

    for (let i = 0; i < sorted.length - 1; i++) {
      if (time >= sorted[i].time && time < sorted[i + 1].time) {
        prevKf = sorted[i];
        nextKf = sorted[i + 1];
        break;
      }
    }
    const t = (time - prevKf.time) / (nextKf.time - prevKf.time);
    const curve = nextKf.curve || "linear";

    let interpolatedT: number;
    switch (curve) {
      case "exponential":
        interpolatedT = Math.pow(t, 2);
        break;
      case "logarithmic":
        interpolatedT = Math.log10(1 + t * 9) / Math.log10(10);
        break;
      case "s-curve":
        interpolatedT = t * t * (3 - 2 * t);
        break;
      case "bezier":
        const controls = nextKf.bezierControls || {
          cp1x: 0.25,
          cp1y: 0.1,
          cp2x: 0.75,
          cp2y: 0.9,
        };
        interpolatedT = this.cubicBezier(t, 0, controls.cp1y, controls.cp2y, 1);
        break;
      default:
        interpolatedT = t;
    }

    const value = prevKf.value + (nextKf.value - prevKf.value) * interpolatedT;
    return clampVolume(value);
  }

  async dispose(): Promise<void> {
    if (this.audioContext && "close" in this.audioContext) {
      await (this.audioContext as AudioContext).close();
    }

    this.audioContext = null;
    this.initialized = false;
  }
}
export class AudioDucker {
  private audioContext: AudioContext | OfflineAudioContext | null = null;
  private initialized = false;

  constructor(context?: AudioContext | OfflineAudioContext) {
    this.audioContext = context || null;
  }

  async initialize(
    context?: AudioContext | OfflineAudioContext,
  ): Promise<void> {
    if (context) {
      this.audioContext = context;
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext({
        latencyHint: "interactive",
        sampleRate: 48000,
      });
    }

    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized && this.audioContext !== null;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.audioContext) {
      throw new Error("AudioDucker not initialized. Call initialize() first.");
    }
  }

  detectAudioPresence(
    buffer: AudioBuffer,
    threshold: number = -30,
    windowSize: number = 0.05,
  ): Array<{ start: number; end: number }> {
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const windowSamples = Math.floor(windowSize * sampleRate);
    const thresholdLinear = Math.pow(10, threshold / 20);

    const presenceRanges: Array<{ start: number; end: number }> = [];
    let presenceStart: number | null = null;

    for (let i = 0; i < channelData.length; i += windowSamples) {
      const end = Math.min(i + windowSamples, channelData.length);
      let sumSquares = 0;
      for (let j = i; j < end; j++) {
        sumSquares += channelData[j] * channelData[j];
      }
      const rms = Math.sqrt(sumSquares / (end - i));

      const currentTime = i / sampleRate;
      const isPresent = rms > thresholdLinear;

      if (isPresent && presenceStart === null) {
        presenceStart = currentTime;
      } else if (!isPresent && presenceStart !== null) {
        presenceRanges.push({ start: presenceStart, end: currentTime });
        presenceStart = null;
      }
    }
    if (presenceStart !== null) {
      presenceRanges.push({ start: presenceStart, end: buffer.duration });
    }

    return presenceRanges;
  }

  generateDuckingKeyframes(
    foregroundBuffer: AudioBuffer,
    config: DuckingConfig,
    backgroundVolume: number = 1,
  ): VolumeKeyframe[] {
    const presenceRanges = this.detectAudioPresence(
      foregroundBuffer,
      config.threshold,
    );

    if (presenceRanges.length === 0) {
      return [];
    }

    const keyframes: VolumeKeyframe[] = [];
    const duckedVolume = clampVolume(backgroundVolume * (1 - config.reduction));
    const normalVolume = clampVolume(backgroundVolume);
    const mergedRanges = this.mergePresenceRanges(
      presenceRanges,
      config.holdTime,
    );

    for (const range of mergedRanges) {
      const duckStart = Math.max(0, range.start - config.attack);
      const duckEnd = range.end + config.release;
      keyframes.push({
        time: duckStart,
        value: normalVolume,
        curve: "s-curve",
      });

      keyframes.push({
        time: range.start,
        value: duckedVolume,
        curve: "s-curve",
      });
      keyframes.push({
        time: range.end,
        value: duckedVolume,
        curve: "s-curve",
      });

      keyframes.push({
        time: duckEnd,
        value: normalVolume,
        curve: "s-curve",
      });
    }
    return this.deduplicateKeyframes(keyframes);
  }

  private mergePresenceRanges(
    ranges: Array<{ start: number; end: number }>,
    holdTime: number,
  ): Array<{ start: number; end: number }> {
    if (ranges.length === 0) return [];

    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];
      if (current.start <= last.end + holdTime) {
        last.end = Math.max(last.end, current.end);
      } else {
        merged.push({ ...current });
      }
    }

    return merged;
  }

  private deduplicateKeyframes(keyframes: VolumeKeyframe[]): VolumeKeyframe[] {
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    const result: VolumeKeyframe[] = [];

    for (const kf of sorted) {
      const last = result[result.length - 1];
      // Skip if same time (keep the first one)
      if (!last || Math.abs(kf.time - last.time) > 0.001) {
        result.push(kf);
      }
    }

    return result;
  }

  async applyDucking(
    backgroundBuffer: AudioBuffer,
    foregroundBuffer: AudioBuffer,
    config: DuckingConfig,
    backgroundVolume: number = 1,
  ): Promise<AudioBuffer> {
    this.ensureInitialized();

    const keyframes = this.generateDuckingKeyframes(
      foregroundBuffer,
      config,
      backgroundVolume,
    );

    if (keyframes.length === 0) {
      // No ducking needed, just apply constant volume
      const volumeAutomation = new VolumeAutomation(this.audioContext!);
      await volumeAutomation.initialize(this.audioContext!);
      const result = await volumeAutomation.applyVolumeAutomation(
        backgroundBuffer,
        [],
        backgroundVolume,
      );
      return result.buffer;
    }

    const volumeAutomation = new VolumeAutomation(this.audioContext!);
    await volumeAutomation.initialize(this.audioContext!);

    const result = await volumeAutomation.applyVolumeAutomation(
      backgroundBuffer,
      keyframes,
      backgroundVolume,
    );

    return result.buffer;
  }

  createRealtimeDucker(
    foregroundSource: AudioNode,
    backgroundSource: AudioNode,
    config: DuckingConfig,
  ): {
    output: GainNode;
    analyser: AnalyserNode;
    backgroundGain: GainNode;
  } {
    this.ensureInitialized();
    const context = this.audioContext!;
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    const backgroundGain = context.createGain();
    backgroundGain.gain.value = 1;
    const output = context.createGain();
    foregroundSource.connect(analyser);
    analyser.connect(output);
    backgroundSource.connect(backgroundGain);
    backgroundGain.connect(output);
    const thresholdLinear = Math.pow(10, config.threshold / 20);
    const dataArray = new Float32Array(analyser.frequencyBinCount);

    const updateDucking = () => {
      analyser.getFloatTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sumSquares += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);
      const targetGain = rms > thresholdLinear ? 1 - config.reduction : 1;

      // Smooth transition
      const currentGain = backgroundGain.gain.value;
      const smoothingFactor =
        targetGain < currentGain
          ? config.attack * 60 // Attack (faster)
          : config.release * 60; // Release (slower)

      backgroundGain.gain.value +=
        (targetGain - currentGain) / Math.max(1, smoothingFactor);

      requestAnimationFrame(updateDucking);
    };
    updateDucking();

    return { output, analyser, backgroundGain };
  }

  async dispose(): Promise<void> {
    if (this.audioContext && "close" in this.audioContext) {
      await (this.audioContext as AudioContext).close();
    }

    this.audioContext = null;
    this.initialized = false;
  }
}
