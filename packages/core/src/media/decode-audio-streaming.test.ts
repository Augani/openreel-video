import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeTrack {
  numberOfChannels: number;
  sampleRate: number;
  canDecode: () => Promise<boolean>;
  computeDuration: () => Promise<number>;
}

const state: { tracks: FakeTrack[]; chunks: Array<{ timestamp: number; data: Float32Array[] }>; disposed: number; closed: number } = {
  tracks: [],
  chunks: [],
  disposed: 0,
  closed: 0,
};

vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  Input: class {
    getAudioTracks = async () => state.tracks;
    [Symbol.dispose] = () => {
      state.disposed++;
    };
  },
  AudioSampleSink: class {
    async *samples() {
      for (const c of state.chunks) {
        yield {
          timestamp: c.timestamp,
          numberOfFrames: c.data[0].length,
          numberOfChannels: c.data.length,
          copyTo: (dest: Float32Array, opts: { planeIndex: number }) => dest.set(c.data[opts.planeIndex].subarray(0, dest.length)),
          close: () => {
            state.closed++;
          },
        };
      }
    }
  },
}));

import { decodeAudioBufferStreaming } from "./decode-audio-streaming";

function fakeContext(): { ctx: BaseAudioContext; created: Array<{ channels: number; length: number; data: Float32Array[] }> } {
  const created: Array<{ channels: number; length: number; data: Float32Array[] }> = [];
  const ctx = {
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      created.push({ channels, length, data });
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: (i: number) => data[i],
        copyToChannel: (src: Float32Array, c: number, offset: number) => data[c].set(src, offset),
      };
    },
  } as unknown as BaseAudioContext;
  return { ctx, created };
}

const track = (over: Partial<FakeTrack> = {}): FakeTrack => ({
  numberOfChannels: 2,
  sampleRate: 100,
  canDecode: async () => true,
  computeDuration: async () => 1,
  ...over,
});

describe("decodeAudioBufferStreaming", () => {
  beforeEach(() => {
    state.tracks = [];
    state.chunks = [];
    state.disposed = 0;
    state.closed = 0;
  });

  it("allocates the final buffer once and places chunks by timestamp", async () => {
    state.tracks = [track()];
    state.chunks = [
      { timestamp: 0, data: [new Float32Array(50).fill(0.5), new Float32Array(50).fill(-0.5)] },
      { timestamp: 0.5, data: [new Float32Array(50).fill(0.25), new Float32Array(50).fill(-0.25)] },
    ];
    const { ctx, created } = fakeContext();
    const result = await decodeAudioBufferStreaming(ctx, new Blob([]), 0);
    expect(result.status).toBe("ok");
    expect(created).toHaveLength(1);
    expect(created[0].length).toBe(100);
    expect(created[0].data[0][0]).toBe(0.5);
    expect(created[0].data[0][99]).toBe(0.25);
    expect(created[0].data[1][60]).toBe(-0.25);
    expect(state.disposed).toBe(1);
    expect(state.closed).toBe(2);
  });

  it("reports a file without audio as none, so callers skip the ffmpeg route", async () => {
    const { ctx } = fakeContext();
    expect((await decodeAudioBufferStreaming(ctx, new Blob([]), 0)).status).toBe("none");
  });

  it.each([
    ["surround audio", track({ numberOfChannels: 6 })],
    ["an undecodable codec", track({ canDecode: async () => false })],
    ["an unknown duration", track({ computeDuration: async () => 0 })],
  ])("hands %s to the ffmpeg route", async (_name, t) => {
    state.tracks = [t];
    const { ctx, created } = fakeContext();
    expect((await decodeAudioBufferStreaming(ctx, new Blob([]), 0)).status).toBe("unsupported");
    expect(created).toHaveLength(0);
    expect(state.disposed).toBe(1);
  });

  it("falls back when the requested track index does not exist", async () => {
    state.tracks = [track()];
    const { ctx } = fakeContext();
    expect((await decodeAudioBufferStreaming(ctx, new Blob([]), 3)).status).toBe("unsupported");
  });
});
