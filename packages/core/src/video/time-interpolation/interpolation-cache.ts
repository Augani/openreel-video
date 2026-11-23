/**
 * Byte-budgeted LRU keyed by a string. Entries are evicted oldest-use first once the budget is exceeded
 * (the newest entry always stays, whatever its size). `onEvict` releases GPU/bitmap resources.
 */
export class ByteLruCache<V> {
  private readonly map = new Map<string, { value: V; bytes: number }>();
  private total = 0;
  hits = 0;
  misses = 0;

  constructor(
    private readonly budgetBytes: number,
    private readonly onEvict?: (value: V) => void,
  ) {}

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.total;
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V, bytes: number): void {
    const prior = this.map.get(key);
    if (prior) {
      this.total -= prior.bytes;
      if (prior.value !== value) this.onEvict?.(prior.value);
      this.map.delete(key);
    }
    this.map.set(key, { value, bytes });
    this.total += bytes;
    while (this.total > this.budgetBytes && this.map.size > 1) {
      const oldest = this.map.keys().next().value as string;
      const entry = this.map.get(oldest)!;
      this.map.delete(oldest);
      this.total -= entry.bytes;
      this.onEvict?.(entry.value);
    }
  }

  clear(): void {
    for (const entry of this.map.values()) this.onEvict?.(entry.value);
    this.map.clear();
    this.total = 0;
  }
}
