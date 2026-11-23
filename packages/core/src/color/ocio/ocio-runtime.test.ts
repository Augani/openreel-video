import { describe, expect, it } from "vitest";
import { applyOps, OcioUnsupportedError } from "./ops";
import { loadFixtureConfig, readReference, type ReferenceCase } from "./test-support";

/**
 * The CPU reference of the OCIO runtime against real OpenColorIO (2.6): colour space conversions, look transforms and
 * display / view transforms of the ACES studio config, the cg config and a hand-made config with LUTs and CDLs, on a fixed
 * set of sample colours (see scripts/ocio/make-reference.py). OCIO evaluates in float32 with SSE approximations of
 * pow / log, so the tolerance is |d| <= ABS + REL * |reference|.
 */

const ABS = 1e-4;
const REL = 5e-4;

const ref = readReference();
const configs = { handmade: loadFixtureConfig("handmade"), studio: loadFixtureConfig("studio"), cg: loadFixtureConfig("cg") };

export function opsFor(k: ReferenceCase) {
  const { ctx } = configs[k.cfg];
  if (k.kind === "cs") return ctx.colorSpaceOps(k.a, k.b);
  if (k.kind === "look") return ctx.lookOps(k.a, k.b, k.c ?? "");
  return ctx.displayViewOps(k.a, k.b, k.c ?? "");
}

const label = (k: ReferenceCase): string => `${k.cfg} ${k.kind} ${k.a} -> ${k.b}${k.c ? ` [${k.c}]` : ""}`;

/** Conversions the runtime reports as unsupported instead of evaluating (and why), so the list is checked, not assumed. */
const KNOWN_UNSUPPORTED: ReadonlyArray<[RegExp, RegExp]> = [
  [/Linear -> (Film Scan|Cinespace$)/, /inverse of a 3D LUT/],
  [/Cinespace Curved Prelut/, /pre-LUT is a curve/],
  [/RGB To HSV/, /RGB_TO_HSV/],
  [/FF RedMod03 Unsupported/, /ACES_RedMod03/],
  [/Uses Grading/, /ExposureContrastTransform/],
  [/ADX1[06]/, /table inside OpenColorIO/],
  [/CanonLog[23]/, /table inside OpenColorIO/],
  [/\[ACES 1\.[01] - (SDR|HDR) .*\]/, /not implemented/],
  [/\[ACES 1\.0 - SDR Cinema/, /not implemented/],
  [/\[ACES 1\.1 - HDR Video \((2000|4000) nits|\[ACES 1\.1 - HDR Video \(1000 nits & P3|\[ACES 1\.1 - HDR Cinema/, /not implemented/],
  [/ACEScg -> ACEScc/, /ACEScc|inverse/],
];

describe("OCIO runtime CPU reference vs OpenColorIO", () => {
  it("has the reference data of the expected size", () => {
    expect(ref.ocioVersion).toMatch(/^2\./);
    expect(ref.cases.length).toBeGreaterThan(250);
  });

  const stats = { compared: 0, unsupported: 0, worstRel: 0, worstAbs: 0 };

  for (const k of ref.cases) {
    it(label(k), () => {
      const input = ref.inputs[k.in];
      let ops;
      try {
        ops = opsFor(k);
        // Evaluating is part of "supported": an op without an evaluator throws on first use.
        applyOps(ops, [0.1, 0.2, 0.3]);
      } catch (error) {
        expect(error).toBeInstanceOf(OcioUnsupportedError);
        const known = KNOWN_UNSUPPORTED.find(([name, reason]) => name.test(label(k)) && reason.test((error as Error).message));
        expect(known, `${label(k)}: unexpected unsupported reason "${(error as Error).message}"`).toBeDefined();
        stats.unsupported++;
        return;
      }
      // BT.1886 is a plain 1 / 2.4 power: float32 noise of 1e-9 around black becomes 1e-4 in code values.
      const absTol = /Rec\.1886/.test(label(k)) ? 3e-4 : ABS;
      let worst = 0;
      let at = -1;
      for (let i = 0; i < input.length / 3; i++) {
        const c = [input[i * 3], input[i * 3 + 1], input[i * 3 + 2]];
        applyOps(ops, c);
        for (let ch = 0; ch < 3; ch++) {
          const want = k.out[i * 3 + ch];
          if (!Number.isFinite(want) || !Number.isFinite(c[ch])) {
            // Both must be non-finite in the same way (e.g. a log of a negative number).
            expect(String(c[ch]), `${label(k)} sample ${i} channel ${ch}`).toBe(String(want));
            continue;
          }
          const d = Math.abs(c[ch] - want);
          const excess = d - (absTol + REL * Math.abs(want));
          if (excess > worst) {
            worst = excess;
            at = i;
          }
          stats.worstAbs = Math.max(stats.worstAbs, d);
          stats.worstRel = Math.max(stats.worstRel, d / Math.max(Math.abs(want), 1));
        }
      }
      stats.compared++;
      expect(worst, `${label(k)} sample ${at}`).toBeLessThanOrEqual(0);
    });
  }

  it("evaluated most of the cases (the rest are the listed unsupported ones)", () => {
    expect(stats.compared).toBeGreaterThan(230);
    expect(stats.compared + stats.unsupported).toBe(ref.cases.length);
    // eslint-disable-next-line no-console
    console.log(`OCIO parity: ${stats.compared} cases compared, ${stats.unsupported} reported unsupported; worst |d| ${stats.worstAbs.toExponential(2)}, worst relative (denominator max(|ref|,1)) ${stats.worstRel.toExponential(2)}`);
  });
});
