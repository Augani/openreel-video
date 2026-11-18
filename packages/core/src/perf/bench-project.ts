import type { Project, MediaItem, Clip, Track, Effect } from "../types";

export interface BenchProjectOptions {
  tracks?: number;
  clips?: number;
  textItems?: number;
  waveformSamples?: number;
}

const transform = {
  position: { x: 0.5, y: 0.5 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

/**
 * Deterministic, realistic project used by the performance harnesses:
 * several tracks, hundreds of clips backed by media with waveform and
 * thumbnails, effects on every fifth clip and text items.
 * Default: 8 tracks, 400 clips, 50 text clips, 48k-sample waveforms.
 */
export function buildBenchProject(options: BenchProjectOptions = {}): Project {
  const trackCount = options.tracks ?? 8;
  const clipCount = options.clips ?? 400;
  const textCount = options.textItems ?? 50;
  const waveformSamples = options.waveformSamples ?? 48000;

  const mediaCount = Math.max(1, Math.min(clipCount, 40));
  const items: MediaItem[] = Array.from({ length: mediaCount }, (_, i) => {
    const waveform = new Float32Array(waveformSamples);
    for (let s = 0; s < waveformSamples; s += 1) waveform[s] = Math.sin((s + i) / 50) * 0.5;
    return {
      id: `media-${i}`,
      name: `Source ${i}.mp4`,
      type: i % 4 === 3 ? "audio" : "video",
      fileHandle: null,
      blob: null,
      metadata: {
        duration: 60, width: 1920, height: 1080, frameRate: 30,
        codec: "h264", sampleRate: 48000, channels: 2, fileSize: 5_000_000,
      },
      thumbnailUrl: `data:image/jpeg;base64,${"A".repeat(2000)}`,
      waveformData: waveform,
      filmstripThumbnails: Array.from({ length: 20 }, (_, t) => ({
        timestamp: t * 3,
        url: `data:image/jpeg;base64,${"B".repeat(600)}`,
      })),
    } satisfies MediaItem;
  });

  const tracks: Track[] = Array.from({ length: trackCount }, (_, t) => ({
    id: `track-${t}`,
    name: `Track ${t}`,
    type: t % 4 === 3 ? "audio" : "video",
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  }));

  const perTrack = Math.ceil(clipCount / trackCount);
  const filled = tracks.map((track, t) => {
    const clips: Clip[] = [];
    for (let c = 0; c < perTrack && t * perTrack + c < clipCount; c += 1) {
      const index = t * perTrack + c;
      const effects: Effect[] = index % 5 === 0
        ? [{ id: `fx-${index}`, type: "blur", params: { radius: 4 }, enabled: true }]
        : [];
      clips.push({
        id: `clip-${index}`,
        mediaId: `media-${index % mediaCount}`,
        trackId: track.id,
        startTime: c * 6,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        effects,
        audioEffects: [],
        keyframes: [],
        volume: 1,
        transform,
      });
    }
    return { ...track, clips };
  });

  const textClips = Array.from({ length: textCount }, (_, i) => ({
    id: `text-${i}`,
    trackId: "track-0",
    startTime: i * 5,
    duration: 3,
    text: `Title ${i}`,
    fontFamily: "Inter",
    fontSize: 48,
    color: "#ffffff",
    transform,
    animation: { preset: "none", params: {} },
    keyframes: [],
  })) as unknown as NonNullable<Project["textClips"]>;

  return {
    id: "bench-project",
    name: "Benchmark project",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items },
    timeline: {
      tracks: filled,
      subtitles: [],
      markers: [],
      duration: (perTrack - 1) * 6 + 5,
    },
    textClips,
  } as Project;
}
