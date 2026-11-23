import { describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "../../actions/action-executor";
import type { Action } from "../../types/actions";
import type { Project } from "../../types/project";
import type { AudioBus, AudioPluginRack, Track } from "../../types/timeline";
import { audioRangeFingerprint } from "../mixdown-cache";
import { isolateTrackStem } from "../stem-isolation";
import {
  MASTER_RACK_TARGET,
  activePluginRackTargets,
  applyRackStemsToTimeline,
  buildMasterStemProject,
  findMissingRackPlugins,
  findRackOwner,
  planAddRackPlugin,
  planKeyframeRackParameter,
  planRemoveRackPlugin,
  planUpdateRackPlugin,
  pluginRackTargets,
  projectHasPluginRacks,
  rackStemTrackId,
} from "./native-plugin-rack";
import { RackStemCache, resolveRackStems, stemmedTargets, type RackStemDeps } from "./rack-stems";

const DELAY = { id: "au:aufx:dely:appl", format: "au" as const, name: "AUDelay", vendor: "Apple", latencySamples: 0 };
const track = (id: string, extra: Partial<Track> = {}): Track =>
  ({ id, type: "audio", name: id, clips: [{ id: `${id}-c`, mediaId: "m", startTime: 0, duration: 2, audioEffects: [] }], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as unknown as Track;
const bus = (id: string, extra: Partial<AudioBus> = {}): AudioBus => ({ id, name: id, muted: false, solo: false, ...extra });
const rack = (effectId = "fxm"): AudioPluginRack => planAddRackPlugin({ id: "x" }, DELAY, { actionId: "a", effectId })!.params.rack as AudioPluginRack;

function makeProject(tracks: Track[], extra: Record<string, unknown> = {}): Project {
  return {
    id: "p1", name: "Test", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 8000, channels: 2 },
    timeline: { duration: 2, markers: [], subtitles: [], tracks, ...extra },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

let counter = 0;
const ids = () => ({ actionId: `m-${++counter}` });
const apply = async (executor: ActionExecutor, project: Project, action: Action | null): Promise<void> => {
  expect(action).not.toBeNull();
  const result = await executor.execute(action as Action, project);
  expect(result.success, JSON.stringify(result.error)).toBe(true);
};
const owner = (project: Project) => findRackOwner(project.timeline, MASTER_RACK_TARGET)!.owner;

describe("master plugin rack edits", () => {
  it("every edit is one undo step on timeline.masterPluginRack, and undo restores the previous rack", async () => {
    const executor = new ActionExecutor();
    const project = makeProject([track("t1")]);
    const history = () => executor.getHistory().getUndoStackSize();
    await apply(executor, project, planAddRackPlugin(owner(project), DELAY, { ...ids(), effectId: "fxm" }));
    expect(project.timeline.masterPluginRack?.plugins.map((p) => p.id)).toEqual(["fxm"]);
    await apply(executor, project, planUpdateRackPlugin(owner(project), "fxm", { values: { "0": 0.4 }, state: "c3RhdGU=" }, ids()));
    await apply(executor, project, planKeyframeRackParameter(owner(project), "fxm", "0", 1.5, 0.9, { ...ids(), keyframeId: "k1" }));
    expect(history()).toBe(3);
    expect(project.timeline.masterPluginRack?.keyframes).toHaveLength(1);
    await apply(executor, project, planRemoveRackPlugin(owner(project), "fxm", ids()));
    expect(history(), "remove (plugin and its keyframes) is one step").toBe(4);
    expect(project.timeline.masterPluginRack).toBeUndefined();
    await executor.undo(project);
    expect(project.timeline.masterPluginRack?.plugins).toHaveLength(1);
    expect(project.timeline.masterPluginRack?.keyframes).toHaveLength(1);
    await executor.undo(project);
    await executor.undo(project);
    await executor.undo(project);
    expect(project.timeline.masterPluginRack).toBeUndefined();
    // redo walks forward again, back to the removed state
    await executor.redo(project);
    expect(project.timeline.masterPluginRack?.plugins.map((p) => p.id)).toEqual(["fxm"]);
    await executor.redo(project);
    await executor.redo(project);
    expect(project.timeline.masterPluginRack?.keyframes).toHaveLength(1);
    await executor.redo(project);
    expect(project.timeline.masterPluginRack).toBeUndefined();
  });

  it("does not touch a track or bus whose id is anything else, and rejects an unknown target", async () => {
    const executor = new ActionExecutor();
    const project = makeProject([track("t1")]);
    const result = await executor.execute({ id: "x", timestamp: 0, type: "audioPluginRack/set", params: { target: "nope", rack: null } }, project);
    expect(result.success).toBe(false);
  });

  it("lists the master last, as an active target, and reports a missing plugin against 'Master'", () => {
    const project = makeProject([track("t1", { pluginRack: rack("fxt") })], { masterPluginRack: rack("fxm"), audioBuses: [bus("b1", { pluginRack: rack("fxb") })] });
    expect(pluginRackTargets(project.timeline).map((t) => `${t.kind}:${t.id}`)).toEqual(["track:t1", "bus:b1", `master:${MASTER_RACK_TARGET}`]);
    expect(projectHasPluginRacks(makeProject([track("t1")], { masterPluginRack: rack() }).timeline)).toBe(true);
    const missing = findMissingRackPlugins(project.timeline, new Set()).filter((m) => m.kind === "master");
    expect(missing).toEqual([expect.objectContaining({ target: MASTER_RACK_TARGET, targetName: "Master", effectId: "fxm", pluginId: DELAY.id })]);
    const disabled = rack("fxm");
    const off = { plugins: disabled.plugins.map((p) => ({ ...p, enabled: false })) };
    expect(activePluginRackTargets(makeProject([track("t1")], { masterPluginRack: off }).timeline)).toEqual([]);
  });

  it("the master stem project keeps tracks, buses and their plugins but drops the master fader, rack and plugins", () => {
    const project = makeProject([track("t1", { pluginRack: rack("fxt"), output: "b1" })], {
      masterPluginRack: rack("fxm"),
      masterAudioRack: { effects: [], volume: 0.5 },
      audioBuses: [bus("b1", { pluginRack: rack("fxb") })],
    });
    const stem = buildMasterStemProject(project);
    expect(stem.timeline.masterPluginRack).toBeUndefined();
    expect(stem.timeline.masterAudioRack).toBeUndefined();
    expect(stem.timeline.tracks[0].pluginRack).toBeDefined();
    expect(stem.timeline.audioBuses?.[0].pluginRack).toBeDefined();
  });

  it("a played master stem replaces every track and bus with one synthetic track into the master, keeping the built-in master rack", () => {
    const timeline = makeProject([track("t1"), track("t2", { output: "b1" })], {
      masterPluginRack: rack(),
      masterAudioRack: { effects: [], volume: 0.5 },
      audioBuses: [bus("b1")],
    }).timeline;
    const next = applyRackStemsToTimeline(timeline, new Set([MASTER_RACK_TARGET]));
    expect(next.tracks.map((t) => t.id)).toEqual([rackStemTrackId(MASTER_RACK_TARGET)]);
    expect(next.tracks[0].output).toBeUndefined();
    expect(next.audioBuses).toBeUndefined();
    expect(next.masterAudioRack?.volume).toBe(0.5);
    expect(next.masterPluginRack).toBeUndefined();
  });

  it("the mixdown fingerprint changes with any master plugin edit and not with an unrelated one", () => {
    const base = makeProject([track("t1")], { masterPluginRack: rack() });
    const a = audioRangeFingerprint(base, 0, 2);
    expect(audioRangeFingerprint(makeProject([track("t1")], { masterPluginRack: rack() }), 0, 2)).toBe(a);
    const edited = { plugins: [{ ...rack().plugins[0], params: { ...rack().plugins[0].params, values: { "0": 0.2 } } }] };
    expect(audioRangeFingerprint(makeProject([track("t1")], { masterPluginRack: edited }), 0, 2)).not.toBe(a);
    expect(audioRangeFingerprint(makeProject([track("t1")]), 0, 2)).not.toBe(a);
  });

  it("track stem isolation (the 'before master' stems) ignores the master plugins", () => {
    const project = makeProject([track("t1"), track("t2")], { masterPluginRack: rack() });
    expect(isolateTrackStem(project, "t1")?.timeline.masterPluginRack).toBeUndefined();
  });
});

const fakeBuffer = (tag: string): AudioBuffer => ({ tag, numberOfChannels: 2, length: 8, sampleRate: 8000 }) as unknown as AudioBuffer;
function deps(overrides: Partial<RackStemDeps<Project>> = {}) {
  const renderStem = vi.fn(async (p: Project, _seconds: number) => fakeBuffer(`dry:${p.timeline.tracks.map((t) => t.id).join("+")}`));
  const runChain = vi.fn(async (buffer: AudioBuffer, _steps: unknown, _label: string) => ({ buffer: fakeBuffer(`wet(${(buffer as unknown as { tag: string }).tag})`), bypassed: new Map<string, string>() }));
  const base: RackStemDeps<Project> = {
    renderStem, runChain,
    fingerprint: (p, seconds) => audioRangeFingerprint(p, 0, seconds),
    hasHost: true, audibility: new Map(), preview: false, ...overrides,
  };
  return { base, renderStem, runChain };
}

describe("resolveRackStems with a master rack", () => {
  const p = () => makeProject([track("t1", { pluginRack: rack("fxt") }), track("t2")], { masterPluginRack: rack("fxm") });

  it("renders the whole mix once, runs the chain labelled Master, and resolves nothing else in the outer render", async () => {
    const { base, renderStem, runChain } = deps();
    const out = await resolveRackStems(p(), base, new RackStemCache());
    expect([...out.keys()]).toEqual([MASTER_RACK_TARGET]);
    expect(stemmedTargets(out)).toEqual(new Set([MASTER_RACK_TARGET]));
    expect(renderStem).toHaveBeenCalledTimes(1);
    expect(renderStem.mock.calls[0][0].timeline.tracks.map((t) => t.id), "the whole mix").toEqual(["t1", "t2"]);
    expect(renderStem.mock.calls[0][0].timeline.masterPluginRack).toBeUndefined();
    expect(runChain.mock.calls[0][2]).toBe("Master");
  });

  it("caches by the full-mix fingerprint plus the chain signature: unchanged = hit, any audio or plugin edit = re-render", async () => {
    const cache = new RackStemCache();
    const { base, renderStem } = deps();
    const first = await resolveRackStems(p(), base, cache);
    const again = await resolveRackStems(p(), base, cache);
    expect(again.get(MASTER_RACK_TARGET)).toBe(first.get(MASTER_RACK_TARGET));
    expect(renderStem).toHaveBeenCalledTimes(1);
    await resolveRackStems(makeProject([track("t1", { pluginRack: rack("fxt") }), track("t2", { muted: true })], { masterPluginRack: rack("fxm") }), base, cache);
    expect(renderStem, "muting a track changes the mix").toHaveBeenCalledTimes(2);
    const edited = { plugins: [{ ...rack("fxm").plugins[0], params: { ...rack("fxm").plugins[0].params, values: { "0": 0.3 } } }] };
    await resolveRackStems(makeProject([track("t1", { pluginRack: rack("fxt") }), track("t2", { muted: true })], { masterPluginRack: edited }), base, cache);
    expect(renderStem, "a plugin value changes the chain signature").toHaveBeenCalledTimes(3);
  });

  it("a master whose plugins cannot run falls back to resolving the tracks and buses (it plays dry, reported)", async () => {
    const { base } = deps({ hasHost: false });
    const out = await resolveRackStems(p(), base, new RackStemCache());
    expect(out.get(MASTER_RACK_TARGET)).toMatchObject({ allBypassed: true, buffer: null });
    expect(out.get("t1")?.bypassed.get("fxt")).toMatch(/desktop app/);
    expect(stemmedTargets(out).size).toBe(0);
  });

  it("never caches a master stem whose upstream resolution bypassed a plugin (the host's availability changed it)", async () => {
    let events = 0;
    const { base, renderStem } = deps({
      bypassEvents: () => events,
      renderStem: vi.fn(async () => {
        events += 1; // a nested track stem was bypassed while the dry mix rendered
        return fakeBuffer("dry");
      }),
    });
    const cache = new RackStemCache();
    await resolveRackStems(p(), base, cache);
    await resolveRackStems(p(), base, cache);
    expect(base.renderStem).toHaveBeenCalledTimes(2);
    void renderStem;
  });

  it("a missing master plugin among two keeps the working one and reports the other", async () => {
    const two = { plugins: [...rack("fxm").plugins, ...rack("fxn").plugins] };
    const { base } = deps({ runChain: async () => ({ buffer: fakeBuffer("wet"), bypassed: new Map([["fxn", "not installed"]]) }) });
    const out = await resolveRackStems(makeProject([track("t1")], { masterPluginRack: two }), base, new RackStemCache());
    const result = out.get(MASTER_RACK_TARGET)!;
    expect(result.allBypassed).toBe(false);
    expect(result.bypassed.get("fxn")).toBe("not installed");
  });

  it("5.1 sequences bypass the master plugins", async () => {
    const out = await resolveRackStems(p(), { ...deps().base, surround: true }, new RackStemCache());
    expect(out.get(MASTER_RACK_TARGET)?.bypassed.get("fxm")).toMatch(/stereo or mono/);
  });
});
