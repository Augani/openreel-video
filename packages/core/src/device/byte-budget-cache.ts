/**
 * LRU cache budgeted in BYTES, not entries. Decoded media is wildly uneven (a 4K RGBA frame is 33 MB,
 * a thumbnail 40 KB, a ten-minute stereo AudioBuffer 230 MB), so an entry-count cap either wastes the
 * budget on small items or lets a few large ones blow through it.
 *
 * - `sizeOf` measures an entry once, when it is stored.
 * - Entries over the budget by themselves are disposed immediately and never stored, unless `isPinned`
 *   claims them (then the cache is over budget until they are unpinned and the next trim).
 * - Eviction walks least-recently-used first and skips `isPinned` entries (e.g. the audio buffer of
 *   the clip being played). If everything left is pinned the cache stays over budget rather than
 *   pulling a buffer out from under playback; the next unpinned insert or `setBudget` trims it.
 * - Every entry that leaves the cache (evicted, replaced, deleted, cleared) goes through `dispose`,
 *   which is where VideoFrame / ImageBitmap `close()` belongs, so frames are released deterministically.
 */
export interface ByteBudgetCacheOptions<K, V> {
  sizeOf: (value: V) => number;
  dispose?: (value: V, key: K, reason: "evicted" | "replaced" | "deleted" | "cleared" | "rejected") => void;
  isPinned?: (key: K, value: V) => boolean;
}

export class ByteBudgetCache<K, V> {
  private readonly entries = new Map<K, { value: V; bytes: number }>();
  private bytes = 0;
  private budget: number;

  constructor(
    maxBytes: number,
    private readonly options: ByteBudgetCacheOptions<K, V>,
  ) {
    this.budget = Math.max(0, maxBytes);
  }

  get size(): number {
    return this.entries.size;
  }

  get byteLength(): number {
    return this.bytes;
  }

  get maxBytes(): number {
    return this.budget;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  /** Returns the value without touching its recency. */
  peek(key: K): V | undefined {
    return this.entries.get(key)?.value;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Map iterates in insertion order: re-inserting marks it most recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  keys(): IterableIterator<K> {
    return this.entries.keys();
  }

  /**
   * Stores `value`, taking ownership of it. Returns false when it was larger than the whole budget
   * and was disposed instead.
   */
  set(key: K, value: V): boolean {
    const bytes = Math.max(0, this.options.sizeOf(value));
    const existing = this.entries.get(key);
    if (existing && existing.value === value) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return true;
    }
    // An entry bigger than the whole budget is normally rejected, but a pinned one (the audio of the
    // clip being played) must be admitted: rejecting it makes the caller re-decode it forever.
    if (bytes > this.budget && !this.options.isPinned?.(key, value)) {
      this.options.dispose?.(value, key, "rejected");
      return false;
    }
    if (existing) {
      this.entries.delete(key);
      this.bytes -= existing.bytes;
      this.options.dispose?.(existing.value, key, "replaced");
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    this.trim(key);
    return true;
  }

  delete(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    this.options.dispose?.(entry.value, key, "deleted");
    return true;
  }

  /** Changes the budget (e.g. when the device probe lands) and evicts immediately if it shrank. */
  setBudget(maxBytes: number): void {
    this.budget = Math.max(0, maxBytes);
    this.trim();
  }

  clear(): void {
    const all = [...this.entries];
    this.entries.clear();
    this.bytes = 0;
    for (const [key, entry] of all) this.options.dispose?.(entry.value, key, "cleared");
  }

  /** Evicts least-recently-used unpinned entries until the cache fits; `keep` is never the victim. */
  private trim(keep?: K): void {
    if (this.bytes <= this.budget) return;
    for (const [key, entry] of [...this.entries]) {
      if (this.bytes <= this.budget) break;
      if (key === keep) continue;
      if (this.options.isPinned?.(key, entry.value)) continue;
      this.entries.delete(key);
      this.bytes -= entry.bytes;
      this.options.dispose?.(entry.value, key, "evicted");
    }
  }
}
