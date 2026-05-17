import type { FlowField } from "./types";

interface CacheEntry {
  flowField: FlowField;
  lastAccessed: number;
}

export class FlowFieldCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxEntries: number;

  constructor(maxEntries: number = 10) {
    this.maxEntries = maxEntries;
  }

  static makeKey(mediaId: string, timeBefore: number, timeAfter: number): string {
    return `${mediaId}:${timeBefore.toFixed(4)}:${timeAfter.toFixed(4)}`;
  }

  get(key: string): FlowField | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    entry.lastAccessed = performance.now();
    return entry.flowField;
  }

  set(key: string, flowField: FlowField): void {
    if (this.cache.size >= this.maxEntries) {
      this.evictLRU();
    }
    this.cache.set(key, { flowField, lastAccessed: performance.now() });
  }

  private evictLRU(): void {
    let oldestKey = "";
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
