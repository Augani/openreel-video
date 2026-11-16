import { describe, expect, it } from "vitest";
import type { Effect, Track } from "../types";
import {
  createTaggedEffect,
  DEFAULT_ESSENTIAL_SOUND_OPTIONS,
  isUserEdited,
  loudnessTargetFor,
  mergeDuckingLanes,
  paramsSignature,
  planEssentialSound,
  reconcileEssentialEffects,
  resolveAudioType,
  resolveEssentialDucking,
  duckingSettingsFor,
} from "./essential-sound";

const ALL_ON = { ...DEFAULT_ESSENTIAL_SOUND_OPTIONS, repair: true };
const keysOf = (type: Parameters<typeof planEssentialSound>[0], options = ALL_ON) =>
  planEssentialSound(type, options).effectChain.map((e) => `${e.type}:${e.key}`);

describe("planEssentialSound", () => {
  it("returns the documented loudness targets per type", () => {
    expect(planEssentialSound("dialogue", ALL_ON).loudnessTarget).toBe(-16);
    expect(planEssentialSound("music", ALL_ON).loudnessTarget).toBe(-23);
    expect(planEssentialSound("sfx", ALL_ON).loudnessTarget).toBe(-20);
    expect(planEssentialSound("ambience", ALL_ON).loudnessTarget).toBe(-28);
    expect(loudnessTargetFor("music", { dialogueTargetLufs: -18 })).toBe(-25);
  });

  it("returns the documented effect chain per type", () => {
    expect(keysOf("dialogue")).toEqual([
      "eq:rumble",
      "noiseReduction:noise",
      "eq:dialogue-eq",
      "compressor:dialogue-compressor",
    ]);
    expect(keysOf("music")).toEqual(["eq:music-scoop"]);
    expect(keysOf("sfx")).toEqual(["brickwallLimiter:sfx-limiter"]);
    expect(keysOf("ambience")).toEqual(["lowPass:ambience-lowpass"]);
    const dialogue = planEssentialSound("dialogue", ALL_ON).effectChain.find((e) => e.key === "dialogue-eq")!;
    const bands = (dialogue.params as { bands: { type: string; frequency: number; gain: number }[] }).bands;
    expect(bands[0]).toMatchObject({ type: "highpass", frequency: 80 });
    expect(bands[1]).toMatchObject({ type: "peaking", frequency: 3000 });
    expect(bands[1].gain).toBeGreaterThan(0);
    const limiter = planEssentialSound("sfx", ALL_ON).effectChain[0].params as { ceiling: number; release: number };
    expect(limiter.ceiling).toBeLessThanOrEqual(-3);
    expect(limiter.ceiling).toBeGreaterThanOrEqual(-9);
  });

  it("repair is opt-in and dialogue only", () => {
    expect(keysOf("dialogue", { ...ALL_ON, repair: false })).toEqual(["eq:dialogue-eq", "compressor:dialogue-compressor"]);
    expect(keysOf("music")).not.toContain("noiseReduction:noise");
    expect(keysOf("dialogue", { ...ALL_ON, reduceNoise: false })).not.toContain("noiseReduction:noise");
  });

  it("every option toggles independently and reversibly", () => {
    const off = planEssentialSound("dialogue", { ...ALL_ON, loudness: false, clarity: false, repair: false, ducking: false });
    expect(off.loudnessTarget).toBeNull();
    expect(off.effectChain).toEqual([]);
    const on = planEssentialSound("dialogue", ALL_ON);
    const backOn = planEssentialSound("dialogue", { ...ALL_ON, clarity: true });
    expect(backOn).toEqual(on);
  });

  it("clarity amount scales the preset", () => {
    const gain = (amount: number) =>
      ((planEssentialSound("music", { ...ALL_ON, clarityAmount: amount }).effectChain[0].params as { bands: { gain: number }[] }).bands[0].gain);
    expect(gain(1)).toBeLessThan(gain(0));
  });

  it("never ducks dialogue; ducks the other types only when the option is on", () => {
    expect(planEssentialSound("dialogue", ALL_ON).ducking).toMatchObject({ enabled: false });
    expect(planEssentialSound("dialogue", ALL_ON).ducking.reason).toMatch(/never ducked/i);
    for (const type of ["music", "sfx", "ambience"] as const) {
      expect(planEssentialSound(type, ALL_ON).ducking).toMatchObject({ enabled: true, againstTrackRoles: ["dialogue"], amountDb: 12, fadeMs: 300 });
      expect(planEssentialSound(type, { ...ALL_ON, ducking: false }).ducking.enabled).toBe(false);
    }
  });

  it("turns a measurement into the existing clip-normalization action", () => {
    const clip = { id: "c1", volume: 0.5, automation: undefined };
    const plan = planEssentialSound("dialogue", ALL_ON, { integrated: -26, truePeak: -10 }, clip);
    expect(plan.normalization?.requestedGainDb).toBeCloseTo(10);
    expect(plan.normalization?.action).toMatchObject({ type: "audio/setVolume", params: { clipId: "c1" } });
    expect(planEssentialSound("dialogue", ALL_ON, { integrated: -Infinity, truePeak: -Infinity }, clip).normalization?.silent).toBe(true);
  });
});

describe("tagged effects", () => {
  let counter = 0;
  const realise = (plan: ReturnType<typeof planEssentialSound>): Effect[] =>
    plan.effectChain.map((planned) => createTaggedEffect(planned, `fx-${++counter}`));

  it("an empty clip gets everything added, and reconciling again does nothing", () => {
    const plan = planEssentialSound("dialogue", ALL_ON);
    const first = reconcileEssentialEffects([], plan.effectChain, ["repair", "clarity"]);
    expect(first.add).toHaveLength(plan.effectChain.length);
    const chain = realise(plan);
    const second = reconcileEssentialEffects(chain, plan.effectChain, ["repair", "clarity"]);
    expect(second).toEqual({ add: [], replace: [], remove: [], keptUserEdited: [] });
  });

  it("changing the amount updates only the owned effect in place", () => {
    const chain = realise(planEssentialSound("music", { ...ALL_ON, clarityAmount: 0.2 }));
    const next = planEssentialSound("music", { ...ALL_ON, clarityAmount: 0.9 });
    const result = reconcileEssentialEffects(chain, next.effectChain, ["clarity"]);
    expect(result.add).toEqual([]);
    expect(result.replace).toEqual([{ effectId: chain[0].id, planned: next.effectChain[0] }]);
  });

  it("toggling a block off removes exactly the effects the panel added and leaves the user's own", () => {
    const own: Effect = { id: "user-eq", type: "eq", enabled: true, params: { bands: [] } };
    const chain = [own, ...realise(planEssentialSound("dialogue", ALL_ON))];
    const off = reconcileEssentialEffects(chain, [], ["clarity"]);
    expect(off.remove).toHaveLength(2);
    expect(off.remove).not.toContain("user-eq");
    const repairStays = chain.filter((e) => e.metadata?.essentialSound?.block === "repair").map((e) => e.id);
    expect(off.remove.some((id) => repairStays.includes(id))).toBe(false);
  });

  it("never overwrites or silently removes an effect the user edited", () => {
    const plan = planEssentialSound("music", ALL_ON);
    const [mine] = realise(plan);
    const edited: Effect = { ...mine, params: { bands: [{ type: "peaking", frequency: 900, gain: -9, q: 1 }] } };
    expect(isUserEdited(edited)).toBe(true);
    const retarget = planEssentialSound("music", { ...ALL_ON, clarityAmount: 1 });
    expect(reconcileEssentialEffects([edited], retarget.effectChain, ["clarity"])).toEqual({ add: [], replace: [], remove: [], keptUserEdited: [edited.id] });
    expect(reconcileEssentialEffects([edited], [], ["clarity"]).keptUserEdited).toEqual([edited.id]);
    expect(reconcileEssentialEffects([edited], [], ["clarity"], { force: true }).remove).toEqual([edited.id]);
  });

  it("signature ignores key order", () => {
    expect(paramsSignature({ a: 1, b: { y: 1, x: 2 } })).toBe(paramsSignature({ b: { x: 2, y: 1 }, a: 1 }));
  });
});

describe("audio type resolution", () => {
  const tracks = [
    { id: "t1", role: "dialogue" },
    { id: "t2", role: "effects" },
    { id: "t3", role: "general" },
  ] as Pick<Track, "id" | "role">[];
  it("prefers the clip tag, then the track role", () => {
    expect(resolveAudioType({ trackId: "t1" }, tracks)).toBe("dialogue");
    expect(resolveAudioType({ trackId: "t2" }, tracks)).toBe("sfx");
    expect(resolveAudioType({ trackId: "t1", audioType: "music" }, tracks)).toBe("music");
    expect(resolveAudioType({ trackId: "t3" }, tracks)).toBeNull();
  });
});

describe("ducking resolution", () => {
  const clip = { id: "m", trackId: "tm", startTime: 0, duration: 10 };
  const plan = planEssentialSound("music", ALL_ON).ducking;
  const track = (id: string, role: Track["role"], clips: { id: string; startTime: number; duration: number }[], muted = false) =>
    ({ id, role, clips, muted }) as unknown as Pick<Track, "id" | "role" | "clips" | "muted">;

  it("resolves against dialogue tracks only", () => {
    const tracks = [
      track("tm", "music", [{ id: "m", startTime: 0, duration: 10 }]),
      track("td", "dialogue", [{ id: "d", startTime: 2, duration: 3 }]),
      track("tx", "effects", [{ id: "x", startTime: 0, duration: 10 }]),
    ];
    expect(resolveEssentialDucking(plan, clip, tracks)).toEqual({ enabled: true, sourceTrackIds: ["td"] });
  });

  it("is disabled with an explanation when there is no dialogue track", () => {
    const tracks = [track("tm", "music", []), track("tx", "effects", [{ id: "x", startTime: 0, duration: 10 }])];
    const result = resolveEssentialDucking(plan, clip, tracks);
    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/no track has the Dialogue role/);
  });

  it("is disabled when dialogue does not overlap the clip", () => {
    const tracks = [track("td", "dialogue", [{ id: "d", startTime: 20, duration: 3 }])];
    expect(resolveEssentialDucking(plan, clip, tracks)).toMatchObject({ enabled: false, reason: expect.stringMatching(/no dialogue plays/) });
  });

  it("explains why dialogue clips have no ducking", () => {
    const result = resolveEssentialDucking(planEssentialSound("dialogue", ALL_ON).ducking, clip, []);
    expect(result).toMatchObject({ enabled: false, reason: expect.stringMatching(/never ducked/i) });
  });

  it("maps the amount to the ducker's reduction fraction", () => {
    const settings = duckingSettingsFor({ amountDb: 12, fadeMs: 250 }, "td");
    expect(1 - settings.reduction).toBeCloseTo(Math.pow(10, -12 / 20));
    expect(settings).toMatchObject({ sourceTrackId: "td", attack: 0.25, release: 0.25, enabled: true });
  });

  it("merges several duck lanes to the lowest level at every moment", () => {
    const merged = mergeDuckingLanes([
      [{ time: 0, value: 1 }, { time: 1, value: 0.2 }, { time: 2, value: 0.2 }, { time: 3, value: 1 }],
      [{ time: 0, value: 1 }, { time: 2, value: 1 }, { time: 2.5, value: 0.2 }, { time: 4, value: 1 }],
    ]);
    const at = (t: number) => merged.find((p) => p.time === t)?.value;
    expect(at(1)).toBeCloseTo(0.2);
    expect(at(2.5)).toBeCloseTo(0.2);
    expect(at(4)).toBe(1);
    expect(mergeDuckingLanes([])).toEqual([]);
  });
});
