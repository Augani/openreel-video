import { describe, expect, it, vi } from "vitest";
import type { Project } from "../../types/project";
import type { AudioBus, AudioPluginRack, Track } from "../../types/timeline";
import { planAddRackPlugin } from "./native-plugin-rack";
import { RackStemCache, resolveRackStems, stemmedTargets, type RackStemDeps } from "./rack-stems";

const DELAY = { id: "au:aufx:dely:appl", format: "au" as const, name: "AUDelay", vendor: "Apple" };
const rack = (effectId = "fx1"): AudioPluginRack => planAddRackPlugin({ id: "x" }, DELAY, { actionId: "a", effectId })!.params.rack as AudioPluginRack;
const track = (id: string, extra: Partial<Track> = {}): Track =>
  ({ id, type: "audio", name: id, clips: [{ id: `${id}-c`, startTime: 0, duration: 2 }], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as unknown as Track;
const bus = (id: string, extra: Partial<AudioBus> = {}): AudioBus => ({ id, name: id, muted: false, solo: false, ...extra });
const project = (tracks: Track[], buses: AudioBus[] = []): Project =>
  ({ id: "p", settings: { sampleRate: 8000, channels: 2 }, timeline: { duration: 2, markers: [], subtitles: [], tracks, ...(buses.length ? { audioBuses: buses } : {}) }, mediaLibrary: { items: [] } }) as unknown as Project;
const fakeBuffer = (tag: string): AudioBuffer => ({ tag, numberOfChannels: 2, length: 8, sampleRate: 8000 }) as unknown as AudioBuffer;

function deps(overrides: Partial<RackStemDeps<Project>> = {}) {
  const renderStem = vi.fn(async (p: Project, _seconds: number) => fakeBuffer(`dry:${p.timeline.tracks.map((t) => t.id).join("+")}`));
  const runChain = vi.fn(async (buffer: AudioBuffer) => ({ buffer: fakeBuffer(`wet(${(buffer as unknown as { tag: string }).tag})`), bypassed: new Map<string, string>() }));
  const base: RackStemDeps<Project> = {
    renderStem,
    runChain,
    fingerprint: (p, seconds) => JSON.stringify([p.timeline.tracks.map((t) => [t.id, t.muted, t.clips.length]), p.timeline.audioBuses?.map((b) => b.id), seconds]),
    hasHost: true,
    audibility: new Map(),
    preview: false,
    ...overrides,
  };
  return { base, renderStem, runChain };
}

describe("resolveRackStems", () => {
  it("renders the dry stem of a track and runs its chain once; the second resolve is a cache hit", async () => {
    const p = project([track("t1", { pluginRack: rack() }), track("t2")]);
    const cache = new RackStemCache();
    const { base, renderStem, runChain } = deps();
    const first = await resolveRackStems(p, base, cache);
    expect([...first.keys()]).toEqual(["t1"]);
    expect(renderStem).toHaveBeenCalledTimes(1);
    expect(renderStem.mock.calls[0][0].timeline.tracks.map((t) => t.id), "only the track itself is rendered").toEqual(["t1"]);
    expect(renderStem.mock.calls[0][1], "whole timeline + tail").toBe(2 + 2);
    expect(runChain).toHaveBeenCalledTimes(1);
    const again = await resolveRackStems(p, base, cache);
    expect(again.get("t1")).toBe(first.get("t1"));
    expect(renderStem).toHaveBeenCalledTimes(1);
    expect(stemmedTargets(first)).toEqual(new Set(["t1"]));
  });

  it("invalidates on edits: a plugin value, an automation key, the track's clips, or enabling preview bypass", async () => {
    const cache = new RackStemCache();
    const { base, renderStem } = deps();
    const r = rack();
    await resolveRackStems(project([track("t1", { pluginRack: r })]), base, cache);
    expect(renderStem).toHaveBeenCalledTimes(1);

    const edited = { ...r, plugins: [{ ...r.plugins[0], params: { ...r.plugins[0].params, values: { "0": 50 } } }] };
    await resolveRackStems(project([track("t1", { pluginRack: edited })]), base, cache);
    expect(renderStem, "a value edit re-renders").toHaveBeenCalledTimes(2);

    const keyed = { ...edited, keyframes: [{ id: "k", time: 1, property: "effect.nativeplugin:fx1.0", value: 5, easing: "linear" as const }] };
    await resolveRackStems(project([track("t1", { pluginRack: keyed })]), base, cache);
    expect(renderStem, "a keyframe re-renders").toHaveBeenCalledTimes(3);

    await resolveRackStems(project([track("t1", { pluginRack: keyed, clips: [] })]), base, cache);
    expect(renderStem, "editing the track's clips re-renders").toHaveBeenCalledTimes(4);

    await resolveRackStems(project([track("t1", { pluginRack: keyed, clips: [] })]), { ...base, preview: true }, cache);
    expect(renderStem, "the preview bypass flag is part of the key").toHaveBeenCalledTimes(5);
  });

  it("resolves a bus from its feeders and honours the real mute / solo audibility", async () => {
    const p = project([track("feeder", { output: "b1" }), track("muted", { output: "b1" })], [bus("b1", { pluginRack: rack("fxb") })]);
    const { base, renderStem } = deps({ audibility: new Map([["feeder", true], ["muted", false]]) });
    const out = await resolveRackStems(p, base, new RackStemCache());
    expect([...out.keys()]).toEqual(["b1"]);
    const stemProject = renderStem.mock.calls[0][0];
    expect(stemProject.timeline.tracks.find((t) => t.id === "muted")?.muted).toBe(true);
    expect(stemProject.timeline.tracks.find((t) => t.id === "feeder")?.muted).toBe(false);
  });

  it("skips silenced targets entirely (no render for a muted track or a muted bus)", async () => {
    const p = project([track("t1", { pluginRack: rack() })], [bus("b1", { muted: true, pluginRack: rack("fxb") })]);
    const { base, renderStem } = deps({ audibility: new Map([["t1", false]]) });
    const out = await resolveRackStems(p, base, new RackStemCache());
    expect(out.size).toBe(0);
    expect(renderStem).not.toHaveBeenCalled();
  });

  it("bypasses and reports every plugin when there is no host, without rendering anything", async () => {
    const p = project([track("t1", { pluginRack: rack() })]);
    const { base, renderStem } = deps({ hasHost: false });
    const out = await resolveRackStems(p, base, new RackStemCache());
    const result = out.get("t1")!;
    expect(result.allBypassed).toBe(true);
    expect(result.buffer).toBeNull();
    expect(result.bypassed.get("fx1")).toMatch(/desktop app/);
    expect(stemmedTargets(out).size).toBe(0);
    expect(renderStem).not.toHaveBeenCalled();
  });

  it("bypasses 5.1 sequences (plugins would see six channels)", async () => {
    const out = await resolveRackStems(project([track("t1", { pluginRack: rack() })]), { ...deps().base, surround: true }, new RackStemCache());
    expect(out.get("t1")?.bypassed.get("fx1")).toMatch(/stereo/);
  });

  it("a plugin the host cannot run is bypassed: its track keeps its clips (no stem), and it is reported", async () => {
    const p = project([track("t1", { pluginRack: rack() })]);
    const { base } = deps({ runChain: async (buffer) => ({ buffer, bypassed: new Map([["fx1", "not installed"]]) }) });
    const out = await resolveRackStems(p, base, new RackStemCache());
    expect(out.get("t1")).toMatchObject({ allBypassed: true, buffer: null });
    expect(out.get("t1")?.bypassed.get("fx1")).toBe("not installed");
    expect(stemmedTargets(out).size).toBe(0);
  });

  it("never caches a bypass: a plugin installed or unblocked later is picked up on the next resolve", async () => {
    const p = project([track("t1", { pluginRack: rack() })]);
    const cache = new RackStemCache();
    let installed = false;
    const { base, renderStem } = deps({ runChain: async (buffer) => (installed ? { buffer: fakeBuffer("wet"), bypassed: new Map() } : { buffer, bypassed: new Map([["fx1", "not installed"]]) }) });
    expect((await resolveRackStems(p, base, cache)).get("t1")?.allBypassed).toBe(true);
    installed = true;
    const second = (await resolveRackStems(p, base, cache)).get("t1")!;
    expect(second.allBypassed).toBe(false);
    expect(second.buffer).not.toBeNull();
    expect(renderStem).toHaveBeenCalledTimes(2);
  });

  it("a plugin that fails while rendering rejects (an export fails loudly) and is not cached", async () => {
    const p = project([track("t1", { pluginRack: rack() })]);
    const cache = new RackStemCache();
    const failing = deps({ runChain: async () => { throw new Error("helper crashed"); } });
    await expect(resolveRackStems(p, failing.base, cache)).rejects.toThrow("helper crashed");
    await new Promise((r) => setTimeout(r, 0));
    expect(cache.size).toBe(0);
    const ok = deps();
    const out = await resolveRackStems(p, ok.base, cache);
    expect(out.get("t1")?.buffer).not.toBeNull();
  });

  it("keeps only the most recent stems", async () => {
    const cache = new RackStemCache(2);
    const { base } = deps();
    for (const id of ["a", "b", "c"]) await resolveRackStems(project([track(id, { pluginRack: rack() })]), base, cache);
    expect(cache.size).toBe(2);
  });
});
