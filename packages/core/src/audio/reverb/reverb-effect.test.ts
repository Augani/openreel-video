import { describe, expect, it } from "vitest";
import {
  REDUCE_REVERB_EFFECT_TYPE,
  createReduceReverbEffect,
  getReduceReverbParams,
  hasReduceReverb,
  planReduceReverbAction,
  sanitizeReduceReverbParams,
  withoutReduceReverb,
} from "./reverb-effect";

const ids = { actionId: "act", effectId: "fx" };
const clipWith = (params: Record<string, unknown>, enabled = true) => ({ id: "c", audioEffects: [{ id: "rr", type: REDUCE_REVERB_EFFECT_TYPE, enabled, params }] }) as never;

describe("reduceReverb effect model", () => {
  it("sanitises Amount and Sensitivity to 0..100 with defaults 60 and 50", () => {
    expect(sanitizeReduceReverbParams(undefined)).toEqual({ amount: 60, sensitivity: 50 });
    expect(sanitizeReduceReverbParams({ amount: -4, sensitivity: 400 })).toEqual({ amount: 0, sensitivity: 100 });
    expect(sanitizeReduceReverbParams({ amount: "lots", sensitivity: Number.NaN })).toEqual({ amount: 60, sensitivity: 50 });
    expect(sanitizeReduceReverbParams({ amount: 33.349 }).amount).toBe(33.3);
  });

  it("reads the last enabled effect and treats Amount 0, disabled and unrelated effects as off", () => {
    expect(getReduceReverbParams(undefined)).toBeNull();
    expect(getReduceReverbParams([{ type: "gain", params: { amount: 10 } }])).toBeNull();
    expect(getReduceReverbParams([createReduceReverbEffect("a", 40, 10), createReduceReverbEffect("b", 70, 90)])).toEqual({ amount: 70, sensitivity: 90 });
    expect(getReduceReverbParams([createReduceReverbEffect("a", 40), { ...createReduceReverbEffect("b", 70), enabled: false }])).toEqual({ amount: 40, sensitivity: 50 });
    expect(hasReduceReverb([createReduceReverbEffect("a", 0)])).toBe(false);
    expect(hasReduceReverb([createReduceReverbEffect("a", 1)])).toBe(true);
  });

  it("removes only its own entries from a chain", () => {
    const chain = [{ type: "gain" }, createReduceReverbEffect("a"), { type: "enhanceSpeech" }];
    expect(withoutReduceReverb(chain).map((e) => e.type)).toEqual(["gain", "enhanceSpeech"]);
  });

  it("plans ONE action: add, replace (keeping what is not given), remove, and null when nothing changes", () => {
    expect(planReduceReverbAction({ id: "c", audioEffects: [] } as never, {}, ids)).toMatchObject({ type: "audio/addEffect", params: { clipId: "c", effect: { type: "reduceReverb", params: { amount: 60, sensitivity: 50 } } } });
    expect(planReduceReverbAction({ id: "c", audioEffects: [] } as never, { amount: 90 }, ids)).toMatchObject({ params: { effect: { params: { amount: 90, sensitivity: 50 } } } });
    expect(planReduceReverbAction(clipWith({ amount: 60, sensitivity: 50 }), { sensitivity: 20 }, ids)).toMatchObject({ type: "audio/replaceEffect", params: { effectId: "rr", effect: { params: { amount: 60, sensitivity: 20 } } } });
    expect(planReduceReverbAction(clipWith({ amount: 60, sensitivity: 50 }), { amount: 60, sensitivity: 50 }, ids)).toBeNull();
    expect(planReduceReverbAction(clipWith({ amount: 60, sensitivity: 50 }, false), { amount: 60 }, ids)).toMatchObject({ type: "audio/replaceEffect", params: { effect: { enabled: true } } });
    expect(planReduceReverbAction(clipWith({ amount: 60, sensitivity: 50 }), null, ids)).toMatchObject({ type: "audio/removeEffect", params: { effectId: "rr" } });
    expect(planReduceReverbAction({ id: "c", audioEffects: [] } as never, null, ids)).toBeNull();
  });
});
