import {
  AudioEngine,
  SegmentedAudioDecoder,
  autoLearnNoiseProfile,
  extractAudioSegment,
  getCompoundClipId,
  getProjectClipCapabilities,
  SpectralNoiseReducer,
  type Clip,
  type Project,
} from "@openreel/core";
import type {
  NoiseProfileData,
  SerializedNoiseProfile,
} from "../bridges/audio-bridge-effects";
import { findNoiseTarget } from "./noise-reduction-edit";
import { loadAudioBuffer } from "../utils/load-audio-buffer";
interface RecommendationProfileProgress {
  progress: number;
  message: string;
}
interface NoiseAnalysisResult {
  recommendationProfile: NoiseProfileData;
  learnedProfile: {
    profile: NoiseProfileData;
    serializedProfile: SerializedNoiseProfile;
  } | null;
}
interface RecommendationSampleRange {
  start: number;
  end: number;
}

const MAX_RECOMMENDATION_SAMPLE_SECONDS = 24;
const MAX_RECOMMENDATION_SAMPLE_WINDOWS = 3;
const MIN_RECOMMENDATION_WINDOW_SECONDS = 4;

export const getRecommendationSampleRanges = (
  duration: number,
): RecommendationSampleRange[] => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return [];
  }

  if (duration <= MAX_RECOMMENDATION_SAMPLE_SECONDS) {
    return [{ start: 0, end: duration }];
  }

  const maxWindowsByDuration = Math.max(
    1,
    Math.min(
      MAX_RECOMMENDATION_SAMPLE_WINDOWS,
      Math.floor(duration / MIN_RECOMMENDATION_WINDOW_SECONDS),
    ),
  );
  const windowCount = Math.max(
    1,
    Math.min(
      maxWindowsByDuration,
      Math.ceil(duration / MAX_RECOMMENDATION_SAMPLE_SECONDS),
    ),
  );
  const windowDuration = Math.min(
    duration,
    MAX_RECOMMENDATION_SAMPLE_SECONDS / windowCount,
  );
  const firstCenter = windowCount === 1 ? 0.5 : 0.18;
  const lastCenter = windowCount === 1 ? 0.5 : 0.82;

  return Array.from({ length: windowCount }, (_, index) => {
    const center =
      windowCount === 1
        ? 0.5
        : firstCenter +
          ((lastCenter - firstCenter) * index) / (windowCount - 1);
    const maxStart = Math.max(0, duration - windowDuration);
    const start = Math.min(
      maxStart,
      Math.max(0, duration * center - windowDuration / 2),
    );

    return {
      start,
      end: Math.min(duration, start + windowDuration),
    };
  });
};

const buildRecommendationSampleBuffer = (
  audioBuffer: AudioBuffer,
  context: BaseAudioContext,
  onProgress?: (progress: RecommendationProfileProgress) => void,
): { sampleBuffer: AudioBuffer; sampleCount: number } => {
  const sampleRanges = getRecommendationSampleRanges(audioBuffer.duration);

  if (sampleRanges.length === 0) {
    throw new Error("Clip audio range is empty");
  }

  if (
    sampleRanges.length === 1 &&
    sampleRanges[0].start <= 0 &&
    sampleRanges[0].end >= audioBuffer.duration
  ) {
    onProgress?.({ progress: 0.4, message: "Analyzing clip audio" });
    return {
      sampleBuffer: audioBuffer,
      sampleCount: 1,
    };
  }

  const segments = sampleRanges.map((sampleRange, index) => {
    onProgress?.({
      progress: (index + 1) / (sampleRanges.length + 1),
      message: `Sampling clip audio (${index + 1}/${sampleRanges.length})`,
    });

    return extractAudioSegment(
      audioBuffer,
      sampleRange.start,
      sampleRange.end,
      context,
    );
  });
  const sampleLength = segments.reduce(
    (total, segment) => total + segment.length,
    0,
  );
  const sampleBuffer = context.createBuffer(
    audioBuffer.numberOfChannels,
    sampleLength,
    audioBuffer.sampleRate,
  );

  let offset = 0;
  for (const segment of segments) {
    for (
      let channel = 0;
      channel < audioBuffer.numberOfChannels;
      channel += 1
    ) {
      sampleBuffer
        .getChannelData(channel)
        .set(segment.getChannelData(channel), offset);
    }

    offset += segment.length;
  }

  onProgress?.({
    progress: 0.85,
    message: `Analyzing ${segments.length} clip samples`,
  });

  return {
    sampleBuffer,
    sampleCount: segments.length,
  };
};

export const buildRecommendationProfile = (
  clipId: string,
  audioBuffer: AudioBuffer,
  context: BaseAudioContext,
  onProgress?: (progress: RecommendationProfileProgress) => void,
): NoiseProfileData => {
  const { sampleBuffer, sampleCount } = buildRecommendationSampleBuffer(
    audioBuffer,
    context,
    onProgress,
  );
  const reducer = new SpectralNoiseReducer();
  const profile = reducer.learnNoiseProfile(sampleBuffer);

  onProgress?.({
    progress: 1,
    message:
      sampleCount > 1
        ? `Analyzed ${sampleCount} clip samples`
        : "Analyzed clip audio",
  });

  return {
    id: `analysis-${clipId}`,
    frequencyBins: profile.frequencyBins,
    magnitudes: profile.magnitudes,
    standardDeviations: profile.standardDeviations,
    sampleRate: profile.sampleRate,
    fftSize: profile.fftSize,
    createdAt: Date.now(),
  };
};

const blobIds = new WeakMap<Blob, number>();
let nextBlobId = 0;
function blobId(blob: Blob | null) {
  if (!blob) return 0;
  let id = blobIds.get(blob);
  if (!id) {
    id = ++nextBlobId;
    blobIds.set(blob, id);
  }
  return id;
}
/** Source identity only; unrelated visual/name/thumbnail edits cannot invalidate learning. */
export function noiseAnalysisSignature(
  project: Project,
  clipId: string,
): string {
  const media = new Map(
    project.mediaLibrary.items.map((item) => [item.id, item]),
  );
  const definitions = new Map(
    (project.compoundClips ?? []).map((item) => [item.id, item]),
  );
  const describe = (
    clip: Clip,
    root: boolean,
    ancestors: Set<string>,
  ): unknown => {
    const id = getCompoundClipId(clip),
      item = media.get(clip.mediaId),
      definition = id ? definitions.get(id) : undefined;
    const content = id
      ? ancestors.has(id) || ancestors.size >= 32 || !definition
        ? "missing-or-cycle"
        : [
            definition.content.duration,
            definition.content.tracks.map((track) => [
              track.id,
              track.hidden,
              track.muted,
              track.solo,
              track.clips.map((child) =>
                describe(child, false, new Set(ancestors).add(id)),
              ),
            ]),
          ]
      : [blobId(item?.blob ?? null), item?.metadata];
    return [
      clip.id,
      clip.mediaId,
      clip.inPoint,
      clip.outPoint,
      clip.duration,
      clip.audioTrackIndex,
      clip.reversed,
      clip.speed,
      root
        ? null
        : [
            clip.startTime,
            clip.volume,
            clip.fade,
            clip.audioEffects,
            clip.automation,
          ],
      content,
    ];
  };
  const target = findNoiseTarget(project, clipId);
  return JSON.stringify([
    project.settings.sampleRate,
    project.settings.channels,
    target ? describe(target, true, new Set()) : null,
  ]);
}
/** Keep a half-second noise segment intact across window boundaries. */
export function* getNoiseSearchRanges(
  duration: number,
  sampled: readonly RecommendationSampleRange[],
): Generator<RecommendationSampleRange> {
  if (
    !Number.isFinite(duration) ||
    duration <= MAX_RECOMMENDATION_SAMPLE_SECONDS
  )
    return;
  for (let start = 0; start < duration; start += 7) {
    const end = Math.min(duration, start + 8);
    if (!sampled.some((range) => start >= range.start && end <= range.end))
      yield { start, end };
    if (end === duration) break;
  }
}

type Renderer = Pick<AudioEngine, "initialize" | "renderAudio" | "dispose">;
interface NoiseSourceDecoder {
  initialize(): Promise<boolean>;
  buffers(
    start: number,
    end: number,
  ): AsyncIterable<{
    timestamp: number;
    duration: number;
    buffer: AudioBuffer;
  }>;
  dispose(): void;
}
/** Profile raw source PCM before clip gain/pan/rate; compound sources use their canonical inner mix. */
export async function analyzeNoiseSource(
  project: Project,
  clipId: string,
  signal: AbortSignal,
  onProgress: (value: RecommendationProfileProgress) => void,
  createRenderer: (settings: Project["settings"]) => Renderer = (settings) =>
    new AudioEngine({
      sampleRate: settings.sampleRate,
      channels: settings.channels,
    }),
  createDecoder: (blob: Blob, audioTrackIndex: number) => NoiseSourceDecoder = (
    blob,
    index,
  ) => new SegmentedAudioDecoder(blob, index),
): Promise<NoiseAnalysisResult> {
  const assertCurrent = () => {
    if (signal.aborted)
      throw new DOMException("Noise analysis cancelled", "AbortError");
  };
  let lastProgress = 0;
  const report = (value: RecommendationProfileProgress) => {
    lastProgress = Math.max(lastProgress, Math.min(1, value.progress));
    onProgress({ ...value, progress: lastProgress });
  };
  assertCurrent();
  const target = findNoiseTarget(project, clipId);
  if (!target) throw new Error("Clip not found");
  if (!getProjectClipCapabilities(project, target).audio)
    throw new Error("No audio data available for this clip");
  const compoundId = getCompoundClipId(target);
  const media = compoundId
    ? null
    : project.mediaLibrary.items.find((item) => item.id === target.mediaId);
  if (!compoundId && !media?.blob)
    throw new Error("Relink the source audio before analysis");
  const sourceStart = Math.max(0, target.inPoint || 0);
  let sourceEnd =
    target.outPoint > sourceStart
      ? target.outPoint
      : sourceStart + target.duration * Math.abs(target.speed || 1);
  const knownDuration = compoundId
    ? project.compoundClips?.find((item) => item.id === compoundId)?.content
        .duration
    : media?.metadata.duration;
  if (knownDuration && Number.isFinite(knownDuration))
    sourceEnd = Math.min(sourceEnd, knownDuration);
  let span = sourceEnd - sourceStart;
  if (!Number.isFinite(span) || span <= 0)
    throw new Error("Clip audio range is empty");
  const reversed = target.reversed === true || (target.speed ?? 1) < 0;
  let renderer: Renderer | null = null,
    decoder: NoiseSourceDecoder | null = null;
  const fallback = { context: null as AudioContext | null };
  let fallbackBuffer: AudioBuffer | null = null;
  let analysisContext: OfflineAudioContext | null = null;
  const contextFor = (buffer: AudioBuffer) =>
    (analysisContext ??= new OfflineAudioContext(
      buffer.numberOfChannels,
      1,
      buffer.sampleRate,
    ));
  const loadFallback = async () => {
    if (!fallback.context) {
      fallback.context = new AudioContext();
      fallbackBuffer = await loadAudioBuffer(fallback.context, media!.blob!, {
        audioTrackIndex: target.audioTrackIndex ?? 0,
        onProgress: (value) => {
          assertCurrent();
          report({
            progress: 0.03 + value.progress * 0.04,
            message: value.message,
          });
        },
      });
      assertCurrent();
    }
    if (!fallbackBuffer) throw new Error("Failed to decode audio for analysis");
    return fallbackBuffer;
  };
  try {
    report({ progress: 0.03, message: "Preparing clip analysis" });
    if (media?.blob) {
      decoder = createDecoder(media.blob, target.audioTrackIndex ?? 0);
      const available = await decoder.initialize();
      assertCurrent();
      if (!available) {
        const raw = await loadFallback();
        sourceEnd = Math.min(sourceEnd, raw.duration);
        span = sourceEnd - sourceStart;
        if (!(span > 0)) throw new Error("Clip audio range is empty");
      }
    } else {
      renderer = createRenderer(project.settings);
      await renderer.initialize();
      assertCurrent();
    }
    const clip: Clip = {
      ...target,
      startTime: 0,
      inPoint: sourceStart,
      outPoint: sourceEnd,
      duration: span,
      speed: 1,
      reversed,
      volume: 1,
      audioEffects: [],
      automation: undefined,
      fade: undefined,
    };
    const input: Project = {
      ...project,
      timeline: {
        ...project.timeline,
        duration: span,
        tracks: [
          {
            id: clip.trackId,
            name: "Analysis",
            type: "audio",
            clips: [clip],
            transitions: [],
            hidden: false,
            muted: false,
            solo: false,
            locked: false,
          },
        ],
      },
    };
    const read = async (
      range: RecommendationSampleRange,
    ): Promise<AudioBuffer> => {
      assertCurrent();
      if (renderer)
        return (
          await renderer.renderAudio(
            input,
            range.start,
            range.end - range.start,
            { preview: true },
          )
        ).buffer;
      const from = reversed ? sourceEnd - range.end : sourceStart + range.start;
      const to = reversed ? sourceEnd - range.start : sourceStart + range.end;
      let output: AudioBuffer | null = null;
      if (!fallbackBuffer) {
        try {
          for await (const wrapped of decoder!.buffers(from, to)) {
            assertCurrent();
            const start = Math.max(from, wrapped.timestamp),
              end = Math.min(to, wrapped.timestamp + wrapped.duration);
            if (end <= start) continue;
            output ??= contextFor(wrapped.buffer).createBuffer(
              wrapped.buffer.numberOfChannels,
              Math.max(
                1,
                Math.ceil((to - from) * wrapped.buffer.sampleRate - 1e-7),
              ),
              wrapped.buffer.sampleRate,
            );
            if (
              output.sampleRate !== wrapped.buffer.sampleRate ||
              output.numberOfChannels !== wrapped.buffer.numberOfChannels
            )
              throw new Error("Audio format changed during decoding");
            const sourceOffset = Math.max(
              0,
              Math.round(
                (start - wrapped.timestamp) * wrapped.buffer.sampleRate,
              ),
            );
            const targetOffset = Math.max(
              0,
              Math.round((start - from) * output.sampleRate),
            );
            const count = Math.min(
              wrapped.buffer.length - sourceOffset,
              output.length - targetOffset,
              Math.round((end - start) * output.sampleRate),
            );
            if (count > 0)
              for (let c = 0; c < output.numberOfChannels; c++)
                output
                  .getChannelData(c)
                  .set(
                    wrapped.buffer
                      .getChannelData(c)
                      .subarray(sourceOffset, sourceOffset + count),
                    targetOffset,
                  );
          }
        } catch {
          assertCurrent();
          output = null;
          await loadFallback();
        }
      }
      if (!output) {
        const raw = await loadFallback(),
          end = Math.min(to, raw.duration);
        if (end <= from) throw new Error("Clip audio range is empty");
        output = extractAudioSegment(raw, from, end, contextFor(raw));
      }
      if (reversed)
        for (let c = 0; c < output.numberOfChannels; c++)
          output.getChannelData(c).reverse();
      return output;
    };
    const ranges = getRecommendationSampleRanges(span),
      buffers: AudioBuffer[] = [];
    for (let index = 0; index < ranges.length; index++) {
      report({
        progress: 0.08 + (index / ranges.length) * 0.7,
        message: `Reading clip audio (${index + 1}/${ranges.length})`,
      });
      const audio = await read(ranges[index]);
      assertCurrent();
      buffers.push(audio);
    }
    const context = contextFor(buffers[0]),
      length = buffers.reduce((sum, item) => sum + item.length, 0);
    const sample = context.createBuffer(
      buffers[0].numberOfChannels,
      length,
      buffers[0].sampleRate,
    );
    let offset = 0;
    for (const buffer of buffers) {
      for (let c = 0; c < sample.numberOfChannels; c++)
        sample.getChannelData(c).set(buffer.getChannelData(c), offset);
      offset += buffer.length;
    }
    report({ progress: 0.84, message: "Analyzing noise signature" });
    const recommendationProfile = buildRecommendationProfile(
      clipId,
      sample,
      context,
    );
    assertCurrent();
    report({ progress: 0.93, message: "Learning custom cleanup profile" });
    let learned = await autoLearnNoiseProfile(sample, context);
    assertCurrent();
    buffers.length = 0;
    if (!learned)
      for (const range of getNoiseSearchRanges(span, ranges)) {
        assertCurrent();
        report({
          progress: 0.93 + (0.06 * range.start) / span,
          message: "Searching remaining clip audio for a noise-only sample",
        });
        const audio = await read(range);
        assertCurrent();
        learned = await autoLearnNoiseProfile(audio, context);
        assertCurrent();
        if (learned) break;
      }
    report({ progress: 1, message: "Recommendation ready" });
    if (!learned) return { recommendationProfile, learnedProfile: null };
    const profile: NoiseProfileData = {
      ...learned,
      id: `profile-${clipId}`,
      createdAt: Date.now(),
    };
    return {
      recommendationProfile,
      learnedProfile: {
        profile,
        serializedProfile: {
          frequencyBins: Array.from(profile.frequencyBins),
          magnitudes: Array.from(profile.magnitudes),
          standardDeviations: profile.standardDeviations
            ? Array.from(profile.standardDeviations)
            : undefined,
          sampleRate: profile.sampleRate,
          fftSize: profile.fftSize,
        },
      },
    };
  } finally {
    try {
      decoder?.dispose();
    } finally {
      try {
        await fallback.context?.close();
      } finally {
        await renderer?.dispose();
      }
    }
  }
}
