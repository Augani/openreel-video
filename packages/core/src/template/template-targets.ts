import type { Timeline } from "../types/timeline";
import type { TemplateProjectContent } from "../types/template";
import type {
  ExtendedPlaceholder,
  PlaceholderTarget,
} from "../types/scriptable-template";

type Subject = Record<string, unknown>;
function records(value: unknown): Subject[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Subject => item !== null && typeof item === "object",
      )
    : [];
}
function add(index: Map<string, Subject[]>, subject: Subject, id = subject.id) {
  if (typeof id !== "string") return;
  const matches = index.get(id);
  if (matches) matches.push(subject);
  else index.set(id, [subject]);
}

/** Build once per owned application; duplicate timeline/canonical IDs remain linked. */
export function indexTemplateTargets(
  timeline: Timeline,
  content: TemplateProjectContent,
) {
  const clips = new Map<string, Subject[]>(),
    tracks = new Map<string, Subject[]>(),
    effects = new Map<string, Subject[]>(),
    keyframes = new Map<string, Subject[]>(),
    subtitles = new Map<string, Subject[]>(),
    legacy = new Map<string, Subject[]>(),
    legacySubtitles = new Map<string, Subject[]>();
  const timelineClips: Subject[] = [];
  for (const track of timeline.tracks) {
    add(tracks, track as unknown as Subject);
    for (const clip of track.clips) {
      const record = clip as unknown as Subject;
      timelineClips.push(record);
      if (record.isPlaceholder) add(legacy, record, record.placeholderId);
    }
  }
  for (const clip of [
    ...timelineClips,
    ...records(content.textClips),
    ...records(content.shapeClips),
    ...records(content.svgClips),
    ...records(content.stickerClips),
  ]) {
    add(clips, clip);
    for (const effect of records(clip.effects)) {
      add(effects, effect);
      for (const key of records(effect.keyframes)) add(keyframes, key);
    }
    for (const key of records(clip.keyframes)) add(keyframes, key);
  }
  const captionRecords = timeline.subtitles as unknown as Subject[];
  for (const caption of captionRecords) {
    add(subtitles, caption);
    if (caption.isPlaceholder)
      add(legacySubtitles, caption, caption.placeholderId);
  }
  return {
    timeline,
    content,
    dirty: false,
    clips,
    tracks,
    effects,
    keyframes,
    subtitles,
    legacy,
    legacySubtitles,
    timelineClips,
    captionRecords,
  };
}
type TemplateTargetIndex = ReturnType<typeof indexTemplateTargets>;

/** Structural edits are uncommon; rebuild only when target identities or arrays change. */
export function refreshTemplateTargets(index: TemplateTargetIndex): void {
  if (index.dirty)
    Object.assign(index, indexTemplateTargets(index.timeline, index.content));
}

export function applyIndexedTemplateTarget(
  index: TemplateTargetIndex,
  target: PlaceholderTarget,
  value: unknown,
  field: Pick<ExtendedPlaceholder, "id" | "type">,
  set: (subject: Subject, path: string, value: unknown) => boolean,
): string[] {
  refreshTemplateTargets(index);
  const warnings: string[] = [];
  let matches: Subject[] = [],
    caption = false;
  if (target.clipId) {
    matches = index.clips.get(target.clipId) ?? [];
    if (!matches.length) {
      matches = index.subtitles.get(target.clipId) ?? [];
      caption = true;
    }
    if (!matches.length)
      return [`Clip ${target.clipId} not found for placeholder ${field.id}`];
    if (target.effectId)
      matches = matches.flatMap((subject) =>
        records(subject.effects).filter(
          (effect) => effect.id === target.effectId,
        ),
      );
    if (target.keyframeId)
      matches = matches.flatMap((subject) =>
        records(subject.keyframes).filter(
          (key) => key.id === target.keyframeId,
        ),
      );
  } else if (target.trackId)
    matches = (index.tracks.get(target.trackId) ?? []).slice(0, 1);
  else if (target.effectId) {
    matches = index.effects.get(target.effectId) ?? [];
    if (target.keyframeId)
      matches = matches.flatMap((subject) =>
        records(subject.keyframes).filter(
          (key) => key.id === target.keyframeId,
        ),
      );
  } else if (target.keyframeId)
    matches = index.keyframes.get(target.keyframeId) ?? [];
  if (!matches.length) return [`Target not found for placeholder ${field.id}`];
  for (const subject of matches) {
    const media =
      (field.type === "media" || field.type === "audio") &&
      Boolean(target.clipId) &&
      (target.property === "content" || target.property === "mediaId");
    const property =
      target.property === "content" &&
      (caption || media || (field.type === "text" && "text" in subject))
        ? media
          ? "mediaId"
          : "text"
        : target.property;
    if (!set(subject, property, structuredClone(media ? field.id : value)))
      warnings.push(`Failed to set ${property} for placeholder ${field.id}`);
    else if (/^(?:id|clips|effects|keyframes)(?:$|\.|\[)/.test(property))
      index.dirty = true;
  }
  return warnings;
}

export function removeLegacyTemplateFlags(index: TemplateTargetIndex): void {
  refreshTemplateTargets(index);
  for (const subject of [...index.timelineClips, ...index.captionRecords]) {
    delete subject.isPlaceholder;
    delete subject.placeholderId;
  }
}
