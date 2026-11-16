import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryGovernor,
  PRESSURE_THRESHOLDS,
  computeGovernorLimit,
  DECODER_BUDGET_SHARE,
  RENDERER_BASELINE_BYTES,
  DECODER_BYTES_PER_PIXEL,
  estimateDecoderBytes,
  maxConcurrentDecoders,
  nextPressure,
  policyFor,
} from "./memory-governor";
import {
  computeMediaMemoryBudget,
  getMediaMemoryBudget,
  scaleMediaMemoryBudget,
  setMediaMemoryBudgetFromSystemMemory,
  subscribeMediaMemoryBudget,
} from "./media-memory-budget";
import { getMemoryGovernor, resetMemoryGovernorForTests } from "./memory-governor";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe("governor limit", () => {
  it("is 30 % of RAM between 1 and 3 GB", () => {
    expect(computeGovernorLimit(2 * GB)).toBe(1 * GB);
    expect(computeGovernorLimit(8 * GB)).toBe(Math.floor(2.4 * GB));
    expect(computeGovernorLimit(16 * GB)).toBe(3 * GB);
    expect(computeGovernorLimit(64 * GB)).toBe(3 * GB);
    expect(computeGovernorLimit(null)).toBe(Math.floor(2.4 * GB));
  });
});

describe("nextPressure", () => {
  const limit = 1000;
  it("enters and leaves each level with hysteresis", () => {
    expect(nextPressure("normal", 600, limit)).toBe("normal");
    expect(nextPressure("normal", 660, limit)).toBe("elevated");
    // 55 % is below the enter share but above the leave share: stays elevated.
    expect(nextPressure("elevated", 550, limit)).toBe("elevated");
    expect(nextPressure("elevated", 490, limit)).toBe("normal");
    expect(nextPressure("elevated", 910, limit)).toBe("critical");
    expect(nextPressure("critical", 800, limit)).toBe("critical");
    expect(nextPressure("critical", 740, limit)).toBe("elevated");
    expect(nextPressure("critical", 400, limit)).toBe("normal");
    expect(nextPressure("normal", 950, limit)).toBe("critical");
  });

  it("orders thresholds so that leaving is always below entering", () => {
    expect(PRESSURE_THRESHOLDS.elevated.leave).toBeLessThan(PRESSURE_THRESHOLDS.elevated.enter);
    expect(PRESSURE_THRESHOLDS.critical.leave).toBeLessThan(PRESSURE_THRESHOLDS.critical.enter);
    expect(PRESSURE_THRESHOLDS.critical.leave).toBeGreaterThan(PRESSURE_THRESHOLDS.elevated.enter);
  });
});

describe("policies", () => {
  it("degrade monotonically", () => {
    const n = policyFor("normal");
    const e = policyFor("elevated");
    const c = policyFor("critical");
    expect(n.cacheScale).toBeGreaterThan(e.cacheScale);
    expect(e.cacheScale).toBeGreaterThan(c.cacheScale);
    expect(n.previewScale).toBeGreaterThan(e.previewScale);
    expect(e.previewScale).toBeGreaterThan(c.previewScale);
    expect(n.maxDecoderElements).toBeGreaterThanOrEqual(e.maxDecoderElements);
    expect(c.maxDecoderElements).toBe(1);
    expect(c.readAhead).toBe(false);
    expect(n.readAhead).toBe(true);
  });
});

describe("estimateDecoderBytes", () => {
  it("scales with resolution", () => {
    expect(estimateDecoderBytes(3840, 2160)).toBe(3840 * 2160 * DECODER_BYTES_PER_PIXEL);
    expect(estimateDecoderBytes(1920, 1080)).toBe(estimateDecoderBytes(3840, 2160) / 4);
    expect(estimateDecoderBytes(0, 100)).toBe(0);
  });

  it("matches the soak: a 4K decoder costs 0.85-1.1 GB, not the old ~149 MB", () => {
    const fourK = estimateDecoderBytes(3840, 2160);
    expect(fourK).toBeGreaterThan(0.85 * GB);
    expect(fourK).toBeLessThan(1.1 * GB);
    // Two layered 4K decoders on the ~1.4 GB base must reproduce the 3.1-3.6 GB renderer rise of the layered soak.
    expect(2 * fourK + 1.4 * GB).toBeGreaterThan(3.1 * GB);
    expect(2 * fourK + 1.4 * GB).toBeLessThan(4.1 * GB);
  });
});

describe("maxConcurrentDecoders", () => {
  it("caps 4K decoders so that they alone stay under the critical share of the limit", () => {
    for (const ramGB of [4, 8, 16, 32, 64]) {
      const limit = computeGovernorLimit(ramGB * GB);
      const cap = maxConcurrentDecoders(3840, 2160, limit);
      expect(cap).toBeGreaterThanOrEqual(1);
      if (cap > 1) expect(cap * estimateDecoderBytes(3840, 2160)).toBeLessThanOrEqual(limit * DECODER_BUDGET_SHARE);
      // One more would break the budget (unless the floor of 1 applies).
      expect((cap + 1) * estimateDecoderBytes(3840, 2160)).toBeGreaterThan(limit * DECODER_BUDGET_SHARE);
    }
  });

  it("is 2 for 4K on 8 and 16 GB machines, 1 on a 4 GB machine, and uncapped for unknown sizes", () => {
    expect(maxConcurrentDecoders(3840, 2160, computeGovernorLimit(8 * GB))).toBe(2);
    expect(maxConcurrentDecoders(3840, 2160, computeGovernorLimit(16 * GB))).toBe(2);
    expect(maxConcurrentDecoders(3840, 2160, computeGovernorLimit(4 * GB))).toBe(1);
    expect(maxConcurrentDecoders(0, 0, GB)).toBe(Number.POSITIVE_INFINITY);
  });

  it("allows more 1080p decoders than 4K ones", () => {
    const limit = computeGovernorLimit(16 * GB);
    expect(maxConcurrentDecoders(1920, 1080, limit)).toBeGreaterThan(maxConcurrentDecoders(3840, 2160, limit));
  });
});

describe("MemoryGovernor", () => {
  const make = (over: Partial<ConstructorParameters<typeof MemoryGovernor>[0]> = {}) =>
    new MemoryGovernor({ systemMemoryBytes: 8 * GB, heapBytes: () => 0, rendererBaselineBytes: 0, measure: async () => null, ...over });

  it("sums registered consumers and decoders into the usage and notifies on level changes", () => {
    const gov = make(); // limit 2 GB
    let held = 100 * MB;
    gov.registerConsumer("audio", { bytes: () => held });
    const seen: string[] = [];
    gov.subscribe((policy) => {
      if (seen[seen.length - 1] !== policy.pressure) seen.push(policy.pressure);
    });
    expect(gov.tick()).toBe("normal");

    const release = gov.registerDecoder("a", estimateDecoderBytes(3840, 2160)); // ~949 MB
    held = 700 * MB;
    expect(gov.tick()).toBe("elevated"); // 1649 MB of 2458 MB = 67 %
    held = 1400 * MB;
    expect(gov.tick()).toBe("critical"); // 2349 MB = 96 %
    held = 100 * MB;
    release();
    expect(gov.tick()).toBe("normal");
    expect(seen).toEqual(["normal", "elevated", "critical", "normal"]); // the first "normal" is the decoder cap moving
    expect(gov.reading.consumers.audio).toBe(100 * MB);
  });

  it("lowers the decoder-element cap while 4K decoders are open and restores it when they close", () => {
    const gov = make(); // limit 2.4 GB: two 4K decoders fit, three do not
    const caps: number[] = [];
    gov.subscribe((policy) => caps.push(policy.maxDecoderElements));
    expect(gov.policy.maxDecoderElements).toBe(3);
    expect(gov.decoderCap).toBe(Number.POSITIVE_INFINITY);

    const release4k = gov.registerDecoder("uhd", estimateDecoderBytes(3840, 2160));
    expect(gov.decoderCap).toBe(2);
    expect(gov.policy.maxDecoderElements).toBe(2);
    expect(gov.policy.pressure).toBe("normal");
    expect(caps).toEqual([2]);

    // A 1080p decoder alone does not lower the cap further.
    const release1080 = gov.registerDecoder("hd", estimateDecoderBytes(1920, 1080));
    expect(gov.decoderCap).toBe(2);
    release4k();
    expect(gov.policy.maxDecoderElements).toBe(3);
    release1080();
    release1080(); // idempotent
    expect(caps).toEqual([2, 3]);
  });

  it("returns the same policy object on every read while nothing changed (useSyncExternalStore snapshot)", () => {
    const gov = make();
    gov.registerDecoder("uhd", estimateDecoderBytes(3840, 2160));
    expect(gov.policy.maxDecoderElements).toBe(2);
    expect(gov.policy).toBe(gov.policy);
    const capped = gov.policy;
    gov.registerDecoder("hd", estimateDecoderBytes(1920, 1080));
    expect(gov.policy).toBe(capped);
    gov.force("elevated");
    expect(gov.policy).toBe(gov.policy);
  });

  it("never lifts the pressure policy's own lower cap and never drops below one decoder", () => {
    const small = make({ systemMemoryBytes: 2 * GB }); // limit 1 GB: even one 4K decoder is over the share
    small.registerDecoder("uhd", estimateDecoderBytes(3840, 2160));
    expect(small.decoderCap).toBe(1);
    expect(small.policy.maxDecoderElements).toBe(1);

    const gov = make();
    gov.registerDecoder("hd", estimateDecoderBytes(1920, 1080));
    gov.force("critical");
    expect(gov.policy.maxDecoderElements).toBe(1);
    gov.force("elevated");
    expect(gov.policy.maxDecoderElements).toBe(2);
  });

  it("subtracts the renderer baseline: with a 1.4 GB heap, baseline + capped 4K decoders stays under the critical share", () => {
    const each = estimateDecoderBytes(3840, 2160);
    for (const ramGB of [8, 16, 32]) {
      const gov = make({ systemMemoryBytes: ramGB * GB, heapBytes: () => 1.4 * GB });
      gov.registerDecoder("uhd-1", each);
      const limit = gov.reading.limitBytes;
      const cap = gov.decoderCap;
      expect(cap).toBeGreaterThanOrEqual(1);
      // Above the floor of one decoder, the cap keeps the total under the critical share.
      if (cap > 1) expect(1.4 * GB + cap * each).toBeLessThanOrEqual(limit * DECODER_BUDGET_SHARE);
      // The old, baseline-blind cap was floor(limit*0.9/each) = 2 on 8 and 16 GB machines: that overshot.
      expect(cap).toBe(1);
    }
  });

  it("with a realistic ~200 MB heap and no precise measurement, 4K is capped at one decoder on 8 and 16 GB machines", () => {
    const each = estimateDecoderBytes(3840, 2160);
    for (const ramGB of [8, 16]) {
      const gov = new MemoryGovernor({
        systemMemoryBytes: ramGB * GB,
        heapBytes: () => 200 * 1024 * 1024,
        measure: async () => null,
      });
      gov.registerDecoder("uhd-1", each);
      expect(gov.reading.decoderBaselineBytes).toBeGreaterThanOrEqual(RENDERER_BASELINE_BYTES);
      expect(gov.decoderCap).toBe(1);
      expect(gov.policy.maxDecoderElements).toBe(1);
      expect(gov.canOpenDecoder(each)).toBe(false);
    }
  });

  it("the renderer floor does not push ordinary 1080p playback on an 8 GB machine into elevated pressure", () => {
    const gov = new MemoryGovernor({ systemMemoryBytes: 8 * GB, heapBytes: () => 200 * 1024 * 1024, measure: async () => null });
    const hd = estimateDecoderBytes(1920, 1080);
    gov.registerDecoder("hd-1", hd);
    expect(gov.tick()).toBe("normal");
    expect(gov.canOpenDecoder(hd)).toBe(true);
    gov.registerDecoder("hd-2", hd);
    expect(gov.tick()).toBe("normal");
    expect(gov.policy.previewScale).toBe(1);
  });

  it("a heap above the baseline wins over the floor", () => {
    const big = new MemoryGovernor({ systemMemoryBytes: 16 * GB, heapBytes: () => 2 * GB, measure: async () => null });
    expect(big.reading.usageBytes).toBe(2 * GB);
    expect(big.reading.decoderBaselineBytes).toBe(2 * GB);
  });

  it("epoch advances when decoders open or close or the limit moves", () => {
    const gov = make();
    const e0 = gov.epoch;
    const release = gov.registerDecoder("a", 1);
    expect(gov.epoch).toBeGreaterThan(e0);
    const e1 = gov.epoch;
    release();
    expect(gov.epoch).toBeGreaterThan(e1);
    const e2 = gov.epoch;
    gov.setLimitBytes(5 * GB);
    expect(gov.epoch).toBeGreaterThan(e2);
  });

  it("counts frame caches as baseline too and lets the cap grow back when they shrink", () => {
    const each = estimateDecoderBytes(3840, 2160);
    let cache = 0;
    const gov = make({ systemMemoryBytes: 64 * GB }); // limit 3 GB
    gov.registerConsumer("frames", { bytes: () => cache });
    gov.registerDecoder("uhd", each);
    expect(gov.decoderCap).toBe(2);
    cache = 1.2 * GB;
    gov.tick();
    expect(gov.decoderCap).toBe(1);
    cache = 0;
    gov.tick();
    expect(gov.decoderCap).toBe(2);
  });

  it("canOpenDecoder allows the first decoder and refuses one that would pass the critical share", () => {
    const each = estimateDecoderBytes(3840, 2160);
    const gov = make({ systemMemoryBytes: 16 * GB, heapBytes: () => 1.4 * GB }); // limit 3 GB, share 2.7 GB
    expect(gov.canOpenDecoder(each)).toBe(true); // none open yet
    gov.registerDecoder("uhd-1", each); // 1.4 + 0.95 = 2.35 GB
    expect(gov.canOpenDecoder(each)).toBe(false); // 3.3 GB
    expect(gov.canOpenDecoder(estimateDecoderBytes(640, 360))).toBe(true);
    const idle = make({ systemMemoryBytes: 16 * GB });
    idle.registerDecoder("uhd-1", each);
    expect(idle.canOpenDecoder(each)).toBe(true); // 1.9 GB of 2.7 GB
  });

  it("ends with the newest policy for every listener when one releases a decoder re-entrantly", () => {
    const gov = make({ systemMemoryBytes: 64 * GB }); // limit 3 GB
    const releaseA = gov.registerDecoder("a", estimateDecoderBytes(3840, 2160)); // cap 2
    const first: number[] = [];
    const second: number[] = [];
    let armed = true;
    gov.subscribe((policy) => {
      first.push(policy.maxDecoderElements);
      if (armed && policy.maxDecoderElements === 1) {
        armed = false;
        releaseA(); // re-enters evaluate(): no decoder is open any more, the cap is back to 3
      }
    });
    gov.subscribe((policy) => second.push(policy.maxDecoderElements));
    gov.setLimitBytes(1 * GB); // one 4K decoder no longer fits twice: cap 1
    expect(gov.policy.maxDecoderElements).toBe(3);
    expect(first[first.length - 1]).toBe(3);
    expect(second[second.length - 1]).toBe(3);
  });

  it("uses the larger of the precise measurement and the heap, plus the consumers", async () => {
    const gov = make({ measure: async () => 1600 * MB, heapBytes: () => 50 * MB, measureEveryMs: 1 });
    gov.registerConsumer("frames", { bytes: () => 100 * MB });
    gov.tick(Date.now());
    await new Promise((r) => setTimeout(r, 0));
    expect(gov.reading.measuredBytes).toBe(1600 * MB);
    expect(gov.reading.usageBytes).toBe(1700 * MB);
    expect(gov.reading.pressure).toBe("elevated");
  });

  it("does not count memory the page already reports twice (decoded audio is in the heap and in the measurement)", () => {
    const gov = make({ heapBytes: () => 900 * MB });
    gov.registerConsumer("audio", { bytes: () => 700 * MB, inPageMemory: true });
    gov.registerConsumer("frames", { bytes: () => 100 * MB });
    gov.tick();
    expect(gov.reading.usageBytes).toBe(1000 * MB); // heap 900 + frames 100, not + audio 700
    // Without any page figure the audio still counts, so a browser without performance.memory is not blind to it.
    const blind = make({ heapBytes: () => null });
    blind.registerConsumer("audio", { bytes: () => 700 * MB, inPageMemory: true });
    blind.tick();
    expect(blind.reading.usageBytes).toBe(700 * MB);
  });

  it("survives a throwing consumer and a throwing listener", () => {
    const gov = make();
    gov.registerConsumer("bad", { bytes: () => { throw new Error("gone"); } });
    gov.registerConsumer("big", { bytes: () => 3 * GB });
    const ok = vi.fn();
    gov.subscribe(() => { throw new Error("listener"); });
    gov.subscribe(ok);
    expect(gov.tick()).toBe("critical");
    expect(ok).toHaveBeenCalledOnce();
  });

  it("force pins a level and unregistering a consumer stops counting it", () => {
    const gov = make();
    const off = gov.registerConsumer("big", { bytes: () => 3 * GB });
    gov.force("normal");
    expect(gov.policy.pressure).toBe("normal");
    gov.force(null);
    expect(gov.tick()).toBe("critical");
    off();
    expect(gov.tick()).toBe("normal");
  });

  it("returns to measuring from normal after a forced level is released", () => {
    const gov = make(); // limit 2.4 GB
    gov.registerConsumer("c", { bytes: () => 1300 * MB }); // 53 %: inside the elevated hysteresis band, below its entry
    gov.force("critical");
    expect(gov.policy.pressure).toBe("critical");
    gov.force(null);
    expect(gov.policy.pressure).toBe("normal");
  });

  it("re-derives the limit when the system memory becomes known", () => {
    const gov = make({ systemMemoryBytes: 2 * GB }); // limit 1 GB
    gov.registerConsumer("c", { bytes: () => 700 * MB });
    expect(gov.tick()).toBe("elevated");
    gov.setSystemMemory(16 * GB); // limit 3 GB
    expect(gov.reading.pressure).toBe("normal");
  });
});

describe("media memory budget under pressure", () => {
  afterEach(() => {
    getMemoryGovernor().force(null);
  });

  it("scales every cache budget", () => {
    const base = computeMediaMemoryBudget(16 * GB);
    const scaled = scaleMediaMemoryBudget(base, 0.5);
    expect(scaled.audioBufferBytes).toBe(Math.floor(base.audioBufferBytes * 0.5));
    expect(scaled.videoFrameBytes).toBe(Math.floor(base.videoFrameBytes * 0.5));
    expect(scaled.seekAnchorBytes).toBe(Math.floor(base.seekAnchorBytes * 0.5));
    expect(scaleMediaMemoryBudget(base, 1)).toBe(base);
  });

  it("shrinks the shared budget when the governor degrades and restores it afterwards", () => {
    setMediaMemoryBudgetFromSystemMemory(16 * GB);
    const normal = getMediaMemoryBudget();
    const seen: number[] = [];
    const off = subscribeMediaMemoryBudget((b) => seen.push(b.audioBufferBytes));
    getMemoryGovernor().force("critical");
    expect(getMediaMemoryBudget().audioBufferBytes).toBe(Math.floor(normal.audioBufferBytes * policyFor("critical").cacheScale));
    getMemoryGovernor().force("normal");
    expect(getMediaMemoryBudget().audioBufferBytes).toBe(normal.audioBufferBytes);
    expect(seen.length).toBe(2);
    off();
  });
});

afterAll(() => resetMemoryGovernorForTests());
