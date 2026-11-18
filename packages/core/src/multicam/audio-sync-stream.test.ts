import { describe, expect, it } from "vitest";
import { decimateForSync, findAudioOffset } from "./audio-sync";
import { StreamingDecimator, findAudioOffsetStreaming, wavBlobSource, type AudioChunkSource } from "./audio-sync-stream";

const hash = (n: number, seed: number): number => {
  let x = (Math.imul(n, 2654435761) ^ Math.imul(seed + 1, 0x85ebca6b)) >>> 0;
  x = (x + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 3266489917) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 0xffffffff - 0.5;
};

/** Click events on the shared clock (seconds), irregularly spaced and individually shaped. */
function events(totalSeconds: number): number[] {
  const out: number[] = [];
  let t = 3;
  let k = 0;
  while (t < totalSeconds - 5) {
    out.push(t);
    t += 7 + (hash(k++, 99) + 0.5) * 40;
  }
  return out;
}

/**
 * A procedurally generated microphone: room noise plus the shared click
 * events, `lead` seconds late. Nothing is materialised; `live` tracks the raw
 * bytes handed out and not yet released (one chunk at a time by construction).
 */
function synthetic(opts: { seed: number; rate: number; seconds: number; lead: number; clicks: number[]; chunkSeconds?: number }): AudioChunkSource & {
  peakChunkBytes: number;
  samplesRead: number;
} {
  const chunkSeconds = opts.chunkSeconds ?? 1;
  const state = { peakChunkBytes: 0, samplesRead: 0 };
  const source = {
    sampleRate: opts.rate,
    durationSeconds: opts.seconds,
    get peakChunkBytes() {
      return state.peakChunkBytes;
    },
    get samplesRead() {
      return state.samplesRead;
    },
    async *read(start: number, end: number) {
      const first = Math.floor(start * opts.rate);
      const last = Math.min(Math.floor(end * opts.rate), Math.floor(opts.seconds * opts.rate));
      const step = Math.floor(chunkSeconds * opts.rate);
      for (let from = first; from < last; from += step) {
        const to = Math.min(last, from + step);
        const chunk = new Float32Array(to - from);
        for (let i = from; i < to; i++) chunk[i - from] = hash(i, opts.seed) * 0.2;
        const lo = from / opts.rate;
        const hi = to / opts.rate;
        opts.clicks.forEach((c, index) => {
          const at = c - opts.lead;
          if (at + 0.2 < lo || at > hi) return;
          const s0 = Math.round(at * opts.rate);
          for (let j = 0; j < 0.075 * opts.rate; j++) {
            const idx = s0 + j;
            if (idx >= from && idx < to) chunk[idx - from] += hash(j, 1000 + index) * 3 * Math.exp(-j / (0.015 * opts.rate));
          }
        });
        state.peakChunkBytes = Math.max(state.peakChunkBytes, chunk.byteLength);
        state.samplesRead += chunk.length;
        yield chunk;
      }
    },
  };
  return source;
}

describe("StreamingDecimator", () => {
  it("is bit-identical to decimateForSync for any chunking (fractional ratio)", () => {
    const n = 44100 * 3 + 123;
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = hash(i, 5);
    const expected = decimateForSync(samples, 44100, 4000, 100);
    const d = new StreamingDecimator(44100, 4000, 3);
    for (let at = 0; at < n; ) {
      const len = 1 + Math.floor((hash(at, 7) + 0.5) * 9000);
      d.push(samples.subarray(at, Math.min(n, at + len)));
      at += len;
    }
    const got = d.finish();
    expect(got.length).toBe(expected.length);
    for (let i = 0; i < got.length; i++) expect(got[i]).toBeCloseTo(expected[i], 5);
  });
});

describe("findAudioOffsetStreaming", () => {
  it("agrees with the in-memory correlator on a short clip", async () => {
    const clicks = [1.0, 3.3, 7.9];
    const a = synthetic({ seed: 1, rate: 8000, seconds: 10, lead: 0, clicks });
    const b = synthetic({ seed: 2, rate: 8000, seconds: 10, lead: 0.8, clicks });
    const streamed = await findAudioOffsetStreaming(a, b);
    const toArray = async (s: AudioChunkSource): Promise<Float32Array> => {
      const parts: Float32Array[] = [];
      for await (const c of s.read(0, s.durationSeconds)) parts.push(c);
      const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    };
    const memory = findAudioOffset(await toArray(a), 8000, await toArray(b), 8000);
    expect(Math.abs(streamed.offsetSeconds - 0.8)).toBeLessThan(0.002);
    expect(Math.abs(streamed.offsetSeconds - memory.offsetSeconds)).toBeLessThan(0.002);
    expect(streamed.confidence).toBeGreaterThan(0.3);
  });

  it("syncs a 60 minute recording within 1 ms while holding one chunk of raw audio", async () => {
    const seconds = 3600;
    const rate = 8000;
    const clicks = events(seconds);
    for (const lead of [12.347, -4.0215]) {
      const a = synthetic({ seed: 1, rate, seconds, lead: 0, clicks });
      const b = synthetic({ seed: 2, rate, seconds, lead, clicks });
      let peakArrayBuffers = 0;
      const base = process.memoryUsage().arrayBuffers;
      const timer = setInterval(() => {
        peakArrayBuffers = Math.max(peakArrayBuffers, process.memoryUsage().arrayBuffers);
      }, 5);
      const started = Date.now();
      const result = await findAudioOffsetStreaming(a, b);
      clearInterval(timer);
      peakArrayBuffers = Math.max(peakArrayBuffers, process.memoryUsage().arrayBuffers);
      expect(Math.abs(result.offsetSeconds - lead)).toBeLessThan(0.001);
      expect(result.confidence).toBeGreaterThan(0.3);
      // One 1 s chunk of 8 kHz float samples is 32 KB; both streams were read in full for the envelope.
      expect(a.peakChunkBytes).toBeLessThanOrEqual(8000 * 4);
      expect(a.samplesRead).toBeGreaterThanOrEqual(seconds * rate);
      // Whole-file decode of the two recordings would be 2 x 115 MB of float samples.
      expect(peakArrayBuffers - base).toBeLessThan(60 * 1024 * 1024);
      expect(Date.now() - started).toBeLessThan(60_000);
    }
  }, 120_000);

  it("is accurate to a fraction of a frame at 48 kHz source rate over a 20 minute file", async () => {
    const seconds = 1200;
    const clicks = events(seconds);
    const a = synthetic({ seed: 3, rate: 48000, seconds, lead: 0, clicks });
    const b = synthetic({ seed: 4, rate: 48000, seconds, lead: 2.5, clicks, chunkSeconds: 0.5 });
    const result = await findAudioOffsetStreaming(a, b);
    expect(Math.abs(result.offsetSeconds - 2.5)).toBeLessThan(1 / 25 / 10);
  }, 120_000);

  it("reports zero confidence for unrelated recordings", async () => {
    const a = synthetic({ seed: 1, rate: 8000, seconds: 30, lead: 0, clicks: [] });
    const b = synthetic({ seed: 2, rate: 8000, seconds: 30, lead: 0, clicks: [] });
    expect((await findAudioOffsetStreaming(a, b)).confidence).toBeLessThan(0.5);
  });
});

describe("wavBlobSource", () => {
  const wav = (samples: Int16Array, rate: number, channels: number): Blob => {
    const header = new DataView(new ArrayBuffer(44));
    const w = (at: number, t: string) => [...t].forEach((c, i) => header.setUint8(at + i, c.charCodeAt(0)));
    w(0, "RIFF");
    header.setUint32(4, 36 + samples.byteLength, true);
    w(8, "WAVE");
    w(12, "fmt ");
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true);
    header.setUint16(22, channels, true);
    header.setUint32(24, rate, true);
    header.setUint32(28, rate * 2 * channels, true);
    header.setUint16(32, 2 * channels, true);
    header.setUint16(34, 16, true);
    w(36, "data");
    header.setUint32(40, samples.byteLength, true);
    return new Blob([header.buffer, samples.buffer as ArrayBuffer]);
  };

  it("rejects malformed headers instead of producing NaN/Infinity frame counts", async () => {
    const good = wav(new Int16Array(800), 8000, 1);
    const patch = async (at: number, size: number, value: number): Promise<Blob> => {
      const bytes = new Uint8Array(await good.arrayBuffer());
      const view = new DataView(bytes.buffer);
      if (size === 2) view.setUint16(at, value, true);
      else view.setUint32(at, value, true);
      return new Blob([bytes]);
    };
    await expect(wavBlobSource(await patch(22, 2, 0))).rejects.toThrow(); // 0 channels
    await expect(wavBlobSource(await patch(24, 4, 0))).rejects.toThrow(); // 0 Hz
    await expect(wavBlobSource(await patch(34, 2, 12))).rejects.toThrow(); // 12-bit
    await expect(wavBlobSource(await patch(34, 2, 0))).rejects.toThrow(); // 0-bit
    await expect(wavBlobSource(await patch(20, 2, 2))).rejects.toThrow(); // ADPCM
    await expect(wavBlobSource(good)).resolves.toBeTruthy();
  });

  it("streams channel 0 in chunks and recovers the offset", async () => {
    const rate = 8000;
    const clicks = [1.0, 3.3, 7.9, 12.5];
    const bake = async (lead: number, seed: number): Promise<Blob> => {
      const src = synthetic({ seed, rate, seconds: 16, lead, clicks });
      const pcm = new Int16Array(16 * rate * 2);
      let at = 0;
      for await (const c of src.read(0, 16)) {
        for (const v of c) {
          pcm[at * 2] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
          pcm[at * 2 + 1] = 1234; // the right channel must be ignored
          at++;
        }
      }
      return wav(pcm, rate, 2);
    };
    const a = await wavBlobSource(await bake(0, 1), 0.5);
    const b = await wavBlobSource(await bake(1.25, 2), 0.5);
    expect(a.sampleRate).toBe(rate);
    expect(a.durationSeconds).toBeCloseTo(16, 6);
    const result = await findAudioOffsetStreaming(a, b);
    expect(Math.abs(result.offsetSeconds - 1.25)).toBeLessThan(0.002);
  });
});

// Peak-memory report (not part of CI): OPENREEL_MEM_REPORT=before|after vitest run src/multicam/audio-sync-stream -t report
// Reports the peak of process.memoryUsage().arrayBuffers (typed-array memory, upper bound: garbage not yet collected counts).
describe.runIf(process.env.OPENREEL_MEM_REPORT)("peak memory report, 60 min @ 8 kHz", () => {
  it(`report ${process.env.OPENREEL_MEM_REPORT}`, async () => {
    const seconds = 3600;
    const rate = 8000;
    const clicks = events(seconds);
    const base = process.memoryUsage().arrayBuffers;
    let peak = 0;
    const sample = () => {
      peak = Math.max(peak, process.memoryUsage().arrayBuffers - base);
    };
    const watch = (source: AudioChunkSource): AudioChunkSource => ({
      sampleRate: source.sampleRate,
      durationSeconds: source.durationSeconds,
      async *read(start, end) {
        for await (const c of source.read(start, end)) {
          sample();
          yield c;
        }
      },
    });
    const a = watch(synthetic({ seed: 1, rate, seconds, lead: 0, clicks }));
    const b = watch(synthetic({ seed: 2, rate, seconds, lead: 12.347, clicks }));
    let offset: number;
    if (process.env.OPENREEL_MEM_REPORT === "before") {
      const all = async (s: AudioChunkSource): Promise<Float32Array> => {
        const out = new Float32Array(Math.floor(s.durationSeconds * s.sampleRate));
        let at = 0;
        for await (const c of s.read(0, s.durationSeconds)) {
          out.set(c, at);
          at += c.length;
        }
        return out;
      };
      // What the old pipeline does: both whole signals resident, first 180 s analysed.
      const ra = await all(a);
      const rb = await all(b);
      sample();
      offset = findAudioOffset(ra, rate, rb, rate).offsetSeconds;
      sample();
    } else {
      offset = (await findAudioOffsetStreaming(a, b)).offsetSeconds;
      sample();
      // One more read so garbage from the correlation stage is counted if still resident.
      for await (const c of a.read(0, 1)) void c;
    }
    console.log(`MEMREPORT ${process.env.OPENREEL_MEM_REPORT} peakArrayBuffersMB=${(peak / 1048576).toFixed(1)} offset=${offset}`);
  }, 300_000);
});
