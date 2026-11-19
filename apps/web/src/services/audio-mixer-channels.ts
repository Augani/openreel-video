import {
  createTimelineClipCapabilityResolver,
  type Project,
  type Track,
} from "@openreel/core";

type MixerTrack = Pick<Track, "id" | "name" | "type" | "muted" | "solo" | "soloSafe" | "audioRack" | "output" | "sends" | "surroundPan">;

/** Index audio capability once per library change and retain stable control/meter identities. */
export function createMixerChannelSelector() {
  let tracks: Project["timeline"]["tracks"] | undefined;
  let media: Project["mediaLibrary"]["items"] | undefined;
  let compounds: Project["compoundClips"];
  let resolveAudio = createTimelineClipCapabilityResolver({ items: [] }, []);
  let selected: { tracks: MixerTrack[]; trackIds: string[] } = {
    tracks: [],
    trackIds: [],
  };
  return (project: Project) => {
    const nextTracks = project.timeline.tracks;
    const nextMedia = project.mediaLibrary.items;
    if (tracks === nextTracks && media === nextMedia && compounds === project.compoundClips) return selected;
    if (media !== nextMedia || compounds !== project.compoundClips) {
      resolveAudio = createTimelineClipCapabilityResolver(project.mediaLibrary, project.compoundClips);
      media = nextMedia; compounds = project.compoundClips;
    }
    tracks = nextTracks;
    const next = nextTracks
      // Like Premiere, every audio track gets a strip (so racks can be set up
      // before clips land); other tracks appear once they carry audible clips.
      .filter(
        (track) =>
          track.type === "audio" ||
          track.clips.some((clip) => resolveAudio(clip).audio),
      )
      .map(({ id, name, type, muted, solo, soloSafe, audioRack, output, sends, surroundPan }) => ({
        id,
        name,
        type,
        muted,
        solo,
        soloSafe,
        audioRack,
        output,
        sends,
        surroundPan,
      }));
    if (
      next.length === selected.tracks.length &&
      next.every((track, index) => {
        const previous = selected.tracks[index];
        return (
          track.id === previous.id &&
          track.name === previous.name &&
          track.type === previous.type &&
          track.muted === previous.muted &&
          track.solo === previous.solo &&
          track.soloSafe === previous.soloSafe &&
          track.audioRack === previous.audioRack &&
          track.output === previous.output &&
          track.sends === previous.sends &&
          track.surroundPan === previous.surroundPan
        );
      })
    )
      return selected;
    const ids = next.map((track) => track.id);
    const trackIds =
      ids.length === selected.trackIds.length &&
      ids.every((id, index) => id === selected.trackIds[index])
        ? selected.trackIds
        : ids;
    selected = { tracks: next, trackIds };
    return selected;
  };
}
