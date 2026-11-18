import type { Track } from "@openreel/core";

/** Visual rows count upwards from the bottom; audio rows count downwards. */
export function getTrackBadge(tracks: readonly Pick<Track, "id" | "type">[], trackId: string): string | undefined {
  const track = tracks.find(candidate => candidate.id === trackId);
  if (!track) return undefined;
  const audio = track.type === "audio";
  let index = 0;
  let count = 0;
  for (const candidate of tracks) {
    if ((candidate.type === "audio") !== audio) continue;
    if (candidate.id === trackId) index = count;
    count++;
  }
  return audio ? `A${index + 1}` : `V${count - index}`;
}
