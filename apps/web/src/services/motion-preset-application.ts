import type { ActionExecutorLike } from "./lazy-action-executor";
import type {
  Action,
  EasingType,
  Keyframe,
  Project,
  Transform,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import type { MotionPreset, PresetCategory } from "./motion-presets";

export interface MotionPresetScope {
  projectId: string;
  executor: ActionExecutorLike;
  clipId: string;
}
export interface MotionPresetTarget {
  id: string;
  trackId: string;
  duration: number;
  transform: Transform;
  keyframes?: readonly Keyframe[];
}
export type MotionPresetTargetKind =
  | "regular"
  | "text"
  | "shape"
  | "svg"
  | "sticker";
export const MOTION_PRESET_PREFIX: Record<PresetCategory, string> = {
  entrance: "motion-in-",
  exit: "motion-out-",
  emphasis: "motion-emphasis-",
  transition: "motion-transition-",
};

export function resolveMotionPresetTarget(
  project: Project,
  id: string,
): { kind: MotionPresetTargetKind; data: MotionPresetTarget } | null {
  for (const track of project.timeline.tracks) {
    const data = track.clips.find((clip) => clip.id === id);
    if (data) return { kind: "regular", data };
  }
  for (const [kind, clips] of [
    ["text", project.textClips],
    ["shape", project.shapeClips],
    ["svg", project.svgClips],
    ["sticker", project.stickerClips],
  ] as const) {
    const data = clips?.find((clip) => clip.id === id);
    if (data) return { kind, data };
  }
  return null;
}

export function boundedMotionPresetDuration(
  value: number | undefined,
  fallback: number,
  clipDuration: number,
): number {
  if (!Number.isFinite(clipDuration) || clipDuration <= 0) return 0;
  const requested =
    value !== undefined && Number.isFinite(value) ? value : fallback;
  return Math.min(
    clipDuration,
    Math.max(
      Math.min(0.05, clipDuration),
      Number.isFinite(requested) ? requested : 0.5,
    ),
  );
}

function easingToType(easing: string): EasingType {
  const map: Record<string, EasingType> = {
    linear: "linear",
    ease: "ease-in-out",
    "ease-in": "ease-in",
    "ease-out": "ease-out",
    "ease-in-out": "ease-in-out",
    "ease-in-cubic": "ease-in",
    "ease-out-cubic": "ease-out",
    "ease-in-out-cubic": "ease-in-out",
    "ease-out-back": "ease-out",
    "ease-in-back": "ease-in",
  };
  return map[easing] ?? "ease-in-out";
}

export function createMotionPresetKeyframes(
  preset: MotionPreset,
  target: MotionPresetTarget,
  kind: MotionPresetTargetKind,
  duration: number | undefined,
  canvas: { width: number; height: number },
): Keyframe[] {
  const length = boundedMotionPresetDuration(
    duration,
    preset.duration,
    target.duration,
  );
  if (!length || !Number.isFinite(preset.duration) || preset.duration <= 0)
    return [];
  const offset =
    preset.category === "exit"
      ? target.duration - length
      : preset.category === "emphasis"
        ? (target.duration - length) / 2
        : 0;
  const base = target.transform;
  const width = Math.max(1, canvas.width),
    height = Math.max(1, canvas.height);
  return preset.tracks.flatMap((track) =>
    track.keyframes.map((key, index) => {
      let value = key.value;
      if (track.relative) {
        if (track.property === "position.x")
          value =
            base.position.x +
            Math.sign(value) *
              (kind === "regular" ? width + 100 : 1 + 100 / width);
        else if (track.property === "position.y")
          value =
            base.position.y +
            Math.sign(value) *
              (kind === "regular" ? height + 100 : 1 + 100 / height);
        else if (track.property === "rotation") value = base.rotation + value;
      } else if (track.property === "opacity" && value === 1)
        value = base.opacity;
      else if (
        (track.property === "scale.x" || track.property === "scale") &&
        value === 1
      )
        value = base.scale.x;
      else if (track.property === "scale.y" && value === 1)
        value = base.scale.y;
      return {
        id: `${MOTION_PRESET_PREFIX[preset.category]}${track.property}-${index}-${crypto.randomUUID()}`,
        time: Math.max(
          0,
          Math.min(
            target.duration,
            offset + (key.time * length) / preset.duration,
          ),
        ),
        property: track.property as Keyframe["property"],
        value,
        easing: easingToType(key.easing ?? "ease-out"),
      };
    }),
  );
}

/** Synchronous, clip-sized history publication; canonical data owns the edit even without a renderer. */
function editPresetKeys(
  scope: MotionPresetScope,
  update: (
    target: MotionPresetTarget,
    kind: MotionPresetTargetKind,
    project: Project,
  ) => readonly Keyframe[],
): boolean {
  const state = useProjectStore.getState(),
    project = state.project;
  if (
    !state.hasOpenProject ||
    project.id !== scope.projectId ||
    state.actionExecutor !== scope.executor
  )
    return false;
  const target = resolveMotionPresetTarget(project, scope.clipId);
  const track = project.timeline.tracks.find(
    (item) => item.id === target?.data.trackId,
  );
  if (
    !target ||
    !track ||
    track.locked ||
    useUIStore.getState().exportState.isExporting ||
    useUIStore.getState().effectApplicationClipId !== null ||
    useTimelineStore.getState().playbackLockedReason
  )
    return false;
  const previous = target.data.keyframes,
    next = update(target.data, target.kind, project);
  if (
    next.length === (previous?.length ?? 0) &&
    next.every((key, index) => key === previous?.[index])
  )
    return false;
  if (
    next.some(
      (key) =>
        !Number.isFinite(key.time) ||
        key.time < 0 ||
        key.time > target.data.duration ||
        (typeof key.value === "number" && !Number.isFinite(key.value)),
    )
  )
    return false;
  const keys = structuredClone([...next]),
    priorKeys = previous ? structuredClone([...previous]) : undefined;
  const timestamp = Date.now(),
    id = crypto.randomUUID();
  const action: Action =
    target.kind === "regular"
      ? {
          type: "keyframe/setAll",
          id,
          timestamp,
          params: { clipId: scope.clipId, keyframes: keys },
        }
      : {
          type: `${target.kind}/update`,
          id,
          timestamp,
          params: { clipId: scope.clipId, updates: { keyframes: keys } },
        };
  const inverse: Action =
    target.kind === "regular"
      ? {
          type: "keyframe/setAll",
          id: `inverse-${id}`,
          timestamp,
          params: { clipId: scope.clipId, keyframes: priorKeys ?? [] },
        }
      : {
          type: `${target.kind}/update`,
          id: `inverse-${id}`,
          timestamp,
          params: {
            clipId: scope.clipId,
            updates: priorKeys ? { keyframes: priorKeys } : {},
            ...(priorKeys ? {} : { unset: ["keyframes"] }),
          },
        };
  const replace = <T extends { id: string }>(items: readonly T[] | undefined) =>
    items?.map((item) =>
      item.id === scope.clipId ? { ...item, keyframes: keys } : item,
    );
  const nextProject: Project =
    target.kind === "regular"
      ? {
          ...project,
          timeline: {
            ...project.timeline,
            tracks: project.timeline.tracks.map((item) =>
              item.id === track.id
                ? { ...item, clips: replace(item.clips)! }
                : item,
            ),
          },
          modifiedAt: timestamp,
        }
      : target.kind === "text"
        ? {
            ...project,
            textClips: replace(project.textClips),
            modifiedAt: timestamp,
          }
        : target.kind === "shape"
          ? {
              ...project,
              shapeClips: replace(project.shapeClips),
              modifiedAt: timestamp,
            }
          : target.kind === "svg"
            ? {
                ...project,
                svgClips: replace(project.svgClips),
                modifiedAt: timestamp,
              }
            : {
                ...project,
                stickerClips: replace(project.stickerClips),
                modifiedAt: timestamp,
              };
  state.actionHistory.push(action, inverse);
  useProjectStore.setState({
    project: nextProject,
    clipRedoStack: [],
    templateRedoStack: [],
  });
  try {
    const engines = useEngineStore.getState();
    if (target.kind === "text")
      engines
        .getTitleEngine()
        ?.updateTextClip(scope.clipId, { keyframes: keys });
    else if (target.kind === "shape")
      engines
        .getGraphicsEngine()
        ?.updateShapeClip(scope.clipId, { keyframes: keys });
    else if (target.kind === "svg")
      engines
        .getGraphicsEngine()
        ?.updateSVGClip(scope.clipId, { keyframes: keys });
    else if (target.kind === "sticker")
      engines
        .getGraphicsEngine()
        ?.updateStickerClip(scope.clipId, { keyframes: keys });
  } catch (error) {
    console.warn(
      "[Motion presets] Could not refresh the rendering cache",
      error,
    );
  }
  return true;
}

export function applyMotionPreset(
  scope: MotionPresetScope,
  preset: MotionPreset,
  duration?: number,
): boolean {
  return editPresetKeys(scope, (target, kind, project) => {
    const generated = createMotionPresetKeyframes(
      preset,
      target,
      kind,
      duration,
      project.settings,
    );
    if (!generated.length) return target.keyframes ?? [];
    return [
      ...(target.keyframes ?? []).filter(
        (key) => !key.id.startsWith(MOTION_PRESET_PREFIX[preset.category]),
      ),
      ...generated,
    ];
  });
}

export function removeMotionPresetCategory(
  scope: MotionPresetScope,
  category: PresetCategory,
): boolean {
  return editPresetKeys(scope, (target) =>
    (target.keyframes ?? []).filter(
      (key) => !key.id.startsWith(MOTION_PRESET_PREFIX[category]),
    ),
  );
}
