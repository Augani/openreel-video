import type { Clip, Track } from "../types/timeline";
import type { Project } from "../types/project";

/**
 * Clip groups (Premiere's Group / Ungroup). A group is the set of media clips that share a `groupId`.
 * Pure helpers only: the caller commits the returned project as one undo step.
 */
export type ClipGroupResult =
  | { readonly ok: true; readonly project: Project; readonly groupId?: string; readonly changed: number }
  | { readonly ok: false; readonly message: string };

const mediaClips = (tracks: readonly Track[]): Clip[] => tracks.flatMap((track) => track.clips);

/** Every member of the groups the given clips belong to, plus the clips themselves; ids with no group pass through. */
export function expandClipGroups(tracks: readonly Track[], ids: readonly string[]): string[] {
  const clips = mediaClips(tracks);
  const groupOf = new Map(clips.map((clip) => [clip.id, clip.groupId]));
  const wanted = new Set<string>();
  for (const id of ids) {
    const group = groupOf.get(id);
    if (group) wanted.add(group);
  }
  if (!wanted.size) return [...ids];
  const out = new Set(ids);
  for (const clip of clips) if (clip.groupId && wanted.has(clip.groupId)) out.add(clip.id);
  return [...out];
}

/** The members of a group, in timeline order of the tracks. */
export function groupMembers(tracks: readonly Track[], groupId: string): Clip[] {
  return mediaClips(tracks).filter((clip) => clip.groupId === groupId);
}

/**
 * Selection follows the group: a clip newly selected brings its whole group in, a clip newly deselected takes its
 * group out. `previous` is the selection before the change, `next` after it.
 */
export function reconcileGroupSelection(
  tracks: readonly Track[],
  previous: readonly string[],
  next: readonly string[],
): string[] {
  const clips = mediaClips(tracks);
  const groupOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const clip of clips) {
    if (!clip.groupId) continue;
    groupOf.set(clip.id, clip.groupId);
    const list = members.get(clip.groupId);
    if (list) list.push(clip.id);
    else members.set(clip.groupId, [clip.id]);
  }
  if (!groupOf.size) return [...next];
  const before = new Set(previous);
  const after = new Set(next);
  const adding = new Set<string>();
  const removing = new Set<string>();
  for (const id of after) {
    const group = groupOf.get(id);
    if (group && !before.has(id)) adding.add(group);
  }
  for (const id of before) {
    const group = groupOf.get(id);
    if (group && !after.has(id)) removing.add(group);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    result.push(id);
  };
  for (const id of next) {
    const group = groupOf.get(id);
    if (group && removing.has(group) && !adding.has(group)) continue;
    push(id);
  }
  for (const group of adding) for (const id of members.get(group) ?? []) push(id);
  return result;
}

const replaceClips = (project: Project, edit: (clip: Clip) => Clip): Project => ({
  ...project,
  modifiedAt: Date.now(),
  timeline: {
    ...project.timeline,
    tracks: project.timeline.tracks.map((track) => {
      const clips = track.clips.map(edit);
      return clips.some((clip, index) => clip !== track.clips[index]) ? { ...track, clips } : track;
    }),
  },
});

/**
 * Group: the selected clips (and any group they already belong to) become ONE group. Clips on a locked track
 * are refused so a group never straddles a lock. At least two clips are needed.
 */
export function groupClips(project: Project, ids: readonly string[], newGroupId: string): ClipGroupResult {
  const tracks = project.timeline.tracks;
  const expanded = new Set(expandClipGroups(tracks, ids));
  const targets = mediaClips(tracks).filter((clip) => expanded.has(clip.id));
  if (targets.length < 2) return { ok: false, message: "Select at least two clips to group." };
  const locked = new Set(tracks.filter((track) => track.locked).map((track) => track.id));
  if (targets.some((clip) => locked.has(clip.trackId))) return { ok: false, message: "Unlock the tracks of the selected clips before grouping." };
  const next = replaceClips(project, (clip) => (expanded.has(clip.id) ? { ...clip, groupId: newGroupId } : clip));
  return { ok: true, project: next, groupId: newGroupId, changed: targets.length };
}

/** Ungroup: every group touched by the selection dissolves; the clips themselves are untouched. */
export function ungroupClips(project: Project, ids: readonly string[]): ClipGroupResult {
  const tracks = project.timeline.tracks;
  const expanded = new Set(expandClipGroups(tracks, ids));
  const targets = mediaClips(tracks).filter((clip) => expanded.has(clip.id) && clip.groupId);
  if (!targets.length) return { ok: false, message: "The selection has no grouped clips." };
  const locked = new Set(tracks.filter((track) => track.locked).map((track) => track.id));
  if (targets.some((clip) => locked.has(clip.trackId))) return { ok: false, message: "Unlock the tracks of the grouped clips before ungrouping." };
  const next = replaceClips(project, (clip) => {
    if (!expanded.has(clip.id) || !clip.groupId) return clip;
    const { groupId: _gone, ...rest } = clip;
    void _gone;
    return rest;
  });
  return { ok: true, project: next, changed: targets.length };
}

/** A group needs two members: drop `groupId` from any clip left alone in its group (after a delete, say). */
export function pruneSingletonGroups(project: Project): Project {
  const counts = new Map<string, number>();
  for (const clip of mediaClips(project.timeline.tracks)) if (clip.groupId) counts.set(clip.groupId, (counts.get(clip.groupId) ?? 0) + 1);
  if (![...counts.values()].some((count) => count < 2)) return project;
  return replaceClips(project, (clip) => {
    if (!clip.groupId || (counts.get(clip.groupId) ?? 0) >= 2) return clip;
    const { groupId: _gone, ...rest } = clip;
    void _gone;
    return rest;
  });
}
