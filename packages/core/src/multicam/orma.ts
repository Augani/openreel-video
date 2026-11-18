import type { MulticamActivityMap } from "./automatic-edit";
import type { MulticamBleedCalibration } from "./bleed-calibration";
import type { MulticamDriftModel } from "./drift";
import type { MulticamManifest } from "./manifest";
import type { MulticamReactionCue } from "./reaction-analysis";

export const ORMA_SPEC = "openreel-activity/v1" as const;

export interface MulticamTranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
}

interface OrmaMediaFingerprint {
  id: string;
  name: string;
  size: number;
  lastModified: number;
}

export interface OrmaArtifact {
  spec: typeof ORMA_SPEC;
  manifestFingerprint: string;
  mediaFingerprint: string;
  createdAt: number;
  durationMs: number;
  activity: MulticamActivityMap;
  drift: Record<string, MulticamDriftModel>;
  calibration?: MulticamBleedCalibration;
  transcripts?: Record<string, MulticamTranscriptSegment[]>;
  reactions?: MulticamReactionCue[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function fingerprintMulticamManifest(manifest: MulticamManifest): string {
  return `manifest-${fnv1a(JSON.stringify(stableValue(manifest)))}`;
}

function fingerprintMulticamMedia(
  media: readonly OrmaMediaFingerprint[],
): string {
  const normalized = [...media].sort((left, right) => left.id.localeCompare(right.id));
  return `media-${fnv1a(JSON.stringify(stableValue(normalized)))}`;
}

export function createOrmaArtifact(input: {
  manifest: MulticamManifest;
  media: readonly OrmaMediaFingerprint[];
  activity: MulticamActivityMap;
  drift?: Record<string, MulticamDriftModel>;
  calibration?: MulticamBleedCalibration;
  transcripts?: Record<string, MulticamTranscriptSegment[]>;
  reactions?: MulticamReactionCue[];
  createdAt?: number;
}): OrmaArtifact {
  return {
    spec: ORMA_SPEC,
    manifestFingerprint: fingerprintMulticamManifest(input.manifest),
    mediaFingerprint: fingerprintMulticamMedia(input.media),
    createdAt: input.createdAt ?? Date.now(),
    durationMs: Math.round(input.activity.duration * 1_000),
    activity: structuredClone(input.activity),
    drift: structuredClone(input.drift ?? {}),
    calibration: input.calibration
      ? structuredClone(input.calibration)
      : undefined,
    transcripts: input.transcripts
      ? structuredClone(input.transcripts)
      : undefined,
    reactions: input.reactions ? structuredClone(input.reactions) : undefined,
  };
}

export function serializeOrma(artifact: OrmaArtifact): string {
  return JSON.stringify(artifact);
}

export function deserializeOrma(serialized: string): OrmaArtifact {
  const value = JSON.parse(serialized) as Partial<OrmaArtifact>;
  if (
    value.spec !== ORMA_SPEC ||
    typeof value.manifestFingerprint !== "string" ||
    typeof value.mediaFingerprint !== "string" ||
    typeof value.createdAt !== "number" ||
    typeof value.durationMs !== "number" ||
    !value.activity ||
    !Array.isArray(value.activity.points) ||
    !value.drift ||
    typeof value.drift !== "object"
  ) {
    throw new Error("Invalid OpenReel multicam activity artifact");
  }
  return value as OrmaArtifact;
}

export function isOrmaCompatible(
  artifact: OrmaArtifact,
  manifest: MulticamManifest,
  media: readonly OrmaMediaFingerprint[],
): boolean {
  return (
    artifact.spec === ORMA_SPEC &&
    artifact.manifestFingerprint === fingerprintMulticamManifest(manifest) &&
    artifact.mediaFingerprint === fingerprintMulticamMedia(media)
  );
}
