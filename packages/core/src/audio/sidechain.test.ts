import { describe, expect, it, vi } from "vitest";
import type { AudioBus, AudioRack, Timeline, Track } from "../types";
import { createRackEffect, sanitizeAudioRack, sanitizeRackEffectParams } from "./track-audio-rack";
import { MASTER_OWNER, SidechainKeyHub, busOwnerId, compressorKeySource, computeSidechainPlan, listSidechainCandidates, parseKeySource, timelineHasSidechain, trackOwnerId } from "./sidechain";

const keyed = (key: string | undefined, hpf = 20): AudioRack => ({
  effects: [createRackEffect("compressor", { params: { keySource: key, keyHpf: hpf } })],
});
const track = (id: string, extra: Partial<Track> = {}): Track =>
  ({ id, type: "audio", name: id.toUpperCase(), clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as unknown as Track;
const bus = (id: string, extra: Partial<AudioBus> = {}): AudioBus => ({ id, name: id, ...extra }) as unknown as AudioBus;
const timeline = (tracks: Track[], audioBuses: AudioBus[] = [], masterAudioRack?: AudioRack): Pick<Timeline, "tracks" | "audioBuses" | "masterAudioRack"> => ({ tracks, audioBuses, masterAudioRack });

describe("compressor sidechain params", () => {
  it("keeps a well-formed key and drops anything else", () => {
    expect(sanitizeRackEffectParams("compressor", { keySource: "track:a1" }).keySource).toBe("track:a1");
    expect(sanitizeRackEffectParams("compressor", { keySource: "bus:b9" }).keySource).toBe("bus:b9");
    expect(sanitizeRackEffectParams("compressor", { keySource: "a1" }).keySource).toBeUndefined();
    expect(sanitizeRackEffectParams("compressor", { keySource: 3 }).keySource).toBeUndefined();
    expect(sanitizeRackEffectParams("gain", { keySource: "track:a1" }).keySource).toBeUndefined();
    expect(sanitizeRackEffectParams("compressor", { keyHpf: 99999 }).keyHpf).toBe(2000);
    expect(sanitizeRackEffectParams("compressor", {}).keyHpf).toBe(20);
  });

  it("survives a rack round trip", () => {
    const rack = sanitizeAudioRack(keyed("track:a1", 120));
    expect(compressorKeySource(rack!.effects[0].params)).toBe("track:a1");
    expect(rack!.effects[0].params.keyHpf).toBe(120);
    expect(parseKeySource("track:a1")).toEqual({ kind: "track", id: "a1" });
    expect(parseKeySource("master")).toBeNull();
  });
});

describe("sidechain plan", () => {
  it("accepts a key on another track or a bus and reports the sources in use", () => {
    const tl = timeline([track("music", { audioRack: keyed("track:voice") }), track("voice")], [bus("fx", { rack: keyed("track:voice") })]);
    const plan = computeSidechainPlan(tl);
    expect(plan.valid.has(`${trackOwnerId("music")}|track:voice`)).toBe(true);
    expect(plan.valid.has(`${busOwnerId("fx")}|track:voice`)).toBe(true);
    expect([...plan.sources]).toEqual(["track:voice"]);
    expect(timelineHasSidechain(tl)).toBe(true);
    expect(timelineHasSidechain(timeline([track("a")]))).toBe(false);
  });

  it("drops a key on itself, on a missing track, and on the master", () => {
    const tl = timeline([track("a", { audioRack: keyed("track:a") }), track("b", { audioRack: keyed("track:gone") }), track("c", { audioRack: keyed("master") })]);
    expect(computeSidechainPlan(tl).valid.size).toBe(0);
  });

  it("drops a key that would close a feedback loop", () => {
    // a keys on b, b keys on a: only the first is kept
    const mutual = timeline([track("a", { audioRack: keyed("track:b") }), track("b", { audioRack: keyed("track:a") })]);
    const plan = computeSidechainPlan(mutual);
    expect(plan.valid.size).toBe(1);
    // a track keyed on the bus it plays into, and a bus keyed on a track that feeds it
    const intoBus = timeline([track("a", { output: "fx", audioRack: keyed("bus:fx") })], [bus("fx")]);
    expect(computeSidechainPlan(intoBus).valid.size).toBe(0);
    const viaSend = timeline([track("a", { sends: [{ id: "s", busId: "fx", level: 1, preFader: false }] })], [bus("fx", { rack: keyed("track:a") })]);
    expect(computeSidechainPlan(viaSend).valid.size).toBe(1); // the bus listening to the track that feeds it is a normal dependency, not a loop
    const reverse = timeline([track("a", { audioRack: keyed("bus:fx"), sends: [{ id: "s", busId: "fx", level: 1, preFader: false }] })], [bus("fx")]);
    expect(computeSidechainPlan(reverse).valid.size).toBe(0);
  });

  it("lets the master key on any track but never lets a track key on the master", () => {
    const tl = timeline([track("a", { audioRack: keyed("track:b") }), track("b")], [], keyed("track:a"));
    expect(computeSidechainPlan(tl).valid.has(`${MASTER_OWNER}|track:a`)).toBe(true);
  });

  it("offers only sources that would not make a loop", () => {
    const tl = timeline([track("a", { output: "fx" }), track("b")], [bus("fx")]);
    const ids = listSidechainCandidates(tl, trackOwnerId("a")).map((c) => c.id);
    expect(ids).toEqual(["track:b"]); // not itself, not the bus it feeds
    expect(listSidechainCandidates(tl, busOwnerId("fx")).map((c) => c.id).sort()).toEqual(["track:a", "track:b"]); // a bus may listen to a track that feeds it
  });
});

describe("SidechainKeyHub", () => {
  function fakeCtx() {
    const gains: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const ctx = {
      createGain: () => {
        const node = { connect: vi.fn(), disconnect: vi.fn() };
        gains.push(node);
        return node;
      },
    } as unknown as BaseAudioContext;
    return { ctx, gains };
  }

  it("meets a source and a compressor in either order through one persistent tap", () => {
    const { ctx } = fakeCtx();
    const hub = new SidechainKeyHub(ctx);
    const early = hub.tap("track:v");
    const source = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
    hub.publish("track:v", source);
    expect((source.connect as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(early);
    expect(hub.tap("track:v")).toBe(early);
    hub.publish("track:v", source); // idempotent
    expect((source.connect as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    hub.unpublish("track:v", source);
    expect((source.disconnect as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(early);
  });

  it("validates keys against the timeline and reports when the legal set changes", () => {
    const { ctx } = fakeCtx();
    const hub = new SidechainKeyHub(ctx);
    expect(hub.setTimeline(timeline([track("m", { audioRack: keyed("track:v") }), track("v")]))).toBe(true);
    expect(hub.isValidKey(trackOwnerId("m"), "track:v")).toBe(true);
    expect(hub.isKeySource("track:v")).toBe(true);
    expect(hub.setTimeline(timeline([track("m", { audioRack: keyed("track:v") }), track("v")]))).toBe(false);
    expect(hub.setTimeline(timeline([track("m", { audioRack: keyed("track:v") })]))).toBe(true);
    expect(hub.isValidKey(trackOwnerId("m"), "track:v")).toBe(false);
  });
});
