import { describe, expect, it } from "vitest";
import { ACES_REFERENCE as reference } from "./fixtures/aces-ocio-reference";
import {
  acescctDecode,
  acescctEncode,
  acesccEncode,
  acesOutputForExport,
  AP0_TO_AP1,
  AP1_TO_AP0,
  AP1_TO_XYZ,
  D60_TO_D65,
  gamutToAp0,
  gamutToAp1,
  type AcesOutputId,
} from "./aces";
import {
  acesOutputTransform,
  acesToHdr1000Nits,
  displayNitsToHlg,
  HDR_1000_SPLINE,
  initTsParams,
  nitsToPq,
  ODT_48_SPLINE,
  RRT_SPLINE,
  splineForward,
  splineInverse,
} from "./aces-output";
import { gamutDef } from "./camera-log";

const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const closeMatrix = (a: readonly (readonly number[])[], b: readonly (readonly number[])[], tol: number) => {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(a[i][j], b[i][j], tol);
};

describe("ACES matrices (published constants)", () => {
  it("AP0 -> AP1 and back match S-2014-004 / the ACES CTL", () => {
    closeMatrix(
      AP0_TO_AP1,
      [
        [1.4514393161, -0.2365107469, -0.2149285693],
        [-0.0765537734, 1.1762296998, -0.0996759264],
        [0.0083161484, -0.0060324498, 0.9977163014],
      ],
      2e-9,
    );
    closeMatrix(
      AP1_TO_AP0,
      [
        [0.6954522414, 0.1406786965, 0.1638690622],
        [0.0447945634, 0.8596711185, 0.0955343182],
        [-0.0055258826, 0.004025210306, 1.001500672],
      ],
      2e-9,
    );
  });

  it("AP1 -> XYZ matches the published ACEScg matrix", () => {
    closeMatrix(
      AP1_TO_XYZ,
      [
        [0.6624541811, 0.1340042065, 0.1561876870],
        [0.2722287168, 0.6740817658, 0.0536895174],
        [-0.0055746495, 0.0040607335, 1.0103391003],
      ],
      2e-9,
    );
  });

  it("the Bradford D60 -> D65 adaptation is the CTL's D60_2_D65_CAT", () => {
    closeMatrix(
      D60_TO_D65,
      [
        [0.9872240, -0.0061132, 0.0159533],
        [-0.0075983, 1.0018614, 0.0053300],
        [0.0030726, -0.0050959, 1.0816806],
      ],
      1e-6,
    );
  });

  it("ACEScg -> linear Rec.709 equals the OCIO builtin (AP1_to_LINEAR-REC709_BFD)", () => {
    // gamutToAp1("rec709") is Rec.709 -> ACEScg; its inverse is OCIO's matrix.
    const m = gamutToAp1("rec709");
    const det = (a: readonly (readonly number[])[]) =>
      a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
    expect(det(m)).toBeGreaterThan(0);
    // Round trip through the OCIO matrix is the identity.
    const ocio = reference.matrices.ap1ToRec709;
    const product = [0, 1, 2].map((i) => [0, 1, 2].map((j) => ocio[i][0] * m[0][j] + ocio[i][1] * m[1][j] + ocio[i][2] * m[2][j]));
    closeMatrix(product, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 2e-6);
    // And the familiar published numbers.
    close(ocio[0][0], 1.70505, 1e-5);
    close(ocio[1][1], 1.14080, 1e-5);
  });

  it("gamut -> ACEScg matrices agree with colour-science (Bradford) for every standard and camera gamut", () => {
    for (const [key, expected] of Object.entries(reference.matrices.toAcescg)) {
      // Blackmagic Wide Gamut: colour-science rounds the primaries to 4 digits, ours are the published 7.
      closeMatrix(gamutToAp1(key as never), expected as number[][], key === "bmdwg" ? 2e-3 : 5e-6);
    }
  });

  it("white maps to equal ACES values (the adaptation preserves white)", () => {
    for (const id of ["rec709", "p3", "bt2020", "sgamut3cine", "vgamut", "awg3", "awg4", "cinemagamut", "bmdwg"] as const) {
      for (const m of [gamutToAp1(id), gamutToAp0(id)]) {
        const w = [m[0][0] + m[0][1] + m[0][2], m[1][0] + m[1][1] + m[1][2], m[2][0] + m[2][1] + m[2][2]];
        close(w[0], 1, 1e-5);
        close(w[1], 1, 1e-5);
        close(w[2], 1, 1e-5);
      }
    }
    // AP0 and AP1 share the ACES white, so ACES2065-1 <-> ACEScg is not adapted.
    expect(gamutDef("ap1").white).toEqual(gamutDef("ap0").white);
  });
});

describe("ACEScct / ACEScc", () => {
  it("matches the published anchors", () => {
    close(acescctEncode(0.18), 0.4135884, 1e-6);
    close(acesccEncode(0.18), 0.4135884, 1e-6);
    close(acescctEncode(0), 0.0729055341958355, 1e-12);
    // The toe is linear up to 0.0078125 and the curves meet there.
    close(acescctEncode(0.0078125), 0.155251141552511, 1e-12);
    close(acescctEncode(1), 0.5547945205, 1e-8);
    // ACEScct 1.0 is scene linear ~ 222.9 (the top of the 17.52 stop range).
    close(acescctDecode(1), Math.pow(2, 17.52 - 9.72), 1e-9);
  });

  it("decode inverts encode across the toe and the log segment, and is continuous at the join", () => {
    for (const x of [-0.002, 0, 0.0001, 0.003, 0.0078125, 0.0079, 0.05, 0.18, 1, 16, 222]) {
      close(acescctDecode(acescctEncode(x)), x, Math.max(1e-9, Math.abs(x) * 1e-9));
    }
    close(acescctEncode(0.0078125), acescctEncode(0.0078125 + 1e-12), 1e-9);
  });
});

describe("splines", () => {
  it("the RRT c5 spline is anchored at the published points", () => {
    close(splineForward(0.18, RRT_SPLINE), 4.8, 1e-6);
    close(splineForward(0.18 * 2 ** -15, RRT_SPLINE), 0.0001, 1e-9);
    close(splineForward(0.18 * 2 ** 18, RRT_SPLINE), 10000, 1e-3);
  });

  it("the ODT c9 spline maps the RRT output stops to 0.02, 4.8 and 48 nits", () => {
    close(splineForward(ODT_48_SPLINE.minX, ODT_48_SPLINE), 0.02, 1e-6);
    close(splineForward(ODT_48_SPLINE.midX, ODT_48_SPLINE), 4.8, 1e-6);
    close(splineForward(ODT_48_SPLINE.maxX, ODT_48_SPLINE), 48, 1e-4);
  });

  it("the HDR tone scale puts 18% grey at 15 nits and the top stop at 1000", () => {
    close(splineForward(0.18, HDR_1000_SPLINE), 15, 5e-3);
    close(splineForward(HDR_1000_SPLINE.maxX, HDR_1000_SPLINE), 1000, 1e-3);
  });

  it("inverse undoes forward inside each segment", () => {
    for (const p of [RRT_SPLINE, ODT_48_SPLINE, HDR_1000_SPLINE, initTsParams(0.0001, 100)]) {
      for (const x of [p.minX * 1.5, p.minX * 8, p.midX * 0.3, p.midX, p.midX * 2, p.maxX * 0.01, p.maxX * 0.4]) {
        const y = splineForward(x, p);
        close(splineInverse(y, p) / x, 1, 1e-6);
      }
    }
  });
});

const SDR_IDS: AcesOutputId[] = ["srgb", "rec709"];

describe("Output Transform: SDR (RRT + ODT) against the OCIO ACES 1.3 builtin", () => {
  it("matches sRGB display codes on 68 scene-referred colours, neutrals and saturated reds included", () => {
    reference.acescg.forEach((p, i) => {
      const out = acesOutputTransform(p[0], p[1], p[2], "srgb");
      for (let c = 0; c < 3; c++) close(out[c], reference.srgb[i][c], 2e-5);
    });
  });

  it("matches BT.1886 (Rec.709) display codes", () => {
    reference.acescg.forEach((p, i) => {
      const out = acesOutputTransform(p[0], p[1], p[2], "rec709");
      // The reference is float32 near black, where the 1/2.4 power amplifies the quantisation of the linear value.
      for (let c = 0; c < 3; c++) close(out[c], reference.rec709[i][c], 5e-4);
    });
  });

  it("is anchored at known renderings: 0 -> 0, 18% grey -> sRGB 0.356, ACES 1.0 -> 0.812", () => {
    const grey = acesOutputTransform(0.18, 0.18, 0.18, "srgb");
    close(grey[0], 0.35595, 1e-4);
    const white = acesOutputTransform(1, 1, 1, "srgb");
    close(white[0], 0.81197, 1e-4);
    const black = acesOutputTransform(0, 0, 0, "srgb");
    expect(Math.max(...black)).toBeLessThan(1e-3);
  });

  it("is monotonic along the neutral axis and bounded to 0..1", () => {
    for (const id of SDR_IDS) {
      let previous = -1;
      for (let stop = -12; stop <= 8; stop += 0.25) {
        const v = 0.18 * 2 ** stop;
        const [r, g, b] = acesOutputTransform(v, v, v, id);
        expect(r).toBeGreaterThanOrEqual(previous);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
        close(r, g, 1e-4);
        close(r, b, 1e-4);
        previous = r;
      }
    }
  });

  it("clamps out-of-gamut and negative scene values instead of producing NaN or values outside 0..1", () => {
    for (const p of [[-0.1, 0.2, 0.3], [5, -2, -1], [1e6, 0, 0], [0, 0, 1e-12], [65504, 65504, 65504]]) {
      for (const id of SDR_IDS) {
        const out = acesOutputTransform(p[0], p[1], p[2], id);
        for (const v of out) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("Output Transform: Rec.2020 PQ 1000 nit and HLG", () => {
  it("matches the OCIO HDR-VIDEO-1000nit-15nit-REC2020lim builtin in display nits (relative 1e-3)", () => {
    reference.acescg.forEach((p, i) => {
      const m = AP1_TO_AP0;
      const nits = [0, 0, 0];
      acesToHdr1000Nits(
        m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2],
        m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2],
        m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2],
        nits,
      );
      for (let c = 0; c < 3; c++) {
        const ref = reference.hdrNits[i][c];
        close(nits[c], ref, Math.max(0.01, ref * 1e-3));
      }
    });
  });

  it("18% grey lands at 15 nits and the PQ signal is the ST 2084 inverse EOTF of the luminance", () => {
    const pq = acesOutputTransform(0.18, 0.18, 0.18, "rec2020-pq");
    close(pq[0], nitsToPq(15), 1e-4);
    // ST 2084 anchors: 1000 nits = 0.7518, 203 nits = 0.5807, 10000 = 1.
    close(nitsToPq(1000), 0.751827, 1e-5);
    close(nitsToPq(203), 0.580691, 1e-5);
    close(nitsToPq(10000), 1, 1e-9);
    expect(nitsToPq(0)).toBeLessThan(1e-6);
  });

  it("HLG signal of the same display light: 203 nits -> 0.75 and 1000 nits -> 1.0 (BT.2100, 1000 nit display)", () => {
    const out = [0, 0, 0];
    displayNitsToHlg(203, 203, 203, out);
    close(out[0], 0.75, 5e-3);
    displayNitsToHlg(1000, 1000, 1000, out);
    close(out[0], 1, 1e-6);
    displayNitsToHlg(0, 0, 0, out);
    expect(out).toEqual([0, 0, 0]);
  });

  it("HLG output of the transform is the HLG encoding of the PQ output's luminance", () => {
    const rgb = [0.4, 0.2, 0.1] as const;
    const nits = [0, 0, 0];
    const m = AP1_TO_AP0;
    acesToHdr1000Nits(
      m[0][0] * rgb[0] + m[0][1] * rgb[1] + m[0][2] * rgb[2],
      m[1][0] * rgb[0] + m[1][1] * rgb[1] + m[1][2] * rgb[2],
      m[2][0] * rgb[0] + m[2][1] * rgb[1] + m[2][2] * rgb[2],
      nits,
    );
    const expected = [0, 0, 0];
    displayNitsToHlg(nits[0], nits[1], nits[2], expected);
    const got = acesOutputTransform(rgb[0], rgb[1], rgb[2], "rec2020-hlg");
    for (let c = 0; c < 3; c++) close(got[c], expected[c], 1e-9);
  });

  it("the peak of the 1000 nit transform stays at or below 1000 nits and bright scene values compress, not clip", () => {
    const hi = [0, 0, 0];
    acesToHdr1000Nits(...(AP1_TO_AP0.map((row) => row[0] * 100 + row[1] * 100 + row[2] * 100) as [number, number, number]), hi);
    expect(hi[0]).toBeLessThanOrEqual(1000.0001);
    const mid = [0, 0, 0];
    acesToHdr1000Nits(...(AP1_TO_AP0.map((row) => row[0] * 4 + row[1] * 4 + row[2] * 4) as [number, number, number]), mid);
    expect(hi[0]).toBeGreaterThan(mid[0]);
  });
});

describe("export output selection", () => {
  it("HDR exports pick the Rec.2020 transforms, SDR exports the project's SDR transform", () => {
    expect(acesOutputForExport({ colorManagement: "aces" }, "pq")).toBe("rec2020-pq");
    expect(acesOutputForExport({ colorManagement: "aces" }, "hlg")).toBe("rec2020-hlg");
    expect(acesOutputForExport({ colorManagement: "aces" }, undefined)).toBe("srgb");
    expect(acesOutputForExport({ colorManagement: "aces", acesOutput: "rec709" }, undefined)).toBe("rec709");
  });
});
