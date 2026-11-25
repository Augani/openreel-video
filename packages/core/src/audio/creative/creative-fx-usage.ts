import type { AudioRack, Effect, Project, Timeline } from "../../types";
import { isCreativeFxType } from "./creative-fx-definitions";

const rackUses = (rack: AudioRack | undefined): boolean => !!rack && rack.effects.some((fx) => !fx.bypassed && isCreativeFxType(fx.type));
const effectsUse = (effects: readonly Effect[] | undefined): boolean => !!effects && effects.some((fx) => fx.enabled && isCreativeFxType(fx.type));

const timelineUses = (timeline: Pick<Timeline, "tracks" | "audioBuses" | "masterAudioRack">): boolean =>
  rackUses(timeline.masterAudioRack) ||
  (timeline.audioBuses ?? []).some((bus) => rackUses(bus.rack)) ||
  timeline.tracks.some((track) => rackUses(track.audioRack) || track.clips.some((clip) => effectsUse(clip.audioEffects)));

/** True when rendering this project needs the creative-effects worklet loaded into the offline context. */
export const projectUsesCreativeFx = (project: Project): boolean =>
  timelineUses(project.timeline) ||
  (project.compoundClips ?? []).some((compound) => timelineUses(compound.content as Pick<Timeline, "tracks">));
