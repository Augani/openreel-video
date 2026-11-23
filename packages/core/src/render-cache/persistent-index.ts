import type { ChunkStore } from "./chunk-store";

/**
 * What survives an app restart: which frames were rendered, how big they are, when they were last used (LRU
 * order) and the content hash of the segment each one was rendered from. Pixels live in the chunk store; this
 * is only bookkeeping, and every claim in it is re-checked against the project and the store on load.
 */
export interface PersistedIndex {
  readonly version: 1;
  readonly projectKey: string;
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly savedAt: number;
  /** Distinct segment hashes; `frames` refer to them by position. */
  readonly hashes: readonly string[];
  /** [frame, bytes, lastUsed, hashIndex] */
  readonly frames: ReadonlyArray<readonly [number, number, number, number]>;
}

export interface IndexStore {
  load(): Promise<unknown>;
  save(index: PersistedIndex): Promise<void>;
  clear?(): Promise<void>;
}

const INDEX_KEY = "__index__";

/** Index kept as one JSON entry next to the frames in the same chunk store (same lifetime, same scratch folder). */
export function createChunkIndexStore(store: ChunkStore, key = INDEX_KEY): IndexStore {
  return {
    async load() {
      const data = await store.get(key);
      if (!data) return undefined;
      try {
        return JSON.parse(new TextDecoder().decode(data));
      } catch {
        return undefined;
      }
    },
    async save(index) {
      const bytes = new TextEncoder().encode(JSON.stringify(index));
      await store.put(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    },
    async clear() {
      await store.delete([key]);
    },
  };
}

export interface IndexEntryInput {
  readonly frame: number;
  readonly bytes: number;
  readonly used: number;
  readonly hash: string;
}

export function serializeIndex(
  header: Pick<PersistedIndex, "projectKey" | "codec" | "width" | "height" | "frameRate">,
  entries: readonly IndexEntryInput[],
  savedAt: number,
): PersistedIndex {
  const hashes: string[] = [];
  const hashIndex = new Map<string, number>();
  const frames: Array<[number, number, number, number]> = [];
  for (const entry of entries) {
    let at = hashIndex.get(entry.hash);
    if (at === undefined) {
      at = hashes.length;
      hashes.push(entry.hash);
      hashIndex.set(entry.hash, at);
    }
    frames.push([entry.frame, entry.bytes, entry.used, at]);
  }
  return { version: 1, ...header, savedAt, hashes, frames };
}

const finiteInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Strict parse: anything malformed (truncated write, hand-edited, future version) is treated as no index. */
export function parseIndex(raw: unknown): PersistedIndex | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) return undefined;
  if (typeof value.projectKey !== "string" || typeof value.codec !== "string") return undefined;
  if (!finiteInt(value.width) || !finiteInt(value.height)) return undefined;
  if (typeof value.frameRate !== "number" || !(value.frameRate > 0)) return undefined;
  if (!Array.isArray(value.hashes) || !value.hashes.every((h) => typeof h === "string")) return undefined;
  if (!Array.isArray(value.frames)) return undefined;
  const hashCount = value.hashes.length;
  for (const row of value.frames) {
    if (!Array.isArray(row) || row.length !== 4) return undefined;
    if (!finiteInt(row[0]) || !finiteInt(row[1]) || !finiteInt(row[2]) || !finiteInt(row[3]) || row[3] >= hashCount) {
      return undefined;
    }
  }
  return value as unknown as PersistedIndex;
}
