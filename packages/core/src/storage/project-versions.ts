import type { Project } from "../types/project";

/**
 * Project versions: named manual snapshots and automatic ones. The record and
 * retention policy are pure and storage-agnostic; the web app persists records
 * in IndexedDB and, on desktop, in a sidecar file next to the project.
 */

export type VersionKind = "manual" | "auto";

/** What the Versions panel previews without parsing the snapshot. */
export interface VersionSummary {
  readonly duration: number;
  readonly tracks: number;
  readonly clips: number;
  readonly sequences: number;
  readonly markers: number;
  readonly comments: number;
  readonly openComments: number;
  readonly mediaItems: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
}

export interface ProjectVersionRecord {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  /** User-given name for manual versions; empty for automatic ones. */
  readonly name: string;
  readonly kind: VersionKind;
  readonly createdAt: number;
  /** Size of `data` in bytes (UTF-8). */
  readonly bytes: number;
  readonly summary: VersionSummary;
  /** Serialized project (JSON with media blobs removed). */
  readonly data: string;
}

export type ProjectVersionMeta = Omit<ProjectVersionRecord, "data">;

export interface VersionPolicy {
  /** Keep at most this many automatic versions per project. */
  readonly maxAuto: number;
  /** Keep at most this many manual versions per project. */
  readonly maxManual: number;
  /** Total byte budget per project across both kinds. */
  readonly maxBytes: number;
  /** Take an automatic version at most this often (ms). */
  readonly autoIntervalMs: number;
}

export const DEFAULT_VERSION_POLICY: VersionPolicy = {
  maxAuto: 20,
  maxManual: 50,
  maxBytes: 64 * 1024 * 1024,
  autoIntervalMs: 10 * 60 * 1000,
};

export function summarizeProject(project: Project): VersionSummary {
  const tracks = project.timeline.tracks;
  const markers = project.timeline.markers ?? [];
  const comments = markers.filter((m) => m.author !== undefined || m.status !== undefined);
  return {
    duration: project.timeline.duration,
    tracks: tracks.length,
    clips: tracks.reduce((sum, track) => sum + track.clips.length, 0),
    sequences: project.sequences?.length ?? 1,
    markers: markers.length,
    comments: comments.length,
    openComments: comments.filter((m) => m.status !== "resolved").length,
    mediaItems: project.mediaLibrary.items.length,
    width: project.settings.width,
    height: project.settings.height,
    frameRate: project.settings.frameRate,
  };
}

export const byteLength = (text: string): number =>
  typeof TextEncoder !== "undefined" ? new TextEncoder().encode(text).length : text.length;

export function createVersionRecord(input: {
  id: string;
  project: Project;
  data: string;
  kind: VersionKind;
  name?: string;
  now?: number;
}): ProjectVersionRecord {
  return {
    id: input.id,
    projectId: input.project.id,
    projectName: input.project.name,
    name: (input.name ?? "").trim(),
    kind: input.kind,
    createdAt: input.now ?? Date.now(),
    bytes: byteLength(input.data),
    summary: summarizeProject(input.project),
    data: input.data,
  };
}

export const versionMeta = ({ data: _data, ...meta }: ProjectVersionRecord): ProjectVersionMeta => {
  void _data;
  return meta;
};

/** Display name: the manual name, or "Auto-save" for an automatic version. */
export const versionLabel = (v: Pick<ProjectVersionMeta, "name" | "kind">): string =>
  v.name || (v.kind === "auto" ? "Auto-save" : "Untitled version");

/**
 * Ids to delete so `records` (one project's versions) fit the policy. Oldest
 * automatic versions go first; manual versions are only dropped when over the
 * manual cap or when the byte budget cannot be met by automatic ones alone.
 * The newest record is never dropped.
 */
export function versionsToPrune(records: readonly ProjectVersionMeta[], policy: VersionPolicy = DEFAULT_VERSION_POLICY): string[] {
  const oldestFirst = [...records].sort((a, b) => a.createdAt - b.createdAt);
  const newest = oldestFirst[oldestFirst.length - 1];
  const drop = new Set<string>();
  const live = () => oldestFirst.filter((r) => !drop.has(r.id));

  const cap = (kind: VersionKind, max: number) => {
    const ofKind = live().filter((r) => r.kind === kind);
    for (const r of ofKind.slice(0, Math.max(0, ofKind.length - Math.max(0, max)))) {
      if (r !== newest) drop.add(r.id);
    }
  };
  cap("auto", policy.maxAuto);
  cap("manual", policy.maxManual);

  const total = () => live().reduce((sum, r) => sum + r.bytes, 0);
  for (const kind of ["auto", "manual"] as const) {
    for (const r of live().filter((x) => x.kind === kind)) {
      if (total() <= policy.maxBytes) break;
      if (r !== newest) drop.add(r.id);
    }
  }
  return [...drop];
}

export interface AutoSnapshotState {
  readonly lastAutoAt: number | null;
  /** Snapshot of the project the last version (of any kind) was taken from. */
  readonly lastData: string | null;
}

/** Whether an automatic version is due: the interval has passed and the project changed since the last version. */
export function autoSnapshotDue(state: AutoSnapshotState, data: string, now: number, policy: VersionPolicy = DEFAULT_VERSION_POLICY): boolean {
  if (state.lastData !== null && state.lastData === data) return false;
  if (state.lastAutoAt === null) return true;
  return now - state.lastAutoAt >= policy.autoIntervalMs;
}
