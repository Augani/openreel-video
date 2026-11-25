import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deviceHolder: { device: unknown } = { device: null };
vi.mock("./gpu-grade-chain", () => ({ getSharedGpuDevice: async () => deviceHolder.device }));

import { GpuFrameReader, buildI420Wgsl, i420Layout, paddedRowBytes, unpackI420, unpadRows } from "./gpu-frame-readback";

/** A device whose "GPU" copies a row-padded gradient into the destination buffer, with a controllable map delay. */
function fakeDevice(width: number, height: number, mapDelayMs = 0, maxBufferSize = 1 << 30) {
  const stride = paddedRowBytes(width);
  let frameNo = 0;
  const copies: number[] = [];
  const buffers: Array<{ destroyed: boolean; mapped: boolean }> = [];
  const device = {
    limits: { maxTextureDimension2D: 8192, maxBufferSize },
    createTexture: () => ({ destroy: vi.fn() }),
    createBuffer: ({ size }: { size: number }) => {
      const state = { destroyed: false, mapped: false };
      buffers.push(state);
      const data = new Uint8Array(size);
      return {
        data,
        mapAsync: async () => {
          await new Promise((resolve) => setTimeout(resolve, mapDelayMs));
          state.mapped = true;
        },
        getMappedRange: () => data.buffer,
        unmap: () => { state.mapped = false; },
        destroy: () => { state.destroyed = true; },
      };
    },
    queue: {
      copyExternalImageToTexture: () => { frameNo++; },
      submit: vi.fn(),
    },
    createCommandEncoder: () => {
      const stamp = frameNo;
      return {
        copyTextureToBuffer: (_src: unknown, dst: { buffer: { data: Uint8Array } }) => {
          copies.push(stamp);
          for (let y = 0; y < height; y++) for (let x = 0; x < width * 4; x++) dst.buffer.data[y * stride + x] = (stamp * 31 + y * 7 + x) & 255;
          // Padding bytes are garbage the reader must drop.
          for (let y = 0; y < height; y++) for (let x = width * 4; x < stride; x++) dst.buffer.data[y * stride + x] = 0xee;
        },
        finish: () => ({}),
      };
    },
  };
  return { device, copies, buffers };
}

const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;
const expected = (stamp: number, width: number, height: number) => {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 4; x++) out[y * width * 4 + x] = (stamp * 31 + y * 7 + x) & 255;
  return out;
};

beforeEach(() => {
  vi.stubGlobal("GPUTextureUsage", { COPY_SRC: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
  vi.stubGlobal("GPUBufferUsage", { COPY_DST: 1, MAP_READ: 2 });
  vi.stubGlobal("GPUMapMode", { READ: 1 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  deviceHolder.device = null;
});

describe("row padding", () => {
  it("pads rows to 256 bytes and leaves aligned widths alone", () => {
    expect(paddedRowBytes(64)).toBe(256);
    expect(paddedRowBytes(1920)).toBe(7680);
    expect(paddedRowBytes(3840)).toBe(15360);
    expect(paddedRowBytes(30)).toBe(256);
    expect(paddedRowBytes(65)).toBe(512);
  });

  it("drops the padding bytes of every row", () => {
    const width = 30;
    const height = 3;
    const stride = paddedRowBytes(width);
    const mapped = new Uint8Array(stride * height).fill(0xee);
    for (let y = 0; y < height; y++) for (let x = 0; x < width * 4; x++) mapped[y * stride + x] = y * 10 + (x % 10);
    const out = new Uint8Array(unpadRows(mapped, width, height));
    expect(out.length).toBe(width * 4 * height);
    expect(out.includes(0xee)).toBe(false);
    expect(out[width * 4]).toBe(10);
    expect(unpadRows(mapped.buffer, width, height).byteLength).toBe(width * 4 * height);
  });

  it("copies an aligned buffer as is", () => {
    const mapped = new Uint8Array(64 * 4 * 2).map((_, i) => i & 255);
    expect(new Uint8Array(unpadRows(mapped, 64, 2))).toEqual(mapped);
  });
});

describe("I420 shader source", () => {
  it("has the eight filter weights filled in and no placeholder left", () => {
    const source = buildI420Wgsl();
    expect(source).not.toContain("__TAPS__");
    const match = /array<f32, 8>\(([^)]*)\)/.exec(source);
    expect(match).not.toBeNull();
    const weights = match![1].split(",").map(Number);
    expect(weights).toHaveLength(8);
    expect(weights.every(Number.isFinite)).toBe(true);
    expect(weights.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 6);
  });
});

describe("I420 readback layout", () => {
  it("aligns every plane region to 256 bytes", () => {
    const l = i420Layout(1920, 1080);
    expect(l.yStride).toBe(2048);
    expect(l.cStride).toBe(1024);
    expect(l.uOffset % 256).toBe(0);
    expect(l.vOffset % 256).toBe(0);
    expect(l.uOffset).toBeGreaterThanOrEqual(1920 * 1080);
    expect(l.size).toBeGreaterThanOrEqual(l.vOffset + 1024 * 540);
    expect(i420Layout(30, 18).yStride).toBe(256);
  });

  it("packs the three padded planes into one contiguous Y, Cb, Cr frame", () => {
    const width = 30;
    const height = 6;
    const l = i420Layout(width, height);
    const mapped = new Uint8Array(l.size).fill(0xee);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) mapped[l.yOffset + y * l.yStride + x] = 1;
    for (let y = 0; y < height / 2; y++) for (let x = 0; x < width / 2; x++) {
      mapped[l.uOffset + y * l.cStride + x] = 2;
      mapped[l.vOffset + y * l.cStride + x] = 3;
    }
    const out = new Uint8Array(unpackI420(mapped, width, height));
    expect(out.length).toBe(width * height * 1.5);
    expect(out.includes(0xee)).toBe(false);
    expect(out.subarray(0, width * height).every((v) => v === 1)).toBe(true);
    const cs = (width / 2) * (height / 2);
    expect(out.subarray(width * height, width * height + cs).every((v) => v === 2)).toBe(true);
    expect(out.subarray(width * height + cs).every((v) => v === 3)).toBe(true);
  });

  it("is not created for odd sizes", async () => {
    deviceHolder.device = fakeDevice(31, 17).device;
    expect(await GpuFrameReader.create(31, 17, 3, "i420")).toBeNull();
  });
});

describe("GpuFrameReader", () => {
  it("is null without a device or when the frame cannot fit", async () => {
    deviceHolder.device = null;
    expect(await GpuFrameReader.create(64, 16)).toBeNull();
    deviceHolder.device = fakeDevice(64, 16, 0, 100).device;
    expect(await GpuFrameReader.create(64, 16)).toBeNull();
    expect(await GpuFrameReader.create(0, 16)).toBeNull();
  });

  it("returns every frame's pixels in order with the row padding removed", async () => {
    const { device } = fakeDevice(30, 6);
    deviceHolder.device = device;
    const reader = (await GpuFrameReader.create(30, 6, 3))!;
    const tickets = [];
    for (let i = 0; i < 3; i++) tickets.push(await reader.begin(bitmap(30, 6)));
    for (let i = 0; i < 3; i++) expect(new Uint8Array(await tickets[i].bytes)).toEqual(expected(i + 1, 30, 6));
    expect(reader.stats.frames).toBe(3);
    expect(reader.stats.maxInFlight).toBe(3);
    reader.dispose();
  });

  it("keeps at most `depth` copies in flight and reuses slots in order", async () => {
    const { device, copies } = fakeDevice(64, 4, 5);
    deviceHolder.device = device;
    const reader = (await GpuFrameReader.create(64, 4, 2))!;
    const results: Uint8Array[] = [];
    const consume = (async () => {
      const queue: Array<Promise<ArrayBuffer>> = [];
      for (let i = 0; i < 6; i++) {
        const ticket = await reader.begin(bitmap(64, 4));
        queue.push(ticket.bytes);
        if (queue.length >= 2) results.push(new Uint8Array(await queue.shift()!));
      }
      while (queue.length) results.push(new Uint8Array(await queue.shift()!));
    })();
    await consume;
    expect(copies).toEqual([1, 2, 3, 4, 5, 6]);
    results.forEach((bytes, i) => expect(bytes).toEqual(expected(i + 1, 64, 4)));
    expect(reader.stats.maxInFlight).toBeLessThanOrEqual(2);
    reader.dispose();
  });

  it("waits for a free slot instead of overwriting one that is still being read", async () => {
    const { device, copies } = fakeDevice(64, 2, 10);
    deviceHolder.device = device;
    const reader = (await GpuFrameReader.create(64, 2, 1))!;
    const first = await reader.begin(bitmap(64, 2));
    let secondStarted = false;
    const secondPromise = reader.begin(bitmap(64, 2)).then((t) => { secondStarted = true; return t; });
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    expect(copies).toEqual([1]);
    expect(new Uint8Array(await first.bytes)).toEqual(expected(1, 64, 2));
    const second = await secondPromise;
    expect(new Uint8Array(await second.bytes)).toEqual(expected(2, 64, 2));
    expect(reader.stats.slotWaitMs).toBeGreaterThan(0);
    reader.dispose();
  });

  it("rejects a frame of another size and frees the slot when the copy throws", async () => {
    const { device } = fakeDevice(64, 2);
    deviceHolder.device = device;
    const reader = (await GpuFrameReader.create(64, 2, 1))!;
    await expect(reader.begin(bitmap(32, 2))).rejects.toThrow(/size changed/);
    (device.queue as { submit: ReturnType<typeof vi.fn> }).submit.mockImplementationOnce(() => { throw new Error("device lost"); });
    await expect(reader.begin(bitmap(64, 2))).rejects.toThrow(/device lost/);
    const ok = await reader.begin(bitmap(64, 2));
    expect((await ok.bytes).byteLength).toBe(64 * 2 * 4);
    reader.dispose();
  });

  it("reuses a recycled buffer for the next frame and still returns that frame's pixels", async () => {
    const { device } = fakeDevice(64, 2);
    deviceHolder.device = device;
    const reader = (await GpuFrameReader.create(64, 2, 2))!;
    const first = await reader.begin(bitmap(64, 2));
    const firstBytes = await first.bytes;
    first.recycle(firstBytes);
    const second = await reader.begin(bitmap(64, 2));
    const secondBytes = await second.bytes;
    expect(secondBytes).toBe(firstBytes);
    expect(new Uint8Array(secondBytes)).toEqual(expected(2, 64, 2));
    second.recycle(new ArrayBuffer(3));
    reader.dispose();
  });

  it("destroys its buffers on dispose and refuses new frames", async () => {
    const { device, buffers } = fakeDevice(64, 2);
    deviceHolder.device = device;
    const reader = (await GpuFrameReader.create(64, 2, 3))!;
    reader.dispose();
    expect(buffers.every((b) => b.destroyed)).toBe(true);
    await expect(reader.begin(bitmap(64, 2))).rejects.toThrow(/disposed/);
  });
});
