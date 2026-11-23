import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  applyXmpFields,
  parseXmp,
  readEmbeddedXmpPacket,
  serializeXmp,
  sidecarXmpName,
  xmpFieldsFromPackets,
  type XmpByteReader,
  type XmpFields,
} from "../../../../../packages/core/src/media/xmp";

/** Reading embedded / sidecar XMP of a file on disk and writing sidecars. The media file itself is never opened for writing. */

async function fileReader(file: string): Promise<{ reader: XmpByteReader; close(): Promise<void> }> {
  const handle = await fs.open(file, "r");
  const stat = await handle.stat();
  return {
    reader: {
      size: stat.size,
      async read(offset, length): Promise<Uint8Array> {
        const size = Math.max(0, Math.min(length, stat.size - offset));
        const buffer = Buffer.alloc(size);
        const { bytesRead } = await handle.read(buffer, 0, size, offset);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
      },
    },
    close: () => handle.close(),
  };
}

export function sidecarPathFor(mediaPath: string): string {
  return path.join(path.dirname(mediaPath), sidecarXmpName(path.basename(mediaPath)));
}

export interface XmpReadResult {
  fields: XmpFields;
  source: "embedded" | "sidecar";
  sidecarPath?: string;
}

export async function readXmpOfFile(mediaPath: string): Promise<XmpReadResult | null> {
  let embedded: string | null = null;
  try {
    const { reader, close } = await fileReader(mediaPath);
    try {
      embedded = await readEmbeddedXmpPacket(path.basename(mediaPath), reader);
    } finally {
      await close();
    }
  } catch {
    embedded = null;
  }
  const sidecarPath = sidecarPathFor(mediaPath);
  const sidecar = await fs.readFile(sidecarPath, "utf8").catch(() => null);
  const fields = xmpFieldsFromPackets(embedded, sidecar);
  if (!fields || Object.keys(fields).length === 0) return null;
  return { fields, source: sidecar && parseXmp(sidecar) ? "sidecar" : "embedded", ...(sidecar ? { sidecarPath } : {}) };
}

/**
 * Write (or update) `<media name>.xmp` next to the media. An existing sidecar keeps every property this
 * app does not edit. The write goes through a temp file and a rename, so a crash leaves the old sidecar.
 */
export async function writeSidecarFor(mediaPath: string, fields: XmpFields): Promise<string> {
  const stat = await fs.stat(mediaPath).catch(() => null);
  if (!stat?.isFile()) throw new Error("The media file is not on disk, so there is nowhere to put the sidecar.");
  const sidecarPath = sidecarPathFor(mediaPath);
  const existing = await fs.readFile(sidecarPath, "utf8").catch(() => null);
  const next = serializeXmp(applyXmpFields(existing ? parseXmp(existing) : null, fields));
  const tmp = `${sidecarPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, next, "utf8");
    await fs.rename(tmp, sidecarPath);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw new Error(`The sidecar could not be written next to the media${error instanceof Error ? `: ${error.message}` : "."}`);
  }
  return sidecarPath;
}
