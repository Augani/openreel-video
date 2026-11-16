import {
  AudioDucker,
  resolveAudibleAudioTarget,
  type AutomationPoint,
} from "@openreel/core";
import { EditingSession } from "./agent/editing-session";
import { buildTriggerTrackBuffer } from "./audio-ducking-buffer";
import type { AudioDuckingSettings } from "../stores/project";

/** The quick switch uses the same dialogue analysis as the full ducking panel. */
export async function setQuickAudioDucking(
  clipId: string,
  enabled: boolean,
): Promise<void> {
  const session = new EditingSession();
  const transaction = session.beginTransaction();
  const project = session.getProject();
  const selected = project.timeline.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === clipId);
  const target = selected
    ? resolveAudibleAudioTarget(selected, project.timeline)
    : null;
  if (!target) throw new Error("Select a clip with audio first.");
  const targetTrack = project.timeline.tracks.find(
    (track) => track.id === target.trackId,
  );
  if (targetTrack?.locked) throw new Error("Unlock the audio track first.");
  const metadata = { ...target.metadata };
  const automation = { ...target.automation };
  const existing = metadata.audioDucking as { enabled?: boolean } | undefined;
  if ((enabled && existing?.enabled) || (!enabled && !existing)) return;
  if (enabled) {
    const sourceTrack = project.timeline.tracks.find(
      (track) =>
        track.id !== target.trackId &&
        (track.role === "dialogue" || /^dialogue$/i.test(track.name)) &&
        !track.muted &&
        track.clips.some(
          (clip) =>
            clip.startTime < target.startTime + target.duration &&
            clip.startTime + clip.duration > target.startTime,
        ),
    );
    if (!sourceTrack)
      throw new Error("Add overlapping audio to the Dialogue track first.");
    const settings: AudioDuckingSettings = {
      enabled: true,
      sourceTrackId: sourceTrack.id,
      threshold: -30,
      reduction: 1 - Math.pow(10, -8 / 20),
      attack: 0.1,
      release: 0.3,
      holdTime: 0.2,
    };
    const trigger = await buildTriggerTrackBuffer(project, target, sourceTrack);
    const points = new AudioDucker().generateDuckingKeyframes(
      trigger,
      settings,
      target.volume > 0 ? target.volume : 1,
    );
    if (!points.length)
      throw new Error(
        "No dialogue crossed the trigger threshold. Configure ducking to adjust the threshold.",
      );
    metadata.workspaceDuckingOriginalVolume =
      target.automation?.volume?.map((point) => ({ ...point })) ?? null;
    metadata.audioDucking = settings;
    automation.volume = points;
  } else {
    const previous = metadata.workspaceDuckingOriginalVolume;
    if (Array.isArray(previous))
      automation.volume = previous as AutomationPoint[];
    else delete automation.volume;
    delete metadata.audioDucking;
    delete metadata.workspaceDuckingOriginalVolume;
  }
  session.replaceDraft({
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === target.id ? { ...clip, metadata, automation } : clip,
        ),
      })),
    },
  });
  try {
    await session.commitTransaction(
      transaction,
      enabled ? "Duck music under dialogue" : "Remove audio ducking",
    );
  } catch (error) {
    if (error instanceof Error && /project changed/i.test(error.message))
      throw new Error(
        "The project changed while preparing audio. No ducking changes were applied.",
      );
    throw error;
  }
}
