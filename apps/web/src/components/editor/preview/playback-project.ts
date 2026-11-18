import { useRef } from "react";
import type { MediaItem, Project } from "@openreel/core";

/**
 * Media item fields the Program monitor never reads while playing. Waveform extraction and thumbnails finish in
 * the background (a 10-minute 4K source takes several seconds) and write these into the media library mid-playback.
 */
const NON_PLAYBACK_MEDIA_FIELDS: ReadonlySet<string> = new Set(["waveformData", "thumbnailUrl", "filmstripThumbnails"]);

function sameMediaItemForPlayback(a: MediaItem, b: MediaItem): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (NON_PLAYBACK_MEDIA_FIELDS.has(key)) continue;
    if ((a as unknown as Record<string, unknown>)[key] !== (b as unknown as Record<string, unknown>)[key]) return false;
  }
  return true;
}

/**
 * True when `next` is `prev` with only playback-irrelevant media fields written (waveforms, thumbnails, filmstrips),
 * which the background media jobs do by replacing the touched media items (and bumping `modifiedAt`).
 *
 * Anything else counts as a change, including a new project object whose children are all the same references:
 * several store actions edit nested state in place and publish it with `set({ project: { ...project } })`, so a
 * shallow copy with identical children can carry a real edit (an effect, a mask, a colour correction).
 */
export function sameProjectForPlayback(prev: Project, next: Project): boolean {
  if (prev === next) return true;
  const topKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of topKeys) {
    if (key === "mediaLibrary" || key === "modifiedAt") continue;
    if ((prev as unknown as Record<string, unknown>)[key] !== (next as unknown as Record<string, unknown>)[key]) return false;
  }
  const a = prev.mediaLibrary;
  const b = next.mediaLibrary;
  // Nothing below the project changed identity: this may be an in-place edit published as a shallow copy.
  if (a === b) return false;
  const libKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of libKeys) {
    if (key === "items") continue;
    if ((a as unknown as Record<string, unknown>)[key] !== (b as unknown as Record<string, unknown>)[key]) return false;
  }
  if (a.items === b.items || a.items.length !== b.items.length) return false;
  let replacedItems = 0;
  for (let i = 0; i < a.items.length; i++) {
    if (a.items[i] === b.items[i]) continue;
    if (!sameMediaItemForPlayback(a.items[i], b.items[i])) return false;
    replacedItems++;
  }
  // Only a media item replaced with nothing but waveform / thumbnail changes keeps the playback identity.
  return replacedItems > 0;
}

/**
 * The project, kept at the same identity while only playback-irrelevant fields change.
 *
 * The playback effect depends on the project: every new identity tears playback down (clock paused, decoders
 * closed) and starts it again. A waveform finishing in the background used to do that mid-play, which cost a
 * 0.7 to 1 s hitch each time and, on the soak's layered 4K timeline, froze playback for the rest of the run
 * (docs/known-limitations.md, Memory: playback events show the effect restarted at 7.6 s, 11.1 s and 24.6 s, each
 * time right after a waveformData write).
 */
export function useStablePlaybackProject(project: Project): Project {
  const stable = useRef(project);
  if (stable.current !== project && !sameProjectForPlayback(stable.current, project)) {
    stable.current = project;
  }
  return stable.current;
}
