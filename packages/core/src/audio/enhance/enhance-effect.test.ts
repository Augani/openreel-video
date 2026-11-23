import { describe, expect, it } from "vitest";
import {
  ENHANCE_SPEECH_EFFECT_TYPE,
  createEnhanceSpeechEffect,
  getEnhanceSpeechBalance,
  getEnhanceSpeechMix,
  hasEnhanceSpeech,
  mixDryWet,
  planEnhanceSpeechAction,
  planEnhanceSpeechChange,
  remixSpeechBackground,
  sanitizeEnhanceBalance,
  speechBackgroundGains,
  sanitizeEnhanceMix,
  withoutEnhanceSpeech,
} from "./enhance-effect";

const ids = { actionId: "act", effectId: "fx" };

describe("enhanceSpeech effect model", () => {
  it("sanitises Mix to 0..100 and defaults to fully enhanced", () => {
    expect(sanitizeEnhanceMix(undefined)).toBe(100);
    expect(sanitizeEnhanceMix("50")).toBe(100);
    expect(sanitizeEnhanceMix(Number.NaN)).toBe(100);
    expect(sanitizeEnhanceMix(-5)).toBe(0);
    expect(sanitizeEnhanceMix(250)).toBe(100);
    expect(sanitizeEnhanceMix(33.349)).toBe(33.3);
  });

  it("reads the last enabled effect's mix and ignores disabled or unrelated ones", () => {
    expect(getEnhanceSpeechMix(undefined)).toBe(0);
    expect(getEnhanceSpeechMix([{ type: "gain", params: { mix: 10 } }])).toBe(0);
    expect(getEnhanceSpeechMix([createEnhanceSpeechEffect("a", 40), createEnhanceSpeechEffect("b", 70)])).toBe(70);
    expect(getEnhanceSpeechMix([createEnhanceSpeechEffect("a", 40), { ...createEnhanceSpeechEffect("b", 70), enabled: false }])).toBe(40);
    expect(hasEnhanceSpeech([createEnhanceSpeechEffect("a", 0)])).toBe(false);
    expect(hasEnhanceSpeech([createEnhanceSpeechEffect("a", 1)])).toBe(true);
    expect(withoutEnhanceSpeech([createEnhanceSpeechEffect("a"), { id: "g", type: "gain", enabled: true, params: {} }]).map((e) => e.type)).toEqual(["gain"]);
  });

  it("blends dry and wet linearly, returning the very arrays at 0 and 100", () => {
    const dry = [Float32Array.of(1, 1, 1), Float32Array.of(0, 0, 0)];
    const wet = [Float32Array.of(0, 0, 0), Float32Array.of(2, 2, 2)];
    expect(mixDryWet(dry, wet, 0)[0]).toBe(dry[0]);
    expect(mixDryWet(dry, wet, 100)[1]).toBe(wet[1]);
    const half = mixDryWet(dry, wet, 50);
    expect(Array.from(half[0])).toEqual([0.5, 0.5, 0.5]);
    expect(Array.from(half[1])).toEqual([1, 1, 1]);
    expect(Array.from(mixDryWet(dry, [wet[0]], 25)[1])).toEqual([0, 0, 0].map((v) => v + (0 - v) * 0.25));
  });

  it("plans one undoable action: add, replace, remove, or nothing", () => {
    const empty = { id: "c", audioEffects: [] };
    const add = planEnhanceSpeechAction(empty, 80, ids, 1);
    expect(add).toMatchObject({ type: "audio/addEffect", params: { clipId: "c", effect: { id: "fx", type: ENHANCE_SPEECH_EFFECT_TYPE, enabled: true, params: { mix: 80 } } } });
    const withFx = { id: "c", audioEffects: [createEnhanceSpeechEffect("e1", 80)] };
    expect(planEnhanceSpeechAction(withFx, 80, ids)).toBeNull();
    expect(planEnhanceSpeechAction(withFx, 30, ids)).toMatchObject({ type: "audio/replaceEffect", params: { effectId: "e1", effect: { params: { mix: 30 } } } });
    expect(planEnhanceSpeechAction({ id: "c", audioEffects: [{ ...createEnhanceSpeechEffect("e1", 80), enabled: false }] }, 80, ids)).toMatchObject({ type: "audio/replaceEffect", params: { effect: { enabled: true } } });
    expect(planEnhanceSpeechAction(withFx, null, ids)).toMatchObject({ type: "audio/removeEffect", params: { effectId: "e1" } });
    expect(planEnhanceSpeechAction(empty, null, ids)).toBeNull();
  });
});

describe("Speech / Background balance", () => {
  const clipWith = (params: Record<string, unknown>) => ({ id: "c", audioEffects: [{ id: "es", type: "enhanceSpeech", enabled: true, params }] }) as never;

  it("defaults to speech only, sanitizes, and maps to stem gains", () => {
    expect(getEnhanceSpeechBalance(undefined)).toBe(100);
    expect(getEnhanceSpeechBalance([{ type: "enhanceSpeech", params: { mix: 80 } }])).toBe(100);
    expect(getEnhanceSpeechBalance([{ type: "enhanceSpeech", params: { balance: 30 } }])).toBe(30);
    expect(getEnhanceSpeechBalance([{ type: "enhanceSpeech", enabled: false, params: { balance: 30 } }])).toBe(100);
    expect(sanitizeEnhanceBalance(Number.NaN)).toBe(100);
    expect(sanitizeEnhanceBalance(-5)).toBe(0);
    expect(sanitizeEnhanceBalance(250)).toBe(100);
    expect(speechBackgroundGains(100)).toEqual({ speech: 1, background: 0 });
    expect(speechBackgroundGains(50)).toEqual({ speech: 1, background: 1 });
    expect(speechBackgroundGains(0)).toEqual({ speech: 0, background: 1 });
    expect(speechBackgroundGains(75)).toEqual({ speech: 1, background: 0.5 });
    expect(speechBackgroundGains(25)).toEqual({ speech: 0.5, background: 1 });
  });

  it("remixes speech and background = original - enhanced; 100 returns the enhanced arrays themselves", () => {
    const dry = [Float32Array.from([1, 2, 3, 4])];
    const wet = [Float32Array.from([0.5, 1, 1.5, 2])];
    expect(remixSpeechBackground(dry, wet, 100)[0]).toBe(wet[0]);
    expect(Array.from(remixSpeechBackground(dry, wet, 50)[0])).toEqual([1, 2, 3, 4]);
    expect(Array.from(remixSpeechBackground(dry, wet, 0)[0])).toEqual([0.5, 1, 1.5, 2]);
    expect(Array.from(remixSpeechBackground(dry, wet, 75)[0])).toEqual([0.75, 1.5, 2.25, 3]);
    expect(Array.from(remixSpeechBackground(dry, wet, 25)[0])).toEqual([0.5, 1, 1.5, 2].map((v, i) => 0.5 * v + (dry[0][i] - v)));
  });

  it("stores the balance only when it is not the default, so old projects keep exactly the params they had", () => {
    expect(createEnhanceSpeechEffect("e", 80).params).toEqual({ mix: 80 });
    expect(createEnhanceSpeechEffect("e", 80, 100).params).toEqual({ mix: 80 });
    expect(createEnhanceSpeechEffect("e", 80, 40).params).toEqual({ mix: 80, balance: 40 });
  });

  it("plans one action: adds the effect with a balance, keeps Mix when only the balance changes and the balance when only Mix changes, drops a default balance, null when nothing changes", () => {
    const added = planEnhanceSpeechChange({ id: "c", audioEffects: [] } as never, { balance: 20 }, ids);
    expect(added).toMatchObject({ type: "audio/addEffect", params: { effect: { params: { mix: 100, balance: 20 } } } });
    expect(planEnhanceSpeechChange(clipWith({ mix: 60 }), { balance: 20 }, ids)).toMatchObject({ type: "audio/replaceEffect", params: { effect: { params: { mix: 60, balance: 20 } } } });
    expect(planEnhanceSpeechAction(clipWith({ mix: 60, balance: 20 }), 90, ids)).toMatchObject({ params: { effect: { params: { mix: 90, balance: 20 } } } });
    expect(planEnhanceSpeechChange(clipWith({ mix: 60, balance: 20 }), { balance: 100 }, ids)).toMatchObject({ params: { effect: { params: { mix: 60 } } } });
    expect(((planEnhanceSpeechChange(clipWith({ mix: 60, balance: 20 }), { balance: 100 }, ids) as unknown) as { params: { effect: { params: object } } }).params.effect.params).not.toHaveProperty("balance");
    expect(planEnhanceSpeechChange(clipWith({ mix: 60, balance: 20 }), { balance: 20 }, ids)).toBeNull();
    expect(planEnhanceSpeechChange(clipWith({ mix: 60 }), { balance: 100 }, ids)).toBeNull();
    expect(planEnhanceSpeechChange(clipWith({ mix: 60, balance: 20 }), { mix: null }, ids)).toMatchObject({ type: "audio/removeEffect" });
  });
});
