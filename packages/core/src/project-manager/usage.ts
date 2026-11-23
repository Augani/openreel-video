/**
 * Which parts of which media the chosen sequences play. Works on the project as sequences (a project from before
 * sequences is lifted by `ensureSequences`), follows nests into the sequences they hold, resolves subclips to their
 * parent file, and treats a multicam clip as using every angle over the same shared-time window so the angle switcher
 * keeps working in the copy.
 */
import type { Project } from "../types/project";
import {
  descendantSequenceIds,
  ensureSequences,
  isNestClip,
  syncActiveSequence,
} from "../timeline/sequences";
import { getMulticamSource, multicamTag } from "../multicam/fixed-audio";
import type { TimeRange } from "./segments";

export interface MediaUsage {
  readonly mediaId: string;
  /** Source ranges (seconds of the real file) the clips play, unmerged. */
  readonly ranges: TimeRange[];
  /** Used outside a clip (graphics, motion layers) or a still: the whole file must be kept. */
  whole: boolean;
  /** A multicam angle: shared-time sync allows ONE kept stretch, so every range merges into one. */
  single: boolean;
  clips: number;
}

export interface UsageResult {
  /** The sequences to keep: the chosen ones plus every sequence they nest. */
  readonly sequenceIds: string[];
  /** Real files that clips play, by item id of the file (subclips resolved to their parent). */
  readonly usage: Map<string, MediaUsage>;
  /** Every media item id the kept sequences refer to (subclips and their parents, whole multicam sets). */
  readonly usedItemIds: Set<string>;
  readonly multicamSourceIds: Set<string>;
  /** The project this was computed on: sequences present and the active one synced. */
  readonly project: Project;
}

const SKIPPED_KEYS = new Set(["mediaLibrary", "timeline", "sequences", "compoundClips", "multicamSources", "settings"]);

function walkStrings(value: unknown, visit: (s: string) => void, depth = 0): void {
  if (depth > 40 || value === null || value === undefined) return;
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const v of value) walkStrings(v, visit, depth + 1);
  else if (typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) walkStrings(v, visit, depth + 1);
}

export function collectMediaUsage(input: Project, selected: readonly string[]): UsageResult {
  const project = ensureSequences(syncActiveSequence(input));
  const all = project.sequences ?? [];
  const known = new Set(all.map((s) => s.id));
  const chosen = selected.filter((id) => known.has(id));
  const keep = new Set<string>(chosen);
  for (const id of chosen) for (const child of descendantSequenceIds(project, id)) keep.add(child);
  const sequenceIds = all.filter((s) => keep.has(s.id)).map((s) => s.id);

  const items = new Map(project.mediaLibrary.items.map((item) => [item.id, item]));
  const usage = new Map<string, MediaUsage>();
  const usedItemIds = new Set<string>();
  const multicamSourceIds = new Set<string>();

  const entry = (mediaId: string): MediaUsage => {
    let u = usage.get(mediaId);
    if (!u) {
      u = { mediaId, ranges: [], whole: false, single: false, clips: 0 };
      usage.set(mediaId, u);
    }
    return u;
  };
  const baseId = (mediaId: string): string => items.get(mediaId)?.subclip?.parentId ?? mediaId;
  const touch = (mediaId: string): void => {
    usedItemIds.add(mediaId);
    const parent = items.get(mediaId)?.subclip?.parentId;
    if (parent) usedItemIds.add(parent);
  };

  for (const sequence of all) {
    if (!keep.has(sequence.id)) continue;
    for (const track of sequence.timeline.tracks) {
      for (const clip of track.clips) {
        if (isNestClip(clip)) continue;
        const item = items.get(clip.mediaId);
        if (!item) continue;
        touch(clip.mediaId);
        const id = baseId(clip.mediaId);
        const u = entry(id);
        u.clips += 1;
        if (items.get(id)?.type === "image" || items.get(id)?.raw) u.whole = true;
        else u.ranges.push({ start: clip.inPoint, end: clip.outPoint });

        const tag = multicamTag(clip);
        const source = tag ? getMulticamSource(project, tag.sourceId) : undefined;
        const own = source?.angles.find((a) => a.id === tag?.angleId);
        if (source && own) {
          multicamSourceIds.add(source.id);
          const sharedStart = clip.inPoint + own.offset;
          const sharedEnd = clip.outPoint + own.offset;
          for (const angle of source.angles) {
            touch(angle.mediaId);
            const a = entry(baseId(angle.mediaId));
            a.single = true;
            const start = Math.max(0, sharedStart - angle.offset);
            const end = Math.min(angle.duration > 0 ? angle.duration : Infinity, sharedEnd - angle.offset);
            if (end > start && angle.mediaId !== clip.mediaId) a.ranges.push({ start, end });
          }
        }
      }
    }
  }

  // Anything else that names a media item (motion layers, graphics) needs the whole file.
  const ids = new Set(items.keys());
  const { mediaLibrary: _library, timeline: _timeline, sequences: _sequences, compoundClips: _compound, multicamSources: _multicam, settings: _settings, ...rest } = project;
  void _library; void _timeline; void _sequences; void _compound; void _multicam; void _settings;
  walkStrings(Object.fromEntries(Object.entries(rest).filter(([key]) => !SKIPPED_KEYS.has(key))), (s) => {
    if (ids.has(s)) {
      touch(s);
      entry(baseId(s)).whole = true;
    }
  });

  return { sequenceIds, usage, usedItemIds, multicamSourceIds, project };
}
