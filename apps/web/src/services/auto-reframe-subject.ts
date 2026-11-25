import {
  buildReframeKeyframes,
  mergeReframeKeyframes,
  clipLocalToSourceTime,
  createPersonSubjectDetector,
  getAutoReframeEngine,
  getPersonSegmentationEngine,
  reframeSampleTimes,
  sampleSubjects,
  smoothSubjectPath,
  type Clip,
  type Keyframe,
  type MediaItem,
  type ReframeMotionPreset,
  type ReframeSubjectMode,
  type SubjectDetector,
  type SubjectSample,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

export interface SubjectReframeInput {
  clip: Clip;
  media: MediaItem;
  videoEngine: {
    decodeFrame(media: MediaItem, time: number): Promise<ImageBitmap | null>;
  };
  projectWidth: number;
  projectHeight: number;
  subject: ReframeSubjectMode;
  motion: ReframeMotionPreset;
  follow: boolean;
  centerBias: number;
  /** Test seam: replaces the lazily loaded person model. */
  primaryDetector?: SubjectDetector | null;
  onProgress?: (percent: number, message: string) => void;
}

export interface SubjectReframeOutput {
  keyframes: Keyframe[];
  samples: SubjectSample[];
  personFrames: number;
  heuristicFrames: number;
}

async function loadPersonDetector(clipId: string): Promise<SubjectDetector | null> {
  try {
    const engine = getPersonSegmentationEngine();
    if (!engine.isInitialized()) await engine.initialize();
    return createPersonSubjectDetector(engine, `auto-reframe-${clipId}`);
  } catch (error) {
    console.warn("[AutoReframe] Person segmentation unavailable, using heuristic:", error);
    return null;
  }
}

/**
 * Sample the clip, find the subject and build transform keyframes. The caller
 * commits them through the undoable keyframe action so preview and export,
 * which both evaluate clip keyframes, stay identical.
 */
export async function computeSubjectReframe(
  input: SubjectReframeInput,
): Promise<SubjectReframeOutput> {
  const { clip, media, videoEngine, onProgress } = input;
  const times = reframeSampleTimes(clip.duration);

  onProgress?.(5, "Loading subject model...");
  const primary =
    input.primaryDetector !== undefined
      ? input.primaryDetector
      : input.follow
        ? await loadPersonDetector(clip.id)
        : null;

  const reframeEngine = getAutoReframeEngine();
  const fallback: SubjectDetector = async (frame) =>
    reframeEngine?.detectSubjectHeuristic(frame) ?? null;

  const samples: SubjectSample[] = [];
  let sourceWidth = 0;
  let sourceHeight = 0;
  let personFrames = 0;
  let heuristicFrames = 0;
  let primaryAvailable = primary;

  for (let i = 0; i < times.length; i++) {
    onProgress?.(
      10 + Math.round((i / times.length) * 80),
      `Tracking subject ${i + 1}/${times.length}`,
    );
    const bitmap = await videoEngine.decodeFrame(
      media,
      clipLocalToSourceTime(clip, times[i]),
    );
    if (!bitmap) continue;
    try {
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
      if (!input.follow) {
        samples.push({ time: times[i], subject: null, source: "none" });
        continue;
      }
      const [sample] = await sampleSubjects([{ bitmap, time: times[i] }], {
        subject: input.subject,
        primary: primaryAvailable,
        fallback,
      });
      samples.push(sample);
      if (sample.source === "person") personFrames++;
      if (sample.source === "heuristic") heuristicFrames++;
      if (primaryAvailable && sample.source === "heuristic" && input.subject === "person") {
        // Detector threw: stop retrying it for the rest of the clip.
        primaryAvailable = null;
      }
    } finally {
      bitmap.close();
    }
  }

  if (samples.length === 0 || sourceWidth === 0) {
    throw new Error("Could not read frames from this clip");
  }

  const path = smoothSubjectPath(samples, input.motion, {
    follow: input.follow,
    centerBias: input.centerBias,
  });
  const keyframes = buildReframeKeyframes(
    clip.id,
    path,
    {
      sourceWidth,
      sourceHeight,
      projectWidth: input.projectWidth,
      projectHeight: input.projectHeight,
      fitMode: clip.transform.fitMode,
    },
    clip.keyframes,
  );
  onProgress?.(95, "Applying keyframes...");
  return { keyframes, samples, personFrames, heuristicFrames };
}

export interface CommitAutoReframeInput {
  clipId: string;
  width: number;
  height: number;
  keyframes: Keyframe[];
}

/**
 * Apply the project resize and the tracked keyframes as ONE undo step: a
 * single history group wraps both undoable actions.
 */
export async function commitAutoReframe(input: CommitAutoReframeInput): Promise<void> {
  const store = useProjectStore.getState();
  store.beginHistoryGroup("Auto Reframe");
  try {
    const result = await useProjectStore
      .getState()
      .updateSettings({ width: input.width, height: input.height });
    if (!result.success) throw new Error(result.error?.message ?? "Could not resize the project");
    const latest = useProjectStore.getState().getClip(input.clipId);
    if (!latest) throw new Error("Clip was removed while tracking");
    useProjectStore
      .getState()
      .updateClipKeyframes(input.clipId, mergeReframeKeyframes(latest.keyframes, input.keyframes));
  } finally {
    useProjectStore.getState().endHistoryGroup();
  }
}
