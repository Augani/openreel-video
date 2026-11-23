/**
 * Wire protocol between the editor's main process and the out-of-process plugin helper (openreel-plughost).
 *
 * The helper hosts third-party plugin code, so it can crash or hang at any time: nothing it says is trusted, every request
 * has a timeout, and a frame that does not parse ends the session. Transport is the helper's stdin/stdout (a pipe):
 *
 *   frame := magic u32 LE ("ORPH" = 0x4850524F) | jsonLength u32 LE | binaryLength u32 LE | json | binary
 *
 * The JSON part is a message with a `type`; requests carry a `reqId` the helper echoes. The binary part carries audio:
 * planar float32 (channel 0's frames, then channel 1's, ...). Audio blocks are small (512 frames), so a long clip is a long
 * sequence of request/response pairs; nothing larger than one block plus its parameters is ever in flight.
 */

export const PLUGHOST_PROTOCOL_VERSION = 1;
export const FRAME_MAGIC = 0x4850524f;
export const FRAME_HEADER_BYTES = 12;
export const MAX_JSON_BYTES = 4 * 1024 * 1024;
export const MAX_BINARY_BYTES = 256 * 1024 * 1024;

export interface Frame<T = Record<string, unknown>> {
  readonly json: T;
  readonly binary: Uint8Array;
}

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameError";
  }
}

export function encodeFrame(json: Record<string, unknown>, binary: Uint8Array = new Uint8Array(0)): Buffer {
  const body = Buffer.from(JSON.stringify(json), "utf8");
  if (body.length > MAX_JSON_BYTES) throw new FrameError(`json part is ${body.length} bytes (limit ${MAX_JSON_BYTES})`);
  if (binary.byteLength > MAX_BINARY_BYTES) throw new FrameError(`binary part is ${binary.byteLength} bytes (limit ${MAX_BINARY_BYTES})`);
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.writeUInt32LE(FRAME_MAGIC, 0);
  header.writeUInt32LE(body.length, 4);
  header.writeUInt32LE(binary.byteLength, 8);
  return Buffer.concat([header, body, Buffer.from(binary.buffer, binary.byteOffset, binary.byteLength)]);
}

/** Incremental decoder: feed it chunks as they arrive from the pipe, it returns every complete frame. Throws {@link FrameError} on desync. */
export class FrameDecoder {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): Frame[] {
    this.pending = this.pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.pending, chunk]);
    const frames: Frame[] = [];
    for (;;) {
      if (this.pending.length < FRAME_HEADER_BYTES) break;
      const magic = this.pending.readUInt32LE(0);
      if (magic !== FRAME_MAGIC) throw new FrameError(`bad frame magic 0x${magic.toString(16)}`);
      const jsonLength = this.pending.readUInt32LE(4);
      const binaryLength = this.pending.readUInt32LE(8);
      if (jsonLength > MAX_JSON_BYTES || binaryLength > MAX_BINARY_BYTES) throw new FrameError(`frame too large (${jsonLength} + ${binaryLength} bytes)`);
      const total = FRAME_HEADER_BYTES + jsonLength + binaryLength;
      if (this.pending.length < total) break;
      let json: unknown;
      try {
        json = JSON.parse(this.pending.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + jsonLength).toString("utf8"));
      } catch {
        throw new FrameError("frame json is not valid");
      }
      if (!json || typeof json !== "object" || Array.isArray(json)) throw new FrameError("frame json is not an object");
      const binary = new Uint8Array(binaryLength);
      binary.set(this.pending.subarray(FRAME_HEADER_BYTES + jsonLength, total));
      frames.push({ json: json as Record<string, unknown>, binary });
      this.pending = this.pending.subarray(total);
    }
    return frames;
  }

  /** Bytes received but not yet part of a complete frame. */
  get buffered(): number {
    return this.pending.length;
  }
}

export const toFloat32 = (bytes: Uint8Array): Float32Array => {
  if (bytes.byteLength % 4 !== 0) throw new FrameError("audio payload is not a whole number of float32 samples");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
};

export const fromFloat32 = (samples: Float32Array): Uint8Array => new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);

/** Pluggable-format ids are "<format>:<...>", for example "au:aufx:dely:appl". */
export function isValidPluginId(id: unknown): id is string {
  return typeof id === "string" && /^(au:[\x20-\x7e]{4}:[\x20-\x7e]{4}:[\x20-\x7e]{4}|vst3:[0-9A-Fa-f]{32})$/.test(id);
}
