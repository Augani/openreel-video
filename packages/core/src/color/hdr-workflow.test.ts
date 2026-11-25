import { describe, expect, it } from "vitest";
import { BT709_TO_BT2020, hlgOetf, pqDecodeToNits, pqEncodeNits } from "../export/color-output";
import { BT2020_TO_BT709, hlgInverseOetf, toneMapLuminance } from "./input-transform";
import { CpuHdrCompositor, hdrFrameToSdrRgba, type HdrFrame } from "./hdr-working";
import { HdrLightLevelMeter } from "./hdr-light-level";
import {
  isHdrSequence,
  resolveSequenceColorSpace,
  sequenceColorSpacePatch,
  sequenceHdrTransfer,
  sequenceScopeScale,
  suggestSequenceColorSpace,
} from "./sequence-color";
import { nitsToSignal, signalToNits } from "../video/scopes-extra";
import { beginHdrScopeFrame, clearHdrScopeFrame, getHdrScopeFrame, pqRgbToScopeFrame, publishHdrScopeFrame } from "../video/hdr-scope-feed";

describe("PQ and HLG transfer round trips", () => {
  it("PQ: nits -> signal -> nits is the identity over 0.01 .. 10 000 nits", () => {
    for (const nits of [0.01, 0.1, 1, 10, 100, 203, 400, 1000, 4000, 10000]) {
      const back = pqDecodeToNits(pqEncodeNits(nits));
      expect(Math.abs(back - nits) / nits).toBeLessThan(1e-6);
    }
    expect(pqEncodeNits(10000)).toBeCloseTo(1, 10);
    expect(pqEncodeNits(0)).toBeLessThan(1e-5);
  });

  it("PQ: 203 nits is signal 0.5807 (BT.2408 reference white) and 1000 nits is 0.7518", () => {
    expect(pqEncodeNits(203)).toBeCloseTo(0.5807, 3);
    expect(pqEncodeNits(1000)).toBeCloseTo(0.7518, 3);
  });

  it("HLG: OETF then inverse OETF is the identity on scene light 0..1", () => {
    for (let i = 0; i <= 200; i++) {
      const e = i / 200;
      expect(hlgInverseOetf(hlgOetf(e))).toBeCloseTo(e, 8);
    }
    expect(hlgOetf(1)).toBeCloseTo(1, 6);
    expect(hlgOetf(1 / 12)).toBeCloseTo(0.5, 6);
  });

  it("scope nit scales invert each other", () => {
    for (const scale of ["pq", "hlg"] as const) {
      for (const nits of [5, 50, 203, 500, 1000]) {
        expect(signalToNits(nitsToSignal(nits, scale), scale)).toBeCloseTo(nits, 2);
      }
    }
  });
});

describe("Rec.709 <-> Rec.2020 gamut conversion", () => {
  const mul = (m: readonly (readonly number[])[], v: readonly number[]): number[] => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

  it("round-trips linear colours", () => {
    for (const c of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.2, 0.5, 0.8], [0.9, 0.1, 0.4]]) {
      const back = mul(BT2020_TO_BT709, mul(BT709_TO_BT2020, c));
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(c[i], 6);
    }
  });

  it("keeps neutrals neutral (rows sum to 1)", () => {
    for (const m of [BT709_TO_BT2020, BT2020_TO_BT709]) {
      for (const row of m) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 4);
    }
    const grey = mul(BT709_TO_BT2020, [0.5, 0.5, 0.5]);
    expect(grey[0]).toBeCloseTo(0.5, 4);
    expect(grey[1]).toBeCloseTo(0.5, 4);
    expect(grey[2]).toBeCloseTo(0.5, 4);
  });

  it("Rec.709 primaries sit inside Rec.2020 (all components positive); Rec.2020 green leaves Rec.709 (negative)", () => {
    for (const p of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) for (const v of mul(BT709_TO_BT2020, p)) expect(v).toBeGreaterThanOrEqual(0);
    expect(mul(BT2020_TO_BT709, [0, 1, 0]).some((v) => v < 0)).toBe(true);
  });
});

describe("SDR tone mapping of HDR highlights", () => {
  const nitsToLinear = (n: number): number => n / 203;

  it("is monotonic and bounded by 1 from black to 10 000 nits", () => {
    let prev = -1;
    for (let nits = 0; nits <= 10000; nits += 5) {
      const y = toneMapLuminance(nitsToLinear(nits));
      expect(y).toBeGreaterThanOrEqual(prev);
      expect(y).toBeLessThanOrEqual(1);
      prev = y;
    }
  });

  it("never turns a bright pixel into NaN, including 1000+ nits and infinity", () => {
    for (const nits of [1000, 1500, 4000, 10000, 1e6, Infinity]) {
      const y = toneMapLuminance(nitsToLinear(nits));
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it("passes the SDR range through untouched below the knee", () => {
    for (const y of [0, 0.1, 0.5, 0.85]) expect(toneMapLuminance(y)).toBe(y);
  });

  it("a frame of 4000 nit pixels renders to finite, ordered 8-bit SDR codes", () => {
    const px = [0.1, 1, 5, 20, 49.3, 1e5];
    const data = new Float32Array(px.length * 4);
    px.forEach((v, i) => data.set([v, v, v, 1], i * 4));
    const frame: HdrFrame = { width: px.length, height: 1, data };
    const out = hdrFrameToSdrRgba(frame);
    let prev = -1;
    for (let i = 0; i < px.length; i++) {
      expect(out[i * 4]).toBeGreaterThanOrEqual(prev);
      prev = out[i * 4];
      expect(out[i * 4 + 3]).toBe(255);
    }
    expect(out[(px.length - 1) * 4]).toBe(255);
  });

  it("the CPU compositor object exists for the preview fallback", () => {
    expect(typeof CpuHdrCompositor).toBe("function");
  });
});

describe("HDR metadata: MaxCLL / MaxFALL", () => {
  const frameOf = (nitsPerPixel: number[]): Float32Array => {
    const out = new Float32Array(nitsPerPixel.length * 3);
    nitsPerPixel.forEach((n, i) => out.fill(pqEncodeNits(n), i * 3, i * 3 + 3));
    return out;
  };

  it("measures the largest component and the largest frame average", () => {
    const meter = new HdrLightLevelMeter();
    meter.add(frameOf([100, 100, 100, 100]));
    meter.add(frameOf([1000, 200, 100, 100])); // frame average 350
    meter.add(frameOf([10, 10, 10, 10]));
    const level = meter.result();
    expect(level).not.toBeNull();
    expect(Math.abs(level!.maxCll - 1000)).toBeLessThanOrEqual(2);
    expect(Math.abs(level!.maxFall - 350)).toBeLessThanOrEqual(3);
    expect(level!.frames).toBe(3);
  });

  it("uses max(R, G, B) per pixel", () => {
    const meter = new HdrLightLevelMeter();
    const rgb = new Float32Array([pqEncodeNits(50), pqEncodeNits(800), pqEncodeNits(20)]);
    meter.add(rgb);
    expect(Math.abs(meter.result()!.maxCll - 800)).toBeLessThanOrEqual(2);
  });

  it("is null before a frame and clamps to the 16-bit SEI range", () => {
    const meter = new HdrLightLevelMeter();
    expect(meter.result()).toBeNull();
    meter.add(new Float32Array([1, 1, 1]));
    expect(meter.result()!.maxCll).toBe(10000);
  });
});

describe("sequence colour space setting", () => {
  it("defaults to Rec.709 and never HDR without Rec.2020 working space", () => {
    expect(resolveSequenceColorSpace(undefined)).toBe("rec709");
    expect(resolveSequenceColorSpace({})).toBe("rec709");
    expect(resolveSequenceColorSpace({ sequenceColorSpace: "rec2100pq" })).toBe("rec709");
    expect(isHdrSequence({ workingColorSpace: "rec709", sequenceColorSpace: "rec2100hlg" })).toBe(false);
  });

  it("resolves PQ and HLG sequences with their export transfer and scope scale", () => {
    const pq = { workingColorSpace: "rec2020", sequenceColorSpace: "rec2100pq" } as const;
    const hlg = { workingColorSpace: "rec2020", sequenceColorSpace: "rec2100hlg" } as const;
    expect(sequenceHdrTransfer(pq)).toBe("pq");
    expect(sequenceHdrTransfer(hlg)).toBe("hlg");
    expect(sequenceScopeScale(pq)).toBe("pq");
    expect(sequenceScopeScale(hlg)).toBe("hlg");
    expect(sequenceScopeScale({})).toBe("ire");
    expect(sequenceHdrTransfer({ workingColorSpace: "rec2020" })).toBeUndefined();
  });

  it("patches move to HDR and back to the SDR default", () => {
    expect(sequenceColorSpacePatch("rec2100pq")).toEqual({ workingColorSpace: "rec2020", sequenceColorSpace: "rec2100pq" });
    expect(sequenceColorSpacePatch("rec709")).toEqual({ workingColorSpace: "rec709", sequenceColorSpace: undefined });
  });

  it("suggests a sequence from HDR source tags", () => {
    expect(suggestSequenceColorSpace([])).toBeNull();
    expect(suggestSequenceColorSpace([{ transfer: "bt709" }, null, undefined])).toBeNull();
    expect(suggestSequenceColorSpace([{ transfer: "pq" }, { transfer: "bt709" }])).toBe("rec2100pq");
    expect(suggestSequenceColorSpace([{ transfer: "hlg" }, { transfer: "hlg" }, { transfer: "pq" }])).toBe("rec2100hlg");
    expect(suggestSequenceColorSpace([{ transfer: "hlg" }, { transfer: "pq" }])).toBe("rec2100pq");
  });
});

describe("HDR scope feed (nits)", () => {
  it("encodes a float frame to PQ RGBA8 whose code reads back as nits", () => {
    const rgb = new Float32Array([pqEncodeNits(203), pqEncodeNits(203), pqEncodeNits(203), pqEncodeNits(1000), pqEncodeNits(1000), pqEncodeNits(1000)]);
    const frame = pqRgbToScopeFrame(rgb, 2, 1, 0);
    expect(frame.width).toBe(2);
    const code = (i: number): number => frame.data[i * 4] / 255;
    expect(signalToNits(code(0), "pq")).toBeGreaterThan(190);
    expect(signalToNits(code(0), "pq")).toBeLessThan(215);
    expect(signalToNits(code(1), "pq")).toBeGreaterThan(900);
    expect(signalToNits(code(1), "pq")).toBeLessThan(1100);
  });

  it("reads back the last completed frame lazily, and nothing while a frame is being composed", () => {
    const comp = new CpuHdrCompositor();
    comp.begin(2, 1);
    clearHdrScopeFrame();
    expect(getHdrScopeFrame()).toBeNull();
    publishHdrScopeFrame(comp, 2, 1, 0.5);
    const frame = getHdrScopeFrame();
    expect(frame?.width).toBe(2);
    expect(getHdrScopeFrame()).toBe(frame); // cached until the next frame
    beginHdrScopeFrame();
    expect(getHdrScopeFrame()).toBeNull();
    clearHdrScopeFrame();
  });
});
