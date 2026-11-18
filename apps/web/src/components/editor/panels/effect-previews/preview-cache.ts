/**
 * Least-recently-used cache bounded by total cost (bytes), not entry count:
 * rendered preview frames are ImageBitmaps whose memory is width * height * 4.
 * `onEvict` releases the entry (ImageBitmap.close()).
 */
export class CostLruCache<K, V> {
  private readonly entries = new Map<K, { value: V; cost: number }>();
  private total = 0;

  constructor(
    private readonly maxCost: number,
    private readonly onEvict?: (value: V, key: K) => void,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get cost(): number {
    return this.total;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  /** Marks the entry most recently used. */
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /** Reads without touching recency. */
  peek(key: K): V | undefined {
    return this.entries.get(key)?.value;
  }

  set(key: K, value: V, cost: number): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.total -= existing.cost;
      this.entries.delete(key);
      if (existing.value !== value) this.onEvict?.(existing.value, key);
    }
    this.entries.set(key, { value, cost });
    this.total += cost;
    while (this.total > this.maxCost && this.entries.size > 1) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.total -= entry.cost;
    this.onEvict?.(entry.value, key);
    return true;
  }

  clear(): void {
    for (const [key, entry] of this.entries) this.onEvict?.(entry.value, key);
    this.entries.clear();
    this.total = 0;
  }
}
