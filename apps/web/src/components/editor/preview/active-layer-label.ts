import { getCompoundClipId, getMediaItemCapabilities, type Project, type TextClip, type ShapeClip, type SVGClip, type StickerClip } from "@openreel/core";

interface LayerLabel {
  name: string;
  start: number;
  end: number;
}

interface PreviewLabelBoundary {
  time: number;
  name: string | undefined;
}

/** Compile the visible painter order once per edit; playback only searches boundaries. */
export function buildPreviewLabelIndex(
  project: Project,
  textClips: readonly TextClip[] = project.textClips ?? [],
  graphics: readonly (ShapeClip | SVGClip | StickerClip)[] = [
    ...(project.shapeClips ?? []), ...(project.svgClips ?? []), ...(project.stickerClips ?? []),
  ],
): PreviewLabelBoundary[] {
  const visible = new Map(project.timeline.tracks.filter(track => !track.hidden).map(track => [track.id, [] as LayerLabel[]]));
  const media = new Map(project.mediaLibrary.items.map(item => [item.id, item]));
  const sequences = new Map(project.compoundClips?.map(item => [item.id, item.name]));
  const compositions = new Map(project.motionCompositions?.map(item => [item.id, item.name]));
  const add = (trackId: string, clip: { startTime: number; duration: number; transform?: { opacity: number } }, name: string) => {
    const end = clip.startTime + clip.duration;
    if ((clip.transform?.opacity ?? 1) <= 0 || !Number.isFinite(clip.startTime) || !Number.isFinite(end) || clip.duration <= 0) return;
    visible.get(trackId)?.push({ name, start: clip.startTime, end });
  };
  for (const track of project.timeline.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      const nestedId = getCompoundClipId(clip);
      if (nestedId) {
        add(track.id, clip, sequences.get(nestedId) ?? "Nested sequence");
      } else {
        const item = media.get(clip.mediaId);
        if (getMediaItemCapabilities(item).visual && item) add(track.id, clip, item.name);
      }
    }
  }
  for (const clip of graphics) {
    const name = typeof clip.metadata?.name === "string" ? clip.metadata.name
      : clip.type === "shape" ? clip.shapeType
      : clip.type === "svg" ? "SVG" : clip.name ?? "Sticker";
    add(clip.trackId, clip, name);
  }
  for (const clip of project.motionInstances ?? []) {
    if (!clip.trackId || clip.opacity <= 0) continue;
    add(clip.trackId, clip, clip.name ?? compositions.get(clip.compositionId) ?? "Motion composition");
  }
  for (const clip of textClips) {
    const text = clip.text.trim().replace(/\s+/g, " ");
    if (text) add(clip.trackId, clip, `Title · ${text}`);
  }
  // Index 0 is front-most. Within one track, text paints over motion,
  // graphics and media; later items of a kind paint over earlier ones.
  const layers = [...visible.values()].flatMap(items => items.reverse());
  const events = layers.flatMap((layer, id) => [
    { time: layer.start, id, active: true },
    { time: layer.end, id, active: false },
  ]).sort((a, b) => a.time - b.time);
  const active = new Set<number>();
  const heap: number[] = [];
  const push = (id: number) => {
    let at = heap.length;
    heap.push(id);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (heap[parent] <= id) break;
      heap[at] = heap[parent];
      at = parent;
    }
    heap[at] = id;
  };
  const removeFirst = () => {
    const last = heap.pop();
    if (!heap.length || last === undefined) return;
    let at = 0;
    while (at * 2 + 1 < heap.length) {
      let child = at * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1] < heap[child]) child++;
      if (last <= heap[child]) break;
      heap[at] = heap[child];
      at = child;
    }
    heap[at] = last;
  };
  const result: PreviewLabelBoundary[] = [];
  for (let i = 0; i < events.length;) {
    const time = events[i].time;
    while (i < events.length && events[i].time === time) {
      const event = events[i++];
      if (event.active) { active.add(event.id); push(event.id); }
      else active.delete(event.id);
    }
    while (heap.length && !active.has(heap[0])) removeFirst();
    const name = heap.length ? layers[heap[0]].name : undefined;
    if (result.at(-1)?.name !== name) result.push({ time, name });
  }
  return result;
}

export function previewLabelAt(index: readonly PreviewLabelBoundary[], time: number): string | undefined {
  let low = 0;
  let high = index.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (index[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return index[low - 1]?.name;
}
