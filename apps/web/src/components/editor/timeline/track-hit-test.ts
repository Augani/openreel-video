/**
 * Maps a vertical offset (px from the top of the first track row) to the track whose row contains it.
 * `rowHeights` must be the full row heights (clip lane plus any expanded automation lanes) so a track below an
 * expanded one is not mis-hit. Returns undefined below the last row.
 */
export function trackIdAtOffset(
  tracks: ReadonlyArray<{ id: string }>,
  rowHeights: ReadonlyMap<string, number>,
  offset: number,
  fallbackHeight = 48,
): string | undefined {
  let top = 0;
  for (const track of tracks) {
    const height = rowHeights.get(track.id) || fallbackHeight;
    if (offset >= top && offset < top + height) return track.id;
    top += height;
  }
  return undefined;
}
