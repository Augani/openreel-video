/** An in-memory FileSystemWritableFileStream for exports that end up in a Blob. */
function toUint8(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  throw new Error("Unsupported chunk type written to export stream");
}

export interface MemoryWritable {
  readonly writable: FileSystemWritableFileStream;
  getBlob(type: string): Blob;
}

export function createMemoryWritable(): MemoryWritable {
  const parts: Array<{ pos: number; data: Uint8Array }> = [];
  let position = 0;
  let size = 0;

  const writeChunk = (u8: Uint8Array): void => {
    parts.push({ pos: position, data: u8 });
    position += u8.byteLength;
    if (position > size) size = position;
  };

  const sink = {
    async seek(pos: number): Promise<void> {
      position = pos;
    },
    async truncate(next: number): Promise<void> {
      size = next;
    },
    async close(): Promise<void> {},
    async abort(): Promise<void> {},
    async write(chunk: unknown): Promise<void> {
      if (chunk && typeof chunk === "object" && "type" in chunk) {
        const cmd = chunk as { type: string; data?: unknown; position?: number; size?: number };
        if (cmd.type === "seek") {
          if (typeof cmd.position === "number") position = cmd.position;
          return;
        }
        if (cmd.type === "truncate") {
          if (typeof cmd.size === "number") size = cmd.size;
          return;
        }
        if (cmd.type === "write") {
          if (typeof cmd.position === "number") position = cmd.position;
          writeChunk(toUint8(cmd.data));
          return;
        }
      }
      writeChunk(toUint8(chunk));
    },
  };

  return {
    writable: sink as unknown as FileSystemWritableFileStream,
    getBlob(type: string): Blob {
      const buffer = new Uint8Array(size);
      for (const part of parts) buffer.set(part.data, part.pos);
      return new Blob([buffer], { type });
    },
  };
}

