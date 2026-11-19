import { v4 as uuidv4 } from "uuid";
import {
  getMediaItemCapabilities,
  type ActionResult,
  type Clip,
  type ClipChannelMap,
  type MediaItem,
  type Project,
  type Track,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useAudioChannelsStore } from "../stores/audio-channels-store";
import { cloneProjectForEdit } from "../stores/project/clone-project-for-edit";

/** A clip that has audio the dialog can map: audio-track clips and video clips whose file carries audio. */
export function clipHasMappableAudio(project: Project, clip: Clip): boolean {
  const media = project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
  if (!media) return false;
  const track = project.timeline.tracks.find((candidate) => candidate.clips.some((c) => c.id === clip.id));
  return track?.type === "audio" || getMediaItemCapabilities(media).audio;
}

export function selectedAudioClipIds(): string[] {
  const { project } = useProjectStore.getState();
  const selected = useUIStore.getState().selectedItems.filter((item) => item.type === "clip").map((item) => item.id);
  const clips = project.timeline.tracks.flatMap((track) => track.clips);
  return selected.filter((id) => {
    const clip = clips.find((candidate) => candidate.id === id);
    return clip ? clipHasMappableAudio(project, clip) : false;
  });
}

/** Clip > Audio Channels…: opens the dialog for the selected clips (no-op without a selected clip that has audio). */
export function openAudioChannelsForSelection(ids: readonly string[] = selectedAudioClipIds()): boolean {
  if (ids.length === 0) return false;
  useAudioChannelsStore.getState().openFor(ids);
  return true;
}

/** Sets (map) or clears (null) the channel map of one or many clips: one undoable step. */
export function setClipChannelMap(clipIds: readonly string[], map: ClipChannelMap | null): Promise<ActionResult> {
  return useProjectStore.getState().executeAction({
    id: uuidv4(),
    timestamp: Date.now(),
    type: "audio/setChannelMap",
    params: { clipIds: [...clipIds], map },
  });
}

const sourceChannelsOf = (media: MediaItem | undefined): number => Math.max(1, media?.metadata.channels || 2);

/** Whether Split to mono is offered: one multichannel clip (audio file or video with embedded audio) on an unlocked track. */
export function canSplitToMono(project: Project, clipId: string): boolean {
  const track = project.timeline.tracks.find((candidate) => candidate.clips.some((c) => c.id === clipId));
  const clip = track?.clips.find((c) => c.id === clipId);
  const media = clip && project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
  return !!track && !!media && !track.locked && getMediaItemCapabilities(media).audio && sourceChannelsOf(media) >= 2;
}

/**
 * Split to mono clips (Premiere: Break Out to Mono): the clip keeps its first channel as a mono clip and
 * every further source channel (up to 8) becomes its own mono clip on a new audio track, in sync, one undo step.
 */
export async function splitClipToMono(clipId: string): Promise<ActionResult> {
  const current = useProjectStore.getState();
  const { project, actionExecutor } = current;
  const failure = (message: string): ActionResult => ({ success: false, error: { code: "INVALID_PARAMS", message } });
  if (!canSplitToMono(project, clipId)) return failure("Only an unlocked clip with stereo or multichannel audio can be split to mono.");
  const sourceTrack = project.timeline.tracks.find((track) => track.clips.some((c) => c.id === clipId)) as Track;
  const clip = sourceTrack.clips.find((c) => c.id === clipId) as Clip;
  const media = project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
  const channels = Math.min(sourceChannelsOf(media), 8);
  const projectCopy = cloneProjectForEdit(project);
  const history = actionExecutor.getHistory();
  const undoSizeBefore = history.getUndoStackSize();
  let committed = false;
  history.beginGroup("Split to mono clips");
  try {
    let result: ActionResult = await actionExecutor.execute(
      { type: "audio/setChannelMap", id: uuidv4(), timestamp: Date.now(), params: { clipIds: [clipId], map: { format: "mono", sources: [0] } } },
      projectCopy,
    );
    if (!result.success) return result;
    for (let channel = 1; channel < channels; channel++) {
      const trackId = uuidv4();
      result = await actionExecutor.execute(
        { type: "track/add", id: uuidv4(), timestamp: Date.now(), params: { trackType: "audio", trackId, name: `${sourceTrack.name} ${channel + 1}` } },
        projectCopy,
      );
      if (!result.success) return result;
      result = await actionExecutor.execute(
        {
          type: "clip/add", id: uuidv4(), timestamp: Date.now(),
          params: {
            trackId, mediaId: clip.mediaId, startTime: clip.startTime,
            sourceClip: { ...clip, id: uuidv4(), trackId, channelMap: { format: "mono", sources: [channel] } },
          },
        },
        projectCopy,
      );
      if (!result.success) return result;
    }
    useProjectStore.setState({ project: { ...projectCopy, modifiedAt: Date.now() } });
    committed = true;
    return result;
  } finally {
    history.endGroup();
    if (!committed && history.getUndoStackSize() > undoSizeBefore) await actionExecutor.undo(projectCopy);
  }
}
