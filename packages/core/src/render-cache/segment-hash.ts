import type { PixelModel } from "./pixel-entities";
import type { TimeRange } from "./time-ranges";

/**
 * Bump when a compositor change alters rendered pixels for an unchanged project, so render files written
 * by an older build are never trusted after an update.
 * 5: export decodes both sides of a transition one after the other (a same-file jump cut could get the wrong side).
 */
export const RENDER_PIXEL_VERSION = 5;

/** Two independent 53-bit cyrb53 passes: 106 bits, 27 hex chars. Not cryptographic; collisions are accidental-only. */
export function hashString(input: string): string {
  let h1a = 0xdeadbeef;
  let h2a = 0x41c6ce57;
  let h1b = 0x9e3779b9;
  let h2b = 0x85ebca6b;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1a = Math.imul(h1a ^ ch, 2654435761);
    h2a = Math.imul(h2a ^ ch, 1597334677);
    h1b = Math.imul(h1b ^ ch, 3266489917);
    h2b = Math.imul(h2b ^ ch, 668265263);
  }
  h1a = Math.imul(h1a ^ (h1a >>> 16), 2246822507) ^ Math.imul(h2a ^ (h2a >>> 13), 3266489909);
  h2a = Math.imul(h2a ^ (h2a >>> 16), 2246822507) ^ Math.imul(h1a ^ (h1a >>> 13), 3266489909);
  h1b = Math.imul(h1b ^ (h1b >>> 15), 2246822507) ^ Math.imul(h2b ^ (h2b >>> 12), 3266489909);
  h2b = Math.imul(h2b ^ (h2b >>> 15), 2246822507) ^ Math.imul(h1b ^ (h1b >>> 12), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const high = (4294967296 * (2097151 & h2a) + (h1a >>> 0)).toString(16).padStart(14, "0");
  return `${high}${hex(h1b)}${hex(h2b)}`.slice(0, 27);
}

interface HashedEntity {
  readonly key: string;
  readonly digest: string;
  readonly spans: readonly TimeRange[];
}

export interface SegmentHasher {
  /** Content hash of everything that can change the pixels of `frame` (global settings + every entity active in it). */
  hashAt(frame: number): string;
  /** Number of entities active at `frame` (diagnostics and tests). */
  activeCount(frame: number): number;
}

/**
 * Content hash per segment of the timeline. A segment is a stretch of frames with the same set of active
 * entities (clips, transitions, effects with their keyframes, adjustment layers, text/graphics, masks) and so
 * the same inputs; its hash covers those entities' pixel fingerprints plus the sequence-wide settings.
 * Frame activity uses the compositor's own `frame / fps >= start && < end` comparison, so a frame hashes as
 * changed if and only if the live invalidation diff would have dropped it.
 */
export function createSegmentHasher(model: PixelModel, frameRate: number): SegmentHasher {
  const global = hashString(`${RENDER_PIXEL_VERSION}|${model.globalFingerprint}`);
  const entities: HashedEntity[] = [];
  for (const entity of model.entities.values()) {
    if (entity.spans.length === 0) continue;
    entities.push({
      key: entity.key,
      digest: hashString(`${entity.fingerprint}@${entity.spans.map((s) => `${s.start}-${s.end}`).join(",")}`),
      spans: entity.spans,
    });
  }
  entities.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const active = (frame: number): HashedEntity[] => {
    const time = frame / frameRate;
    return entities.filter((entity) => entity.spans.some((s) => time >= s.start && time < s.end));
  };
  let lastFrame = Number.NaN;
  let lastHash = "";
  return {
    hashAt(frame) {
      if (frame === lastFrame) return lastHash;
      const list = active(frame);
      lastFrame = frame;
      lastHash = hashString(`${global}|${list.map((e) => `${e.key}=${e.digest}`).join(";")}`);
      return lastHash;
    },
    activeCount(frame) {
      return active(frame).length;
    },
  };
}
