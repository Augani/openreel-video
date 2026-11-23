import type { Subtitle, SubtitleStyle } from "../types/timeline";
import { SPEAKER_EMBEDDING_DIMENSIONS, SPEAKER_EMBEDDING_WEIGHTS } from "./speaker-embedding";

/**
 * Speaker diarization (pure logic). Voice embeddings come from
 * speaker-embedding.ts (computed in a worker); this module clusters them,
 * labels caption cues "Speaker 1..N" in order of first appearance, and keeps
 * the per-speaker look (colour, caption position) that is baked onto cues so
 * preview and every export render identically.
 */

export type SpeakerPosition = "top" | "center" | "bottom";

export interface SpeakerProfile {
  /** The label cues carry in `Subtitle.speaker`. Unique within a project. */
  readonly name: string;
  /** Hex colour used in the transcript and (when `styleCaptions`) for caption text. */
  readonly color: string;
  /** Caption position for this speaker; unset keeps the cue's own. */
  readonly position?: SpeakerPosition;
  /** Bake colour/position onto this speaker's cues. Default true. */
  readonly styleCaptions?: boolean;
}

export const SPEAKER_PALETTE: readonly string[] = [
  "#4F9DFF",
  "#FF8A4C",
  "#3DD68C",
  "#E56BFF",
  "#FFD24A",
  "#FF5C7A",
  "#4FD8E6",
  "#A98BFF",
];

export const defaultSpeakerName = (n: number): string => `Speaker ${n}`;
export const paletteColor = (index: number): string => SPEAKER_PALETTE[index % SPEAKER_PALETTE.length];

export interface ClusterOptions {
  /** Force exactly this many speakers (clamped to the number of voices). */
  speakerCount?: number;
  /** Upper bound when auto-detecting. Default 8. */
  maxSpeakers?: number;
  /** Fixed merge-distance cut instead of gap detection (advanced). */
  threshold?: number;
}

function standardize(vectors: readonly Float32Array[], weights?: ArrayLike<number>): Float64Array[] {
  const dims = vectors[0].length;
  const mean = new Float64Array(dims);
  for (const v of vectors) for (let d = 0; d < dims; d++) mean[d] += v[d] / vectors.length;
  const sd = new Float64Array(dims);
  for (const v of vectors) for (let d = 0; d < dims; d++) sd[d] += (v[d] - mean[d]) ** 2 / vectors.length;
  // Shrink toward the average spread so near-constant (noise-only) dimensions are not blown up.
  const floor = 0.25 * (sd.reduce((a, b) => a + b, 0) / dims);
  return vectors.map((v) => Float64Array.from(v, (x, d) => ((x - mean[d]) / (Math.sqrt(sd[d] + floor) || 1)) * (weights ? weights[d] : 1)));
}

export function cosineDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? 1 - dot / Math.sqrt(na * nb) : 1;
}

export interface Merge {
  /** Average-linkage cosine distance at which the two clusters joined. */
  readonly height: number;
  /** Cluster count left after this merge. */
  readonly remaining: number;
}

/**
 * Full average-linkage dendrogram over z-scored embeddings (Lance-Williams
 * updates on a distance matrix). `owners(k)` cuts it to k clusters.
 */
function dendrogram(embeddings: readonly Float32Array[], weights?: ArrayLike<number>): { merges: Merge[]; owners: (k: number) => number[] } {
  const n = embeddings.length;
  const points = standardize(embeddings, weights);
  const dist = Array.from({ length: n }, (_, i) =>
    Float64Array.from({ length: n }, (_, j) => (i === j ? 0 : cosineDistance(points[i], points[j]))),
  );
  const members: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const alive: number[] = Array.from({ length: n }, (_, i) => i);
  const merges: Merge[] = [];
  const snapshots = new Map<number, number[][]>();
  snapshots.set(n, members.map((m) => [...m]));
  while (alive.length > 1) {
    let bi = 0;
    let bj = 1;
    let best = Infinity;
    for (let x = 0; x < alive.length; x++)
      for (let y = x + 1; y < alive.length; y++) {
        const d = dist[alive[x]][alive[y]];
        if (d < best) {
          best = d;
          bi = x;
          bj = y;
        }
      }
    const a = alive[bi];
    const b = alive[bj];
    const na = members[a].length;
    const nb = members[b].length;
    for (const c of alive) {
      if (c === a || c === b) continue;
      const d = (dist[a][c] * na + dist[b][c] * nb) / (na + nb);
      dist[a][c] = d;
      dist[c][a] = d;
    }
    members[a] = [...members[a], ...members[b]];
    alive.splice(bj, 1);
    merges.push({ height: best, remaining: alive.length });
    snapshots.set(alive.length, alive.map((id) => [...members[id]]));
  }
  const owners = (k: number) => {
    const owner = new Array<number>(n);
    (snapshots.get(Math.max(1, Math.min(n, k))) as number[][]).forEach((group, c) => group.forEach((m) => (owner[m] = c)));
    const renumber = new Map<number, number>();
    return owner.map((c) => {
      if (!renumber.has(c)) renumber.set(c, renumber.size);
      return renumber.get(c) as number;
    });
  };
  return { merges, owners };
}

/**
 * How many voices are there? Looks for the clearest gap in the merge heights:
 * a split into k voices is justified when the merge that would join two of
 * them costs much more than the merges inside them. The denominator is floored
 * so near-duplicate cues (height ~0) cannot fake a gap, and a dendrogram with
 * no clear gap is one voice. Needs at least three cues.
 */
export function estimateSpeakerCount(merges: readonly Merge[], maxSpeakers: number, minGap = 1.7): number {
  const n = merges.length + 1;
  if (n < 3) return 1;
  const heights = merges.map((m) => m.height);
  const floor = 0.3 * heights[heights.length - 1];
  let bestK = 1;
  let bestRatio = minGap;
  for (let k = 2; k <= Math.min(maxSpeakers, n - 1); k++) {
    // heights[n - k] is the merge that would take k clusters down to k - 1.
    const ratio = heights[n - k] / Math.max(heights[n - k - 1], floor, 1e-6);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestK = k;
    }
  }
  return bestK;
}

/**
 * Agglomerative (average-linkage, cosine) clustering. Returns one cluster id
 * per input, numbered 0..k-1 by first appearance. With no `speakerCount` the
 * count is detected from the dendrogram's clearest gap.
 */
export function clusterEmbeddings(
  embeddings: readonly Float32Array[],
  options: ClusterOptions = {},
): number[] {
  const n = embeddings.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  const maxSpeakers = Math.max(1, options.maxSpeakers ?? 8);
  const tree = dendrogram(embeddings, embeddings[0].length === SPEAKER_EMBEDDING_DIMENSIONS ? SPEAKER_EMBEDDING_WEIGHTS : undefined);
  const k = options.speakerCount
    ? Math.max(1, Math.min(n, Math.round(options.speakerCount)))
    : options.threshold !== undefined
      ? Math.min(maxSpeakers, 1 + tree.merges.filter((m) => m.height > (options.threshold as number)).length)
      : Math.min(maxSpeakers, estimateSpeakerCount(tree.merges, tree.merges.length));
  return tree.owners(k);
}

/**
 * Cue speaker labels from per-cue clusters. `clusters[i]` is the cluster of
 * `cues[i]` or null when the cue had no usable audio; such cues take the label
 * of the nearest labelled cue in time. A single flicker between two identical
 * neighbours (A B A) is smoothed to A.
 */
export function labelCuesBySpeaker(
  cues: readonly Pick<Subtitle, "startTime" | "endTime">[],
  clusters: ReadonlyArray<number | null>,
  existing: readonly SpeakerProfile[] = [],
  options: { smooth?: boolean; previous?: ReadonlyArray<string | undefined> } = {},
): { labels: string[]; profiles: SpeakerProfile[] } {
  const filled = [...clusters];
  const order = cues.map((_, i) => i).sort((a, b) => cues[a].startTime - cues[b].startTime);
  const labelled = order.filter((i) => clusters[i] !== null);
  for (const i of order) {
    if (filled[i] !== null || !labelled.length) continue;
    let nearest = labelled[0];
    for (const j of labelled)
      if (Math.abs(cues[j].startTime - cues[i].startTime) < Math.abs(cues[nearest].startTime - cues[i].startTime)) nearest = j;
    filled[i] = clusters[nearest];
  }
  if (options.smooth !== false) {
    for (let k = 1; k < order.length - 1; k++) {
      const prev = filled[order[k - 1]];
      const next = filled[order[k + 1]];
      const cur = filled[order[k]];
      const dur = cues[order[k]].endTime - cues[order[k]].startTime;
      if (prev !== null && prev === next && cur !== prev && dur < 1.2) filled[order[k]] = prev;
    }
  }
  const names = nameClusters(filled, order, options.previous);
  // A re-run replaces the old labels: profiles nothing maps to anymore are dropped.
  const mapped = new Set(names.values());
  const profiles: SpeakerProfile[] = options.previous ? existing.filter((p) => mapped.has(p.name)) : [...existing];
  for (const name of names.values())
    if (!profiles.some((p) => p.name === name)) profiles.push({ name, color: freeColor(profiles) });
  return { labels: filled.map((c) => (c === null ? "" : (names.get(c) as string))), profiles };
}

function freeColor(profiles: readonly SpeakerProfile[]): string {
  const used = new Set(profiles.map((p) => p.color.toLowerCase()));
  return SPEAKER_PALETTE.find((c) => !used.has(c.toLowerCase())) ?? paletteColor(profiles.length);
}

/**
 * Names for clusters. A cluster that mostly overlaps cues already labelled
 * "Host" stays "Host" (one-to-one, strongest overlap first), so re-running
 * detection keeps renamed speakers and their look. The rest take the lowest
 * free "Speaker N", in order of first appearance.
 */
function nameClusters(
  filled: ReadonlyArray<number | null>,
  order: readonly number[],
  previous: ReadonlyArray<string | undefined> | undefined,
): Map<number, string> {
  const names = new Map<number, string>();
  const taken = new Set<string>();
  if (previous) {
    const overlap = new Map<string, number>();
    filled.forEach((c, i) => {
      const prev = previous[i];
      if (c !== null && prev) overlap.set(`${c}\u0000${prev}`, (overlap.get(`${c}\u0000${prev}`) ?? 0) + 1);
    });
    const ranked = [...overlap.entries()]
      .map(([key, count]) => ({ cluster: Number(key.split("\u0000")[0]), name: key.split("\u0000")[1], count }))
      .sort((a, b) => b.count - a.count || a.cluster - b.cluster);
    for (const { cluster, name } of ranked) {
      if (names.has(cluster) || taken.has(name)) continue;
      names.set(cluster, name);
      taken.add(name);
    }
  }
  let n = 1;
  for (const i of order) {
    const c = filled[i];
    if (c === null || names.has(c)) continue;
    while (taken.has(defaultSpeakerName(n))) n++;
    names.set(c, defaultSpeakerName(n));
    taken.add(defaultSpeakerName(n));
  }
  return names;
}

export const findSpeakerProfile = (
  profiles: readonly SpeakerProfile[] | undefined,
  name: string | undefined,
): SpeakerProfile | undefined => (name ? profiles?.find((p) => p.name === name) : undefined);

/** Profiles for every speaker used by `subtitles` (keeps existing, appends new from the palette). */
export function ensureSpeakerProfiles(
  subtitles: readonly Subtitle[],
  profiles: readonly SpeakerProfile[] = [],
): SpeakerProfile[] {
  const next = [...profiles];
  for (const cue of subtitles)
    if (cue.speaker && !next.some((p) => p.name === cue.speaker)) next.push({ name: cue.speaker, color: paletteColor(next.length) });
  return next;
}

/** Rename a profile; renaming onto an existing name merges (the target's look wins). */
export function renameSpeakerProfile(profiles: readonly SpeakerProfile[], from: string, to: string): SpeakerProfile[] {
  const name = to.trim();
  const source = profiles.find((p) => p.name === from);
  if (!source) return [...profiles];
  if (!name) return profiles.filter((p) => p.name !== from);
  if (name === from) return [...profiles];
  if (profiles.some((p) => p.name === name)) return profiles.filter((p) => p.name !== from);
  return profiles.map((p) => (p.name === from ? { ...p, name } : p));
}

const BASE_STYLE: SubtitleStyle = {
  fontFamily: "Inter",
  fontSize: 48,
  color: "#ffffff",
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  position: "bottom",
};

/**
 * Bake each speaker's colour and position onto their cues, remembering what
 * the cue looked like first (`speakerBase`). A cue whose speaker was cleared,
 * or whose profile no longer styles captions, gets that look back. Cues that
 * were never speaker-styled are untouched. Idempotent.
 */
export function applySpeakerStyles(subtitles: readonly Subtitle[], profiles: readonly SpeakerProfile[]): Subtitle[] {
  return subtitles.map((cue) => {
    const profile = findSpeakerProfile(profiles, cue.speaker);
    if (!profile || profile.styleCaptions === false) return restoreSpeakerBase(cue);
    const base = cue.style ?? BASE_STYLE;
    const style: SubtitleStyle = { ...base, color: profile.color, ...(profile.position ? { position: profile.position } : {}) };
    if (cue.speakerBase && style.color === base.color && style.position === base.position) return cue;
    const speakerBase = cue.speakerBase ?? {
      hadStyle: Boolean(cue.style),
      color: cue.style?.color,
      position: cue.style?.position,
      ...(cue.cueSettings ? { cueSettings: cue.cueSettings } : {}),
    };
    // A cue-level WebVTT position would override the speaker's.
    const { cueSettings: _cue, ...rest } = cue;
    return { ...rest, style, speakerBase, ...(profile.position ? {} : cue.cueSettings ? { cueSettings: cue.cueSettings } : {}) };
  });
}

function restoreSpeakerBase(cue: Subtitle): Subtitle {
  const base = cue.speakerBase;
  if (!base) return cue;
  const { speakerBase: _b, style, cueSettings, ...rest } = cue;
  const restored: Subtitle = { ...rest, ...(base.cueSettings ?? cueSettings ? { cueSettings: base.cueSettings ?? cueSettings } : {}) };
  if (!base.hadStyle || !style) return restored;
  const next: SubtitleStyle = { ...style, color: base.color ?? BASE_STYLE.color, position: base.position ?? BASE_STYLE.position };
  return { ...restored, style: next };
}

const trackOf = (cue: Subtitle): string => cue.captionTrackId ?? "";
const TWIN_EPSILON = 1e-3;

/**
 * The cues speaker detection should analyse: the visible caption track(s).
 * Hidden translated versions cover the same time ranges, so including them
 * would double the work and skew the speaker count. When every cue is hidden,
 * the first track (in order of appearance) is used.
 */
export function detectionCues(subtitles: readonly Subtitle[]): Subtitle[] {
  const visible = subtitles.filter((cue) => !cue.hidden);
  if (visible.length) return visible;
  if (!subtitles.length) return [];
  const first = trackOf(subtitles[0]);
  return subtitles.filter((cue) => trackOf(cue) === first);
}

/**
 * Copy the speaker of the cues in `sourceIds` onto the cues of other caption
 * tracks with the same start/end (translated versions), so every language of a
 * passage shares one speaker. A cleared speaker is cleared on the twins too.
 */
export function mirrorSpeakersToTranslations(subtitles: readonly Subtitle[], sourceIds: ReadonlySet<string>): Subtitle[] {
  const sources = subtitles.filter((cue) => sourceIds.has(cue.id));
  if (!sources.length) return [...subtitles];
  return subtitles.map((cue) => {
    if (sourceIds.has(cue.id)) return cue;
    const exact = sources.find(
      (s) =>
        trackOf(s) !== trackOf(cue) &&
        Math.abs(s.startTime - cue.startTime) < TWIN_EPSILON &&
        Math.abs(s.endTime - cue.endTime) < TWIN_EPSILON,
    );
    // A translated cue that was split or lengthened (reading speed) no longer has the exact
    // range of its source; a cue with a language whose midpoint lies inside the source belongs to it.
    const mid = (cue.startTime + cue.endTime) / 2;
    const source =
      exact ??
      (cue.language
        ? sources.find((s) => trackOf(s) !== trackOf(cue) && mid >= s.startTime && mid < s.endTime)
        : undefined);
    if (!source || source.speaker === cue.speaker) return cue;
    const { speaker: _old, ...rest } = cue;
    return source.speaker ? { ...rest, speaker: source.speaker } : rest;
  });
}
