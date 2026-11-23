import type { Clip, MediaItem, Track } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

export interface FixtureOptions {
  tracks?: number;
  clipsPerTrack?: number;
  clipSeconds?: number;
}

/** A realistic edit: N video/audio tracks of back to back clips with effects and keyframes. */
export function buildFixtureProject(options: FixtureOptions = {}) {
  const trackCount = options.tracks ?? 8;
  const perTrack = options.clipsPerTrack ?? 40;
  const seconds = options.clipSeconds ?? 3;
  const base = createEmptyProject("Perf fixture");
  const media: MediaItem[] = [];
  const tracks: Track[] = [];
  for (let t = 0; t < trackCount; t++) {
    const type = t % 4 === 3 ? "audio" : "video";
    const clips: Clip[] = [];
    for (let c = 0; c < perTrack; c++) {
      const mediaId = `m-${t}-${c % 6}`;
      if (c < 6) {
        media.push({
          id: mediaId, name: `Source ${t}-${c}`, type,
          fileHandle: null, blob: null, thumbnailUrl: null,
          waveformData: type === "audio" ? new Float32Array(256).fill(0.4) : null,
          metadata: {
            duration: 60, width: 3840, height: 2160, frameRate: 30,
            codec: "h264", sampleRate: 48_000, channels: 2, fileSize: 1,
          },
        } as unknown as MediaItem);
      }
      clips.push({
        id: `clip-${t}-${c}`, mediaId, trackId: `track-${t}`,
        startTime: c * seconds, duration: seconds, inPoint: 0, outPoint: seconds,
        effects: c % 3 === 0
          ? [{ id: `fx-${t}-${c}`, type: "brightness", enabled: true, params: { value: 0.1 } }]
          : [],
        audioEffects: [],
        keyframes: c % 5 === 0
          ? [
              { id: `kf-${t}-${c}-a`, time: 0, property: "opacity", value: 0, easing: "linear" },
              { id: `kf-${t}-${c}-b`, time: seconds, property: "opacity", value: 1, easing: "linear" },
            ]
          : [],
        volume: 1, transform,
      } as unknown as Clip);
    }
    tracks.push({
      id: `track-${t}`, name: `Track ${t}`, type, clips, transitions: [],
      locked: false, hidden: false, muted: false, solo: false,
    } as unknown as Track);
  }
  return {
    ...base,
    timeline: { ...base.timeline, tracks },
    mediaLibrary: { items: media },
  };
}

export function loadFixture(options: FixtureOptions = {}): void {
  const project = buildFixtureProject(options);
  useProjectStore.setState({
    hasOpenProject: true,
    project,
    clipboard: [],
    copiedEffects: [],
    error: null,
  });
  useTimelineStore.setState({
    playheadPosition: 0,
    playbackState: "stopped",
    viewportWidth: 1400,
    pixelsPerSecond: 40,
    scrollX: 0,
  });
  useUIStore.getState().clearSelection();
}
