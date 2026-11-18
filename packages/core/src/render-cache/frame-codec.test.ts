import { afterEach, describe, expect, it, vi } from "vitest";
import { WebCodecsIntraCodec } from "./frame-codec";

type Output = (chunk: { timestamp: number; byteLength: number; copyTo(target: ArrayBuffer): void }) => void;

/** Encoder that skips the frames whose 1-based call number matches `skip` (software rate control). */
function stubWebCodecs(skip: (call: number) => boolean) {
  let calls = 0;
  class FakeEncoder {
    state = "unconfigured";
    private queue: number[] = [];
    constructor(private readonly init: { output: Output }) {}
    static async isConfigSupported() {
      return { supported: true };
    }
    configure() {
      this.state = "configured";
    }
    encode(frame: { timestamp: number }) {
      calls++;
      if (!skip(calls)) this.queue.push(frame.timestamp);
    }
    async flush() {
      for (const timestamp of this.queue.splice(0)) {
        this.init.output({ timestamp, byteLength: 4, copyTo: () => undefined });
      }
    }
    close() {
      this.state = "closed";
    }
  }
  class FakeDecoder {
    static async isConfigSupported() {
      return { supported: true };
    }
  }
  vi.stubGlobal("VideoEncoder", FakeEncoder);
  vi.stubGlobal("VideoDecoder", FakeDecoder);
  vi.stubGlobal(
    "VideoFrame",
    class {
      constructor(
        _image: unknown,
        readonly init: { timestamp: number },
      ) {}
      get timestamp() {
        return this.init.timestamp;
      }
      close() {}
    },
  );
  return { calls: () => calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebCodecsIntraCodec encode", () => {
  it("re-encodes a frame the encoder silently skipped instead of hanging", async () => {
    const stub = stubWebCodecs((call) => call === 1);
    const codec = await WebCodecsIntraCodec.create({ width: 8, height: 8, frameRate: 30 });
    expect(codec).not.toBeNull();
    const out = await codec!.encode({} as ImageBitmap);
    expect(out.data.byteLength).toBe(4);
    expect(stub.calls()).toBe(2);
  });

  it("rejects when every attempt is skipped", async () => {
    stubWebCodecs(() => true);
    const codec = await WebCodecsIntraCodec.create({ width: 8, height: 8, frameRate: 30 });
    await expect(codec!.encode({} as ImageBitmap)).rejects.toThrow(/dropped/);
  });
});
