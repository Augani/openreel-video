import { useProjectStore } from "../stores/project-store";

export interface HighlightRange {
  start: number;
  end: number;
}

export async function applyHighlightRanges(
  clipId: string,
  ranges: HighlightRange[],
): Promise<number> {
  const sorted = [...ranges]
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return 0;

  const store = useProjectStore.getState();
  const proj = store.project;
  const originalTrack = proj.timeline.tracks.find((t) =>
    t.clips.some((c) => c.id === clipId),
  );
  if (!originalTrack) return 0;
  const clip = originalTrack.clips.find((c) => c.id === clipId);
  if (!clip) return 0;

  const clipStart = clip.startTime;
  const clipInPoint = clip.inPoint;

  const splitTimes: number[] = [];
  for (const h of sorted) {
    splitTimes.push(clipStart + (h.start - clipInPoint));
    splitTimes.push(clipStart + (h.end - clipInPoint));
  }
  const uniqueSplitTimes = [...new Set(splitTimes)]
    .sort((a, b) => a - b)
    .filter((t) => t > clipStart && t < clipStart + clip.duration);

  for (const splitTime of uniqueSplitTimes) {
    const currentProj = useProjectStore.getState().project;
    const track = currentProj.timeline.tracks.find((t) => t.id === originalTrack.id);
    if (!track) break;
    const clipAtTime = track.clips.find(
      (c) => c.startTime < splitTime && c.startTime + c.duration > splitTime,
    );
    if (clipAtTime) {
      await store.splitClip(clipAtTime.id, splitTime);
    }
  }

  const finalProj = useProjectStore.getState().project;
  const finalTrack = finalProj.timeline.tracks.find((t) => t.id === originalTrack.id);
  if (!finalTrack) return 0;

  const clipsToRemove = finalTrack.clips.filter((c) => {
    const cSourceStart = c.inPoint;
    const cSourceEnd = c.inPoint + c.duration;
    return !sorted.some((h) => h.start < cSourceEnd && h.end > cSourceStart);
  });
  for (const c of clipsToRemove.sort((a, b) => b.startTime - a.startTime)) {
    await useProjectStore.getState().rippleDeleteClip(c.id);
  }
  return sorted.length;
}
