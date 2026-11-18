import { brotliDecompress } from "node:zlib";
import { promisify } from "node:util";
import { z } from "zod";
import { handle } from "./index";
import { CHANNELS } from "../../shared/channels";

/**
 * Brotli for the renderer's WOFF2 licence check (project-package font embedding).
 * Electron's Chromium has no `DecompressionStream("brotli")`, so the renderer asks
 * main, which has Node's zlib. Only a font's table stream is ever sent.
 */

const brotliDecompressAsync = promisify(brotliDecompress);

/** A font's table stream never legitimately exceeds this; it bounds a decompression bomb. */
const MAX_FONT_BYTES = 64 * 1024 * 1024;

/** Decompress a Brotli stream; null when the data is not valid Brotli or expands past the cap. */
export async function brotliDecompressBounded(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const out = await brotliDecompressAsync(data, { maxOutputLength: MAX_FONT_BYTES });
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  } catch {
    return null;
  }
}

export function registerFontsIpc(): void {
  handle(
    CHANNELS.fontsBrotliDecompress,
    z.object({ data: z.instanceof(Uint8Array).refine((d) => d.byteLength <= MAX_FONT_BYTES) }),
    (args) => brotliDecompressBounded(args.data),
  );
}
