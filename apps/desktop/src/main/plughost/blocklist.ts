import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Plugins that crashed or hung the helper during a scan or a render. They are not probed again, not offered in the
 * plugin list and not loaded for rendering until the user unblocks them (a plugin update or a fixed install is the usual reason).
 */

export type BlockKind = "crash" | "timeout" | "invalid" | "manual";

export interface BlocklistEntry {
  readonly id: string;
  readonly kind: BlockKind;
  readonly reason: string;
  readonly at: number;
  /** How many times the plugin has been blocked (a plugin that keeps coming back is a plugin that keeps failing). */
  readonly count: number;
  /** The plugin version when it was blocked: a different version is given a fresh chance. */
  readonly version?: string;
}

interface Stored {
  version: 1;
  entries: Record<string, BlocklistEntry>;
}

export class PluginBlocklist {
  private entries = new Map<string, BlocklistEntry>();
  private loaded = false;

  constructor(private readonly file: string, private readonly now: () => number = Date.now) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<Stored>;
      if (parsed.version === 1 && parsed.entries && typeof parsed.entries === "object") {
        for (const [id, entry] of Object.entries(parsed.entries)) {
          if (entry && typeof entry.reason === "string" && ["crash", "timeout", "invalid", "manual"].includes(entry.kind)) this.entries.set(id, { ...entry, id });
        }
      }
    } catch {
      /* no file yet, or a corrupt one: start empty rather than refusing to scan */
    }
  }

  /** Saves are serialized: the scan runs two probes at once, and two plugins that crash together must not race on the temp file. */
  private saving: Promise<void> = Promise.resolve();

  private save(): Promise<void> {
    const run = async (): Promise<void> => {
      const stored: Stored = { version: 1, entries: Object.fromEntries(this.entries) };
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(stored, null, 2), "utf8");
      await fs.rename(tmp, this.file);
    };
    const next = this.saving.then(run, run);
    this.saving = next.catch(() => undefined);
    return next;
  }

  /** The block that applies to this plugin (a block recorded for another version does not). */
  get(id: string, version?: string): BlocklistEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.version && version && entry.version !== version) return undefined;
    return entry;
  }

  has(id: string, version?: string): boolean {
    return this.get(id, version) !== undefined;
  }

  list(): BlocklistEntry[] {
    return [...this.entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async add(id: string, kind: BlockKind, reason: string, version?: string): Promise<BlocklistEntry> {
    await this.load();
    const previous = this.entries.get(id);
    const entry: BlocklistEntry = { id, kind, reason, at: this.now(), count: (previous?.count ?? 0) + 1, ...(version ? { version } : {}) };
    this.entries.set(id, entry);
    await this.save();
    return entry;
  }

  async remove(id: string): Promise<boolean> {
    await this.load();
    const removed = this.entries.delete(id);
    if (removed) await this.save();
    return removed;
  }
}
