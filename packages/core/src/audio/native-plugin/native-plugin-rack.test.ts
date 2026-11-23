import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../../actions/action-executor";
import type { Action } from "../../types/actions";
import type { Project } from "../../types/project";
import type { AudioBus, AudioPluginRack, Track } from "../../types/timeline";
import { normalizeProjectStoredFields } from "../../storage/project-serializer";
import { createNativePluginEffect, nativePluginKeyframeProperty, readNativePluginParams } from "./native-plugin-effect";
import {
  RACK_STEM_SINK_ID,
  activePluginRackTargets,
  applyRackStemsToTimeline,
  buildBusStemProject,
  buildTrackStemProject,
  findMissingRackPlugins,
  isSunkTrack,
  pluginRackSteps,
  planAddRackPlugin,
  planClearRackParameterKeyframes,
  planKeyframeRackParameter,
  planMoveRackPlugin,
  planRemoveRackPlugin,
  planSetRackLivePreview,
  planUpdateRackPlugin,
  projectHasPluginRacks,
  rackForFingerprint,
  rackIsLive,
  rackStemSeconds,
  rackStemTrackId,
  sanitizePluginRack,
} from "./native-plugin-rack";

const DELAY = { id: "au:aufx:dely:appl", format: "au" as const, name: "AUDelay", vendor: "Apple", latencySamples: 0 };
const LOWPASS = { id: "au:aufx:lpas:appl", format: "au" as const, name: "AULowpass", vendor: "Apple" };

const track = (id: string, extra: Partial<Track> = {}): Track =>
  ({ id, type: "audio", name: id, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;
const bus = (id: string, extra: Partial<AudioBus> = {}): AudioBus => ({ id, name: id, muted: false, solo: false, ...extra });

function makeProject(tracks: Track[], buses: AudioBus[] = []): Project {
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 5, markers: [], subtitles: [], tracks, ...(buses.length ? { audioBuses: buses } : {}) },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

let counter = 0;
const ids = () => ({ actionId: `a-${++counter}` });
const apply = async (executor: ActionExecutor, project: Project, action: Action | null): Promise<void> => {
  expect(action).not.toBeNull();
  const result = await executor.execute(action as Action, project);
  expect(result.success, JSON.stringify(result.error)).toBe(true);
};
const rackOf = (project: Project, id: string): AudioPluginRack | undefined =>
  project.timeline.tracks.find((t) => t.id === id)?.pluginRack ?? project.timeline.audioBuses?.find((b) => b.id === id)?.pluginRack;

describe("plugin rack edits (one undo step each, tracks and buses)", () => {
  it("adds, updates, keyframes, reorders and removes plugins on a track, each as exactly one history entry", async () => {
    const executor = new ActionExecutor();
    const project = makeProject([track("t1")]);
    const history = () => executor.getHistory().getUndoStackSize();

    await apply(executor, project, planAddRackPlugin(project.timeline.tracks[0], DELAY, { ...ids(), effectId: "fx-delay" }));
    await apply(executor, project, planAddRackPlugin(project.timeline.tracks[0], LOWPASS, { ...ids(), effectId: "fx-lp" }));
    expect(history()).toBe(2);
    expect(rackOf(project, "t1")?.plugins.map((p) => p.id)).toEqual(["fx-delay", "fx-lp"]);

    await apply(executor, project, planUpdateRackPlugin(project.timeline.tracks[0], "fx-delay", { values: { "0": 80 }, state: "c3RhdGU=" }, ids()));
    expect(history()).toBe(3);
    const params = readNativePluginParams(rackOf(project, "t1")!.plugins[0]);
    expect(params.values).toEqual({ "0": 80 });
    expect(params.state).toBe("c3RhdGU=");
    expect(planUpdateRackPlugin(project.timeline.tracks[0], "fx-delay", { values: { "0": 80 } }, ids()), "no change, no action").toBeNull();

    // keyframe insert and edit: one step each
    await apply(executor, project, planKeyframeRackParameter(project.timeline.tracks[0], "fx-delay", "0", 1, 20, { ...ids(), keyframeId: "kf1" }));
    await apply(executor, project, planKeyframeRackParameter(project.timeline.tracks[0], "fx-delay", "0", 3, 100, { ...ids(), keyframeId: "kf2" }));
    expect(history()).toBe(5);
    await apply(executor, project, planKeyframeRackParameter(project.timeline.tracks[0], "fx-delay", "0", 3.004, 60, { ...ids(), keyframeId: "kf3" }));
    expect(history()).toBe(6);
    expect(rackOf(project, "t1")!.keyframes!.map((k) => [k.time, k.value])).toEqual([[1, 20], [3, 60]]);

    await apply(executor, project, planMoveRackPlugin(project.timeline.tracks[0], "fx-lp", 0, ids()));
    expect(rackOf(project, "t1")!.plugins.map((p) => p.id)).toEqual(["fx-lp", "fx-delay"]);

    // removing a plugin takes its keyframes with it, in the same step
    await apply(executor, project, planRemoveRackPlugin(project.timeline.tracks[0], "fx-delay", ids()));
    expect(rackOf(project, "t1")!.plugins.map((p) => p.id)).toEqual(["fx-lp"]);
    expect(rackOf(project, "t1")!.keyframes).toBeUndefined();
    const total = history();

    // undo walks back exactly one edit at a time
    await executor.undo(project);
    expect(history()).toBe(total - 1);
    expect(rackOf(project, "t1")!.keyframes).toHaveLength(2);
    for (let i = 0; i < total - 1; i += 1) await executor.undo(project);
    expect(rackOf(project, "t1")).toBeUndefined();
    expect(history()).toBe(0);
  });

  it("works on a bus and leaves the tracks alone", async () => {
    const executor = new ActionExecutor();
    const project = makeProject([track("t1")], [bus("b1")]);
    await apply(executor, project, planAddRackPlugin(project.timeline.audioBuses![0], DELAY, { ...ids(), effectId: "fx-b" }));
    expect(rackOf(project, "b1")?.plugins).toHaveLength(1);
    expect(project.timeline.tracks[0].pluginRack).toBeUndefined();
    await apply(executor, project, planKeyframeRackParameter(project.timeline.audioBuses![0], "fx-b", "0", 0.5, 10, { ...ids(), keyframeId: "k" }));
    expect(rackOf(project, "b1")?.keyframes).toHaveLength(1);
    expect(planClearRackParameterKeyframes(project.timeline.audioBuses![0], "fx-b", "other", ids()), "nothing to clear").toBeNull();
    await apply(executor, project, planClearRackParameterKeyframes(project.timeline.audioBuses![0], "fx-b", "0", ids()));
    expect(rackOf(project, "b1")?.keyframes).toBeUndefined();
    await executor.undo(project);
    expect(rackOf(project, "b1")?.keyframes).toHaveLength(1);
    await executor.undo(project);
    await executor.undo(project);
    await executor.undo(project);
    expect(project.timeline.audioBuses![0].pluginRack).toBeUndefined();
  });

  it("rejects a dangling target and an oversized rack", async () => {
    const executor = new ActionExecutor();
    const project = makeProject([track("t1")]);
    const missing = await executor.execute({ id: "x", timestamp: 0, type: "audioPluginRack/set", params: { target: "nope", rack: null } }, project);
    expect(missing.success).toBe(false);
    const eleven = { plugins: Array.from({ length: 11 }, (_, i) => ({ id: `e${i}`, type: "nativePlugin", enabled: true, params: { pluginId: "p" } })) };
    const tooMany = await executor.execute({ id: "y", timestamp: 0, type: "audioPluginRack/set", params: { target: "t1", rack: eleven } }, project);
    expect(tooMany.success).toBe(false);
  });

  it("caps a rack at eight plugins", () => {
    let t = track("t1");
    for (let i = 0; i < 8; i += 1) {
      const action = planAddRackPlugin(t, DELAY, { actionId: `a${i}`, effectId: `fx${i}` });
      expect(action).not.toBeNull();
      t = { ...t, pluginRack: (action as Action).params.rack as AudioPluginRack };
    }
    expect(planAddRackPlugin(t, DELAY, { actionId: "z", effectId: "fx-z" })).toBeNull();
  });
});

describe("plugin rack data", () => {
  const delay = planAddRackPlugin(track("t"), DELAY, { actionId: "a", effectId: "fx1" })!.params.rack as AudioPluginRack;

  it("sanitises: drops malformed plugins and keyframes of unknown plugins, and never stores baked automation", () => {
    const rack = sanitizePluginRack({
      plugins: [
        { id: "fx1", type: "nativePlugin", enabled: true, params: { pluginId: "p1", values: { "0": 1 }, automation: { "0": [[0, 1]] } } },
        { id: "fx1", type: "nativePlugin", enabled: true, params: { pluginId: "p1" } },
        { id: "fx2", type: "reverb", enabled: true, params: {} },
        { id: "fx3", type: "nativePlugin", enabled: true, params: {} },
      ],
      keyframes: [
        { id: "k1", time: 1, property: nativePluginKeyframeProperty("fx1", "0"), value: 2, easing: "linear" },
        { id: "k2", time: 1, property: nativePluginKeyframeProperty("gone", "0"), value: 2, easing: "linear" },
        { id: "k3", time: Number.NaN, property: nativePluginKeyframeProperty("fx1", "0"), value: 2, easing: "linear" },
      ],
    });
    expect(rack?.plugins.map((p) => p.id)).toEqual(["fx1"]);
    expect(rack?.plugins[0].params).not.toHaveProperty("automation");
    expect(rack?.keyframes?.map((k) => k.id)).toEqual(["k1"]);
    expect(sanitizePluginRack({ plugins: [] })).toBeUndefined();
    expect(sanitizePluginRack(null)).toBeUndefined();
  });

  it("bakes keyframes into lanes in timeline seconds, and skips disabled or preview-bypassed plugins", () => {
    const rack: AudioPluginRack = {
      plugins: [...delay.plugins, { ...delay.plugins[0], id: "fx2", enabled: false }, { ...delay.plugins[0], id: "fx3", metadata: { previewBypass: true } }],
      keyframes: [
        { id: "k1", time: 2, property: nativePluginKeyframeProperty("fx1", "0"), value: 100, easing: "linear" },
        { id: "k0", time: 0.5, property: nativePluginKeyframeProperty("fx1", "0"), value: 20, easing: "linear" },
      ],
    };
    const steps = pluginRackSteps(rack);
    expect(steps.map((s) => s.effectId)).toEqual(["fx1", "fx3"]);
    expect(steps[0].automation["0"]).toEqual([[0.5, 20], [2, 100]]);
    expect(pluginRackSteps(rack, { preview: true }).map((s) => s.effectId)).toEqual(["fx1"]);
    expect(pluginRackSteps(undefined)).toEqual([]);
  });

  it("finds the targets, ignoring racks with every plugin disabled", () => {
    const off: AudioPluginRack = { plugins: [{ ...delay.plugins[0], enabled: false }] };
    const timeline = makeProject([track("t1", { pluginRack: delay }), track("t2", { pluginRack: off }), track("t3")], [bus("b1", { pluginRack: delay })]).timeline;
    expect(activePluginRackTargets(timeline).map((t) => `${t.kind}:${t.id}`)).toEqual(["track:t1", "bus:b1"]);
    expect(projectHasPluginRacks(timeline)).toBe(true);
    expect(projectHasPluginRacks(makeProject([track("t3")]).timeline)).toBe(false);
  });

  it("reports missing plugins on tracks and buses (never drops them)", () => {
    const timeline = makeProject([track("t1", { name: "Dialogue", pluginRack: delay })], [bus("b1", { name: "Music", pluginRack: delay })]).timeline;
    expect(findMissingRackPlugins(timeline, new Set([DELAY.id]))).toEqual([]);
    const missing = findMissingRackPlugins(timeline, new Set());
    expect(missing.map((m) => [m.kind, m.target, m.targetName, m.name])).toEqual([["track", "t1", "Dialogue", "AUDelay"], ["bus", "b1", "Music", "AUDelay"]]);
    expect(findMissingRackPlugins(timeline, null)).toHaveLength(2);
  });

  it("survives project load normalisation (tracks and buses keep their plugin racks)", () => {
    const project = makeProject([track("t1", { pluginRack: delay })], [bus("b1", { pluginRack: delay })]);
    const normalised = normalizeProjectStoredFields(JSON.parse(JSON.stringify(project)) as Project);
    expect(normalised.timeline.tracks[0].pluginRack?.plugins[0].id).toBe("fx1");
    expect(normalised.timeline.audioBuses?.[0].pluginRack?.plugins[0].id).toBe("fx1");
  });

  it("covers the timeline plus the plugin tail", () => {
    const t = track("t1", { clips: [{ id: "c", startTime: 1, duration: 3 } as never] });
    expect(rackStemSeconds({ tracks: [t], duration: 2 })).toBe(4 + 2);
  });
});

describe("stem projects", () => {
  const rack = planAddRackPlugin(track("t"), DELAY, { actionId: "a", effectId: "fx1" })!.params.rack as AudioPluginRack;

  it("a track stem is the track alone, without rack, routing, automation or plugins, with the real audibility", () => {
    const project = makeProject([track("t1", { audioRack: { effects: [], volume: 0.5 }, pluginRack: rack, output: "b1", sends: [{ id: "s", busId: "b1", level: 1, preFader: false }], automation: { volume: [{ time: 0, value: 1 }] } }), track("t2")], [bus("b1", { rack: { effects: [], volume: 0.2 } }), bus("b2")]);
    (project as { timeline: unknown }).timeline = { ...project.timeline, masterAudioRack: { effects: [], volume: 0.5 } };
    const stem = buildTrackStemProject(project, "t1", false)!;
    expect(stem.timeline.tracks.map((t) => t.id)).toEqual(["t1"]);
    const only = stem.timeline.tracks[0];
    expect(only).not.toHaveProperty("audioRack");
    expect(only).not.toHaveProperty("pluginRack");
    expect(only).not.toHaveProperty("output");
    expect(only).not.toHaveProperty("sends");
    expect(only).not.toHaveProperty("automation");
    expect(only.muted).toBe(true);
    expect(stem.timeline.audioBuses).toBeUndefined();
    expect(stem.timeline.masterAudioRack).toBeUndefined();
    expect(buildTrackStemProject(project, "nope", true)).toBeUndefined();
  });

  it("a bus stem keeps what feeds the bus (and upstream buses), strips the bus's own processing and mutes the rest", () => {
    const project = makeProject(
      [track("feeder", { output: "b1" }), track("sender", { sends: [{ id: "s", busId: "b1", level: 1, preFader: false }] }), track("other")],
      [bus("b1", { pluginRack: rack, rack: { effects: [], volume: 0.3 }, output: "b2" }), bus("child", { output: "b1", pluginRack: rack }), bus("b2")],
    );
    const stem = buildBusStemProject(project, "b1", new Map([["feeder", true], ["sender", false], ["other", true]]))!;
    const buses = stem.timeline.audioBuses!;
    expect(buses.map((b) => b.id).sort()).toEqual([RACK_STEM_SINK_ID, "b1", "child"].sort());
    const b1 = buses.find((b) => b.id === "b1")!;
    expect(b1.rack).toBeUndefined();
    expect(b1.pluginRack).toBeUndefined();
    expect(b1.output).toBeUndefined();
    expect(buses.find((b) => b.id === "child")?.pluginRack, "upstream buses keep their plugins (resolved first)").toBeDefined();
    const byId = new Map(stem.timeline.tracks.map((t) => [t.id, t]));
    expect(byId.get("feeder")?.muted).toBe(false);
    expect(byId.get("sender")?.muted, "a track silenced in the real mix stays silent in the stem").toBe(true);
    expect(byId.get("other")?.muted, "a track that does not feed the bus is muted").toBe(true);
    expect(byId.get("sender")?.output, "a send-only track must not leak its dry signal into the stem").toBe(RACK_STEM_SINK_ID);
    expect(stem.timeline.masterAudioRack).toBeUndefined();
  });

  it("applies stems: a stemmed track only loses its rack; a stemmed bus parks its feeders and gets a synthetic stem track", () => {
    const project = makeProject(
      [track("t1", { pluginRack: rack }), track("feeder", { output: "b1" }), track("sender", { sends: [{ id: "s", busId: "b1", level: 0.5, preFader: true }] })],
      [bus("b1", { pluginRack: rack }), bus("child", { output: "b1" })],
    );
    const onlyTrack = applyRackStemsToTimeline(project.timeline, new Set(["t1"]));
    expect(onlyTrack.tracks[0].pluginRack).toBeUndefined();
    expect(onlyTrack.audioBuses?.find((b) => b.id === "b1")?.pluginRack, "an unstemmed bus keeps its rack (it plays dry)").toBeDefined();
    expect(onlyTrack.audioBuses?.some((b) => b.id === RACK_STEM_SINK_ID)).toBe(false);

    const withBus = applyRackStemsToTimeline(project.timeline, new Set(["b1"]));
    const byId = new Map(withBus.tracks.map((t) => [t.id, t]));
    expect(byId.get("feeder")?.output).toBe(RACK_STEM_SINK_ID);
    expect(byId.get("sender")?.sends?.[0]).toMatchObject({ busId: RACK_STEM_SINK_ID, level: 0.5, preFader: true });
    expect(withBus.audioBuses?.find((b) => b.id === "child")?.output).toBe(RACK_STEM_SINK_ID);
    expect(withBus.audioBuses?.find((b) => b.id === "b1")?.pluginRack).toBeUndefined();
    expect(withBus.audioBuses?.find((b) => b.id === RACK_STEM_SINK_ID)?.muted).toBe(true);
    expect(byId.get(rackStemTrackId("b1"))).toMatchObject({ output: "b1", clips: [], muted: false });
    expect(isSunkTrack(byId.get("feeder")!)).toBe(true);
    expect(isSunkTrack(byId.get("sender")!), "a track with a dry path to the master is not sunk").toBe(false);
    expect(project.timeline.tracks.find((t) => t.id === "feeder")?.output, "the input timeline is not mutated").toBe("b1");
    expect(applyRackStemsToTimeline(project.timeline, new Set())).toBe(project.timeline);
  });
});

describe("live preview switch on a rack", () => {
  const plugin = createNativePluginEffect("fx1", { id: "au:aufx:dely:appl", format: "au", name: "AUDelay", vendor: "Apple" });
  const owner = { id: "t1", pluginRack: { plugins: [plugin] } };
  const ids = { actionId: "a1" };

  it("is live unless the rack says otherwise", () => {
    expect(rackIsLive(undefined)).toBe(true);
    expect(rackIsLive({ plugins: [plugin] })).toBe(true);
    expect(rackIsLive({ plugins: [plugin], livePreview: false })).toBe(false);
  });

  it("survives sanitising, but only the non-default value is stored", () => {
    expect(sanitizePluginRack({ plugins: [plugin], livePreview: false })).toMatchObject({ livePreview: false });
    expect(sanitizePluginRack({ plugins: [plugin], livePreview: true })).not.toHaveProperty("livePreview");
  });

  it("is one undoable action each way and a no-op when nothing changes", () => {
    expect(planSetRackLivePreview(owner, true, ids)).toBeNull();
    const off = planSetRackLivePreview(owner, false, ids, 1);
    expect(off).toMatchObject({ type: "audioPluginRack/set", params: { target: "t1", rack: { livePreview: false } } });
    const back = planSetRackLivePreview({ id: "t1", pluginRack: (off!.params as { rack: never }).rack }, true, ids, 2);
    expect(back!.params).toMatchObject({ rack: { plugins: [plugin] } });
    expect((back!.params as { rack: object }).rack).not.toHaveProperty("livePreview");
    expect(planSetRackLivePreview({ id: "t1" }, false, ids)).toBeNull();
  });

  it("other edits keep the switch", () => {
    const rendered = { id: "t1", pluginRack: { plugins: [plugin], livePreview: false as const, keyframes: [{ id: "k", time: 1, property: nativePluginKeyframeProperty("fx1", "0"), value: 5, easing: "linear" as const }] } };
    const cleared = planClearRackParameterKeyframes(rendered, "fx1", "0", ids);
    expect(cleared!.params).toMatchObject({ rack: { livePreview: false } });
    const added = planAddRackPlugin(rendered, { id: "au:aufx:lpas:appl", format: "au", name: "AULowpass", vendor: "Apple" }, { actionId: "a2", effectId: "fx2" });
    expect(added!.params).toMatchObject({ rack: { livePreview: false } });
  });

  it("never changes a render fingerprint", () => {
    expect(rackForFingerprint({ plugins: [plugin], livePreview: false })).toEqual(rackForFingerprint({ plugins: [plugin] }));
    expect(rackForFingerprint(undefined)).toBeUndefined();
  });
});
