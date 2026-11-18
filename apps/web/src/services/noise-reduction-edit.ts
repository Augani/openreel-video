import type { ActionExecutorLike } from "./lazy-action-executor";
import {
  resolveAudibleAudioTarget,
  type Action,
  type Effect,
  type Project,
} from "@openreel/core";
import {
  createNoiseReductionEffect,
  validateNoiseReduction,
  type NoiseReductionConfig,
} from "../bridges/audio-bridge-effects";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
export interface NoiseReductionScope {
  projectId: string;
  executor: ActionExecutorLike;
  clipId: string;
}
export function findNoiseTarget(project: Project, clipId: string) {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return resolveAudibleAudioTarget(clip, project.timeline);
  }
  return null;
}
export function ownsNoiseScope(scope: NoiseReductionScope) {
  const state = useProjectStore.getState();
  return (
    state.hasOpenProject &&
    state.project.id === scope.projectId &&
    state.actionExecutor === scope.executor
  );
}
/** Publish one complete canonical effect with a clip-sized inverse, before any async learning. */
export function editNoiseReduction(
  scope: NoiseReductionScope,
  changes: {
    config?: NoiseReductionConfig;
    enabled?: boolean;
    previewBypass?: boolean;
  },
): Effect | null {
  if (!ownsNoiseScope(scope)) return null;
  const state = useProjectStore.getState(),
    project = state.project;
  const target = findNoiseTarget(project, scope.clipId),
    track = project.timeline.tracks.find((item) => item.id === target?.trackId);
  if (
    !target ||
    !track ||
    track.locked ||
    useUIStore.getState().exportState.isExporting ||
    useUIStore.getState().effectApplicationClipId !== null ||
    useTimelineStore.getState().playbackLockedReason
  )
    return null;
  const previous = target.audioEffects.find(
    (item) => item.type === "noiseReduction",
  );
  if (!previous && !changes.config) return null;
  const { metadata: priorMetadata, ...base } = previous
    ? structuredClone(previous)
    : createNoiseReductionEffect(changes.config!);
  let metadata = priorMetadata;
  if (changes.previewBypass !== undefined) {
    const nextMetadata = { ...priorMetadata };
    if (changes.previewBypass) nextMetadata.previewBypass = true;
    else delete nextMetadata.previewBypass;
    metadata = Object.keys(nextMetadata).length ? nextMetadata : undefined;
  }
  const params = changes.config
    ? validateNoiseReduction(changes.config)
    : base.params;
  if (
    changes.config &&
    ![params.threshold, params.reduction, params.attack, params.release].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  )
    return null;
  const next: Effect = {
    ...base,
    params: params as Record<string, unknown>,
    enabled: changes.enabled ?? base.enabled,
    ...(metadata !== undefined ? { metadata } : {}),
  };

  if (previous && JSON.stringify(previous) === JSON.stringify(next))
    return previous;
  const id = crypto.randomUUID(),
    timestamp = Date.now();
  const action: Action = previous
    ? {
        id,
        timestamp,
        type: "audio/replaceEffect",
        params: {
          clipId: target.id,
          effectId: previous.id,
          effect: structuredClone(next),
        },
      }
    : {
        id,
        timestamp,
        type: "audio/addEffect",
        params: { clipId: target.id, effect: structuredClone(next) },
      };
  const inverse: Action = previous
    ? {
        id: `inverse-${id}`,
        timestamp,
        type: "audio/replaceEffect",
        params: {
          clipId: target.id,
          effectId: previous.id,
          effect: structuredClone(previous),
        },
      }
    : {
        id: `inverse-${id}`,
        timestamp,
        type: "audio/removeEffect",
        params: { clipId: target.id, effectId: next.id },
      };
  const previewOnly =
    changes.config === undefined && changes.enabled === undefined;
  if (!previewOnly) state.actionHistory.push(action, inverse);
  useProjectStore.setState({
    project: {
      ...project,
      modifiedAt: timestamp,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((item) =>
          item.id === track.id
            ? {
                ...item,
                clips: item.clips.map((clip) =>
                  clip.id === target.id
                    ? {
                        ...clip,
                        audioEffects: previous
                          ? clip.audioEffects.map((effect) =>
                              effect.id === previous.id ? next : effect,
                            )
                          : [...clip.audioEffects, next],
                      }
                    : clip,
                ),
              }
            : item,
        ),
      },
    },
    ...(previewOnly ? {} : { clipRedoStack: [], templateRedoStack: [] }),
  });
  window.dispatchEvent(new CustomEvent("openreel:preview-invalidate", { detail: { audioOnly: true } }));
  return next;
}
