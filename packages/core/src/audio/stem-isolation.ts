import type { AudioType, Clip, Project, Track } from "../types";
import { getCompoundClipId } from "../timeline/timeline-items";
import { resolveClipVolumeAutomation } from "./clip-audio-resolution";
import { AUDIO_TYPE_LABELS, resolveAudioType } from "./essential-sound";
import { getLiveDucking } from "./live-ducking";

/**
 * Stems that are not buses: one per audio-carrying track, or one per Essential
 * Sound type. Like a bus stem, each is the ordinary offline mixdown of an
 * isolated copy of the project, so it hears exactly what the export hears
 * (clip effects, limiter and low-pass included, fades, ducking, track racks and
 * faders) and every stem covers the whole timeline.
 *
 *   track stem   the track's post-rack, post-fader signal, before buses and the
 *                master rack (its sends and bus routing are dropped).
 *   type stem    every clip of the type, still through its own track rack/fader
 *                and bus routing, before the master rack.
 */

export type StemMode = "bus" | "track" | "audioType";

/** Id of the stem that collects clips with no Essential Sound type. */
export const UNTYPED_STEM_ID = "untyped";
export const UNTYPED_STEM_LABEL = "Untyped";

export const STEM_MODE_LABELS: Record<StemMode, string> = {
  bus: "Buses",
  track: "Tracks",
  audioType: "Audio type",
};

/**
 * Freeze live ducking into ordinary volume lanes against the FULL timeline.
 * Needed before a stem isolates clips or mutes tracks: the duck depends on the
 * dialogue clips, which an isolated copy no longer contains.
 */
export function bakeLiveDucking(project: Project): Project {
  const { timeline } = project;
  let changed = false;
  const tracks = timeline.tracks.map((track) => {
    if (!track.clips.some((clip) => getLiveDucking(clip))) return track;
    changed = true;
    return {
      ...track,
      clips: track.clips.map((clip): Clip => {
        if (!getLiveDucking(clip)) return clip;
        const lane = resolveClipVolumeAutomation(clip, timeline);
        const { liveDucking: _live, ...metadata } = clip.metadata ?? {};
        void _live;
        const { metadata: _m, ...rest } = clip;
        void _m;
        return {
          ...rest,
          automation: { ...clip.automation, ...(lane.length > 0 ? { volume: lane } : {}) },
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        };
      }),
    };
  });
  return changed ? { ...project, timeline: { ...timeline, tracks } } : project;
}

function clipCarriesAudio(project: Project, clip: Clip): boolean {
  if (getCompoundClipId(clip)) return true;
  const media = project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
  if (!media) return false;
  if (media.type === "audio") return true;
  return media.type === "video" && media.metadata.hasAudio !== false;
}

const audible = (track: Track): boolean => !track.muted && !track.hidden;

/** Tracks that would make a track stem: audible, with at least one clip that carries audio. */
export function trackStemCandidates(project: Project): Track[] {
  return project.timeline.tracks.filter(
    (track) =>
      audible(track) &&
      (track.type === "audio" || track.type === "video") &&
      track.clips.some((clip) => clipCarriesAudio(project, clip)),
  );
}

export const audioTypeStemLabel = (id: string): string =>
  id === UNTYPED_STEM_ID ? UNTYPED_STEM_LABEL : (AUDIO_TYPE_LABELS[id as AudioType] ?? id);

/** Stem ids (the four types, then Untyped) that have at least one audible, audio-carrying clip. */
export function audioTypeStemIds(project: Project): string[] {
  const present = new Set<string>();
  for (const track of project.timeline.tracks) {
    if (!audible(track)) continue;
    for (const clip of track.clips) {
      if (!clipCarriesAudio(project, clip)) continue;
      present.add(resolveAudioType(clip, project.timeline.tracks) ?? UNTYPED_STEM_ID);
    }
  }
  return ["dialogue", "music", "sfx", "ambience", UNTYPED_STEM_ID].filter((id) => present.has(id));
}

/** A project whose master mix IS the post-fader output of `trackId` alone. */
export function isolateTrackStem(project: Project, trackId: string): Project | undefined {
  if (!project.timeline.tracks.some((track) => track.id === trackId)) return undefined;
  const baked = bakeLiveDucking(project);
  const tracks = baked.timeline.tracks.map((track): Track => {
    const { sends: _s, output: _o, ...rest } = track;
    void _s;
    void _o;
    return track.id === trackId ? { ...rest, solo: false } : { ...rest, muted: true, solo: false };
  });
  const { masterAudioRack: _m, audioBuses: _b, ...timelineRest } = baked.timeline;
  void _m;
  void _b;
  return { ...baked, timeline: { ...timelineRest, tracks } };
}

/** A project whose master mix IS everything of one Essential Sound type (before the master rack). */
export function isolateAudioTypeStem(project: Project, typeId: string): Project | undefined {
  if (!audioTypeStemIds(project).includes(typeId)) return undefined;
  const baked = bakeLiveDucking(project);
  const typeOf = (clip: Clip) => resolveAudioType(clip, project.timeline.tracks) ?? UNTYPED_STEM_ID;
  const tracks = baked.timeline.tracks.map((track): Track => ({
    ...track,
    clips: track.clips.filter((clip) => typeOf(clip) === typeId),
    solo: false,
  }));
  const { masterAudioRack: _m, ...timelineRest } = baked.timeline;
  void _m;
  const audioBuses = baked.timeline.audioBuses?.map((bus) => ({ ...bus, solo: false }));
  return { ...baked, timeline: { ...timelineRest, tracks, ...(audioBuses ? { audioBuses } : {}) } };
}
