import type {
  AutomationPoint,
  Clip,
  ClipFade,
  Keyframe,
  Project,
} from "../types";
import { getPanFromAudioEffects } from "../audio/audio-effect-routing";
import { resolveClipBaseVolumeAutomation } from "../audio/clip-audio-resolution";
import { SPEED_MIN, SPEED_MAX } from "../video/speed-engine";
import type {
  TimelineToolItemEdit,
  TimelineToolPlan,
} from "./timeline-tool-edit";
import type { TimelineSlice } from "./timeline-splice";

const finite = (value: number) => Number.isFinite(value);
const clock = (offset: number, duration: number) => ({ offset, duration });
function fragmentFade(clip: Clip, offset: number): ClipFade | undefined {
  const fade = clip.fade;
  if (!fade || (!fade.fadeIn && !fade.fadeOut)) return fade;
  const local = clock(0, clip.duration),
    origin = fade.origin ?? local;
  const inClock =
    "fadeIn" in origin && origin.fadeIn === false ? local : origin;
  const outClock =
    "fadeOut" in origin && origin.fadeOut === false
      ? local
      : "out" in origin
        ? (origin.out ?? origin)
        : origin;
  const incoming = clock(inClock.offset + offset, inClock.duration);
  const outgoing = clock(outClock.offset + offset, outClock.duration);
  return {
    fadeIn: fade.fadeIn,
    fadeOut: fade.fadeOut,
    origin: {
      ...incoming,
      ...(outgoing.offset !== incoming.offset ||
      outgoing.duration !== incoming.duration
        ? { out: outgoing }
        : {}),
    },
  };
}

/** Crop a linear automation curve, including interpolated boundary values.
 * Keep points outside the fragment out of the saved piece, rather than
 * restarting a ramp at its original base value after a seek or split. */
export function fragmentAutomation(
  points: readonly AutomationPoint[] | undefined,
  offset: number,
  duration: number,
  base: number,
  minimum: number,
  maximum: number,
): AutomationPoint[] | undefined {
  if (!points) return undefined;
  const clamp = (value: number) => Math.max(minimum, Math.min(maximum, value));
  const sorted = points
    .filter(
      (point) => finite(point.time) && point.time >= 0 && finite(point.value),
    )
    .map((point) => ({ ...point, value: clamp(point.value) }))
    .sort((a, b) => a.time - b.time);
  if (!sorted.length) return [];
  const sample = (time: number) => {
    let previous = { time: 0, value: clamp(base) };
    for (const point of sorted) {
      if (point.time <= time) {
        previous = point;
        continue;
      }
      const span = point.time - previous.time;
      return span > 0
        ? previous.value +
            (point.value - previous.value) *
              Math.max(0, (time - previous.time) / span)
        : point.value;
    }
    return previous.value;
  };
  return [
    { time: 0, value: sample(offset) },
    ...sorted
      .filter((point) => point.time > offset && point.time < offset + duration)
      .map((point) => ({ ...point, time: point.time - offset })),
    { time: duration, value: sample(offset + duration) },
  ];
}

function suffix(id: string, pieceId: string, index: number) {
  return `${id.slice(0, 48)}:${pieceId}:${index}`;
}
function ownerMetadata<
  T extends { readonly templateSource?: { readonly ownerClipId: string } },
>(metadata: T | undefined, beforeId: string, afterId: string): T | undefined {
  return metadata?.templateSource?.ownerClipId === beforeId
    ? {
        ...metadata,
        templateSource: { ...metadata.templateSource, ownerClipId: afterId },
      }
    : metadata;
}

/** Build one media piece without serializing any project/media library data.
 * Keyframe curves keep their complete handles, including off-piece keys needed
 * to interpolate correctly. Existing nonlinear source records are retained;
 * their source mapping needs the separate ramp/freeze integration. */
export function createClipFragment(
  clip: Clip,
  slice: TimelineSlice,
  id: string,
  project: Project,
): Clip {
  const offset = slice.fromTime - clip.startTime,
    end = offset + slice.duration;
  if (
    ![offset, end, slice.startTime, slice.duration].every(finite) ||
    slice.startTime < 0 ||
    slice.duration <= 0
  )
    throw new Error("The clip fragment has invalid timing.");
  const rate = Math.abs(clip.speed ?? 1);
  if (!finite(rate) || rate < SPEED_MIN || rate > SPEED_MAX)
    throw new Error("The clip has an invalid playback speed.");
  const generated =
    project.mediaLibrary.items.find((media) => media.id === clip.mediaId)
      ?.type === "image" || !!clip.metadata?.motionClip;
  const sourceEnd = generated
    ? clip.inPoint + clip.duration * rate
    : clip.outPoint;
  // Keep the established nonlinear data path until its source-time map is
  // integrated; a constant-rate source must use its actual rate and direction.
  const nonlinear =
    !!clip.speedKeyframes?.length || !!clip.freezeFrames?.length;
  const sourceRate = nonlinear ? 1 : rate,
    reversed = !nonlinear && (clip.reversed || (clip.speed ?? 1) < 0);
  const mediaDuration = project.mediaLibrary.items.find(
    (media) => media.id === clip.mediaId,
  )?.metadata.duration;
  const sourceLimit = generated
    ? Infinity
    : typeof mediaDuration === "number" &&
        finite(mediaDuration) &&
        mediaDuration > 0
      ? mediaDuration
      : sourceEnd;
  const sample = (time: number) => {
    if (time === 0) return reversed ? sourceEnd : clip.inPoint;
    if (time === clip.duration) return reversed ? clip.inPoint : sourceEnd;
    return Math.max(
      0,
      Math.min(
        sourceLimit,
        reversed
          ? sourceEnd - time * sourceRate
          : clip.inPoint + time * sourceRate,
      ),
    );
  };
  const first = sample(offset),
    last = sample(end),
    sameId = id === clip.id;
  const volumePoints = resolveClipBaseVolumeAutomation(clip, project.timeline);
  const automation =
    clip.automation || volumePoints.length
      ? {
          ...clip.automation,
          ...(volumePoints.length || clip.automation?.volume
            ? {
                volume: fragmentAutomation(
                  volumePoints,
                  offset,
                  slice.duration,
                  clip.volume,
                  0,
                  4,
                ),
              }
            : {}),
          ...(clip.automation?.pan
            ? {
                pan: fragmentAutomation(
                  clip.automation.pan,
                  offset,
                  slice.duration,
                  getPanFromAudioEffects(clip.audioEffects),
                  -1,
                  1,
                ),
              }
            : {}),
        }
      : undefined;
  const keys: Keyframe[] = clip.keyframes.map((key, i) => ({
    ...key,
    id: sameId ? key.id : suffix(key.id, id, i),
    time: key.time - offset,
  }));
  const effects = (items: Clip["effects"]) =>
    sameId
      ? items
      : items.map((effect, i) => ({
          ...effect,
          id: suffix(effect.id, id, i),
          metadata: ownerMetadata(effect.metadata, clip.id, id),
        }));
  const metadata = {
    ...ownerMetadata(clip.metadata, clip.id, id),
    splitSourceClipId: clip.metadata?.splitSourceClipId ?? clip.id,
  };
  return {
    ...clip,
    id,
    startTime: slice.startTime,
    duration: slice.duration,
    inPoint: Math.min(first, last),
    outPoint: Math.max(first, last),
    metadata,
    keyframes: keys,
    effects: effects(clip.effects),
    audioEffects: effects(clip.audioEffects),
    ...(clip.fade ? { fade: fragmentFade(clip, offset) } : {}),
    ...(automation ? { automation } : {}),
    ...(clip.emphasisAnimation
      ? {
          emphasisAnimation: {
            ...clip.emphasisAnimation,
            startTime: (clip.emphasisAnimation.startTime ?? 0) - offset,
          },
        }
      : {}),
  };
}

function hash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++)
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return (result >>> 0).toString(16);
}

export function prepareClipSplit(
  project: Project,
  clipId: string,
  time: number,
  operationId: string,
): TimelineToolPlan & { rightClipId: string } {
  const track = project.timeline.tracks.find((track) =>
    track.clips.some((clip) => clip.id === clipId),
  );
  const clip = track?.clips.find((clip) => clip.id === clipId);
  if (!clip || !track)
    throw new Error("The source clip is no longer available.");
  if (track.locked)
    throw new Error("Unlock the source track before splitting.");
  if (
    !finite(time) ||
    time <= clip.startTime ||
    time >= clip.startTime + clip.duration
  )
    throw new Error("Split time must be inside the source clip.");
  const rightClipId = `split-${hash(operationId)}-${hash(clip.id)}`;
  const ownerIds = [
    ...project.timeline.tracks.flatMap((track) => track.clips),
    ...(project.textClips ?? []),
    ...(project.shapeClips ?? []),
    ...(project.svgClips ?? []),
    ...(project.stickerClips ?? []),
    ...(project.nestedInstances ?? []),
    ...(project.adjustmentLayers ?? []),
  ];
  if (ownerIds.some((item) => item.id === rightClipId))
    throw new Error("The split piece ID is already in use.");
  const index = track.clips.indexOf(clip),
    offset = time - clip.startTime;
  const left = createClipFragment(
    clip,
    {
      startTime: clip.startTime,
      duration: offset,
      fromTime: clip.startTime,
      inserted: false,
    },
    clip.id,
    project,
  );
  const right = createClipFragment(
    clip,
    {
      startTime: time,
      duration: clip.duration - offset,
      fromTime: time,
      inserted: false,
    },
    rightClipId,
    project,
  );
  const edits: TimelineToolItemEdit[] = [
    {
      kind: "media",
      id: clip.id,
      trackId: track.id,
      index,
      before: clip,
      after: left,
    },
    {
      kind: "media",
      id: right.id,
      trackId: track.id,
      index: index + 1,
      before: null,
      after: right,
    },
  ];
  track.transitions.forEach((transition, i) => {
    const outgoing =
      transition.clipAId === clip.id &&
      (transition.clipBId || transition.edge !== "in");
    if (
      !outgoing &&
      transition.clipAId !== clip.id &&
      transition.clipBId !== clip.id
    )
      return;
    const target = outgoing ? right : left;
    const next = {
      ...transition,
      ...(outgoing ? { clipAId: right.id } : {}),
      duration: Math.min(transition.duration, target.duration),
    };
    if (
      next.clipAId !== transition.clipAId ||
      next.duration !== transition.duration
    )
      edits.push({
        kind: "transition",
        id: transition.id,
        trackId: track.id,
        index: i,
        before: transition,
        after: next,
      });
  });
  project.nestedInstances?.forEach((instance, i) => {
    if (instance.id !== clip.id) return;
    for (const [n, item] of [left, right].entries())
      edits.push({
        kind: "nested",
        id: item.id,
        trackId: track.id,
        index: i + n,
        before: n ? null : instance,
        after: {
          ...instance,
          id: item.id,
          startTime: item.startTime,
          duration: item.duration,
          inPoint: item.inPoint,
          outPoint: item.outPoint,
        },
      });
  });
  project.masks?.forEach((mask, i) => {
    if (mask.clipId !== clip.id) return;
    const id = suffix(mask.id, right.id, i);
    edits.push({
      kind: "mask",
      id,
      trackId: track.id,
      index: i + 1,
      before: null,
      after: {
        ...mask,
        id,
        clipId: right.id,
        keyframes: mask.keyframes.map((key, k) => ({
          ...key,
          id: suffix(key.id, right.id, k),
        })),
      },
    });
  });
  project.particleEffects?.forEach((effect, i) => {
    if (effect.clipId !== clip.id) return;
    const id = suffix(effect.id, right.id, i);
    edits.push({
      kind: "particle",
      id,
      trackId: track.id,
      index: i + 1,
      before: null,
      after: {
        ...effect,
        id,
        seedId: effect.seedId ?? effect.id,
        clipId: right.id,
        clipStartTime: (effect.clipStartTime ?? clip.startTime) + offset,
      },
    });
  });
  return { label: "Split clip", delta: 0, edits, rightClipId };
}
