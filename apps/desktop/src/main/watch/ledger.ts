import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Remembers which files a watch folder has already handled, so a restart, a re-drop of the same
 * file or a copy under another name is recognised as a duplicate. The fingerprint is the size plus a
 * hash of the first and last 256 KiB (cheap even for multi-GB camera files, and a changed file
 * almost always changes one of them).
 */

const SAMPLE_BYTES = 256 * 1024;
const MAX_ENTRIES_PER_FOLDER = 5000;

export async function fingerprintFile(file: string): Promise<string> {
  const handle = await fs.promises.open(file, "r");
  try {
    const { size } = await handle.stat();
    const hash = createHash("sha1");
    hash.update(String(size));
    const head = Buffer.alloc(Math.min(SAMPLE_BYTES, size));
    await handle.read(head, 0, head.length, 0);
    hash.update(head);
    if (size > SAMPLE_BYTES) {
      const tail = Buffer.alloc(Math.min(SAMPLE_BYTES, size - SAMPLE_BYTES));
      await handle.read(tail, 0, tail.length, size - tail.length);
      hash.update(tail);
    }
    return `${size}-${hash.digest("hex").slice(0, 20)}`;
  } finally {
    await handle.close();
  }
}

export interface LedgerEntry {
  /** Original file name when it was handled. */
  name: string;
  at: number;
  outcome: "imported" | "rendered" | "baseline";
}

type LedgerData = Record<string, Record<string, LedgerEntry>>;

export interface LedgerStore {
  load(): LedgerData;
  save(data: LedgerData): void;
}

export function createFileLedgerStore(file: string): LedgerStore {
  return {
    load() {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { version?: number; folders?: LedgerData };
        return parsed.version === 1 && parsed.folders && typeof parsed.folders === "object" ? parsed.folders : {};
      } catch {
        return {};
      }
    },
    save(data) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ version: 1, folders: data }));
        fs.renameSync(tmp, file);
      } catch {
        // A read-only profile only loses duplicate detection across restarts.
      }
    },
  };
}

export class Ledger {
  private data: LedgerData;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly store: LedgerStore) {
    this.data = store.load();
  }

  has(folderId: string, fingerprint: string): LedgerEntry | undefined {
    return this.data[folderId]?.[fingerprint];
  }

  record(folderId: string, fingerprint: string, entry: LedgerEntry): void {
    const folder = (this.data[folderId] ??= {});
    folder[fingerprint] = entry;
    const keys = Object.keys(folder);
    if (keys.length > MAX_ENTRIES_PER_FOLDER) {
      keys.sort((a, b) => folder[a].at - folder[b].at);
      for (const key of keys.slice(0, keys.length - MAX_ENTRIES_PER_FOLDER)) delete folder[key];
    }
    this.saveSoon();
  }

  dropFolder(folderId: string): void {
    delete this.data[folderId];
    this.saveSoon();
  }

  private saveSoon(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.store.save(this.data);
    }, 200);
    this.timer.unref?.();
  }

  /** Writes now (quit, tests). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.store.save(this.data);
  }
}
