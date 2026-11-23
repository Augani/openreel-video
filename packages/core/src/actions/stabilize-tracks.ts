import type { Clip, Track } from "../types/timeline";

/**
 * Many action handlers rebuild every track as `{ ...track, clips: track.clips.map(...) }`
 * to change one clip, so every track (and often every clip) gets a new identity per
 * edit. React.memo'd lanes, headers and clips downstream then re-render on a
 * mutation that did not touch them. This hands the previous object back wherever
 * the rebuilt one is field-for-field the same: arrays compare element by element
 * (one level), every other value by identity. Nothing is mutated and the result
 * is always equal in content to `next`.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return false;
}

function sameFields(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!(key in right) || !sameValue(left[key], right[key])) return false;
  }
  return true;
}

export function reuseUnchangedTracks<T extends Track>(
  previous: readonly T[],
  next: readonly T[],
): readonly T[] {
  if (previous === next) return next;
  const before = new Map<string, T>();
  for (const track of previous) before.set(track.id, track);
  let allSame = previous.length === next.length;
  const result = next.map((track, index) => {
    const old = before.get(track.id);
    if (!old) {
      allSame = false;
      return track;
    }
    let candidate = track;
    if (old !== track) {
      let clips = track.clips as readonly Clip[];
      if (clips !== old.clips) {
        const oldClips = new Map<string, Clip>();
        for (const clip of old.clips) oldClips.set(clip.id, clip);
        let reused = false;
        const stable = clips.map((clip) => {
          const prior = oldClips.get(clip.id);
          if (prior && prior !== clip && sameFields(prior, clip)) {
            reused = true;
            return prior;
          }
          return clip;
        });
        if (reused) clips = stable;
      }
      candidate = clips === track.clips ? track : ({ ...track, clips } as T);
      if (sameFields(old, candidate)) candidate = old;
    }
    if (candidate !== previous[index]) allSame = false;
    return candidate;
  });
  return allSame ? previous : result;
}
