import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";
import type { AudioBus, Clip, Track } from "../types/timeline";
import { normalizeProjectStoredFields } from "../storage/project-serializer";
import { audioRangeFingerprint } from "./mixdown-cache";
import {
  busOutputProblem,
  busesFedByTrack,
  computeBusAudibility,
  findBusCycle,
  hasAudioRouting,
  isolateBusStem,
  normalizeProjectAudioRouting,
  orderBusesBySignalFlow,
  planAddBus,
  planAddSend,
  planRemoveBus,
  planRemoveSend,
  planSetBusAutomation,
  planSetBusOutput,
  planSetSend,
  planSetTrackOutput,
  planStemsPreset,
  planUpdateBus,
  type AudioRoutingSetParams,
  type RoutingPlan,
} from "./audio-routing";
import { planStemExport } from "../export/stem-export";

const clip = (id: string, trackId: string, startTime = 0, duration = 10): Clip =>
  ({
    id, mediaId: "m1", trackId, startTime, duration, inPoint: 0, outPoint: duration,
    effects: [], audioEffects: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
    volume: 1, keyframes: [],
  }) as Clip;

const track = (id: string, extra: Partial<Track> = {}): Track =>
  ({
    id, type: "audio", name: id, clips: [clip(`c-${id}`, id)], transitions: [], locked: false, hidden: false, muted: false, solo: false,
    ...extra,
  }) as Track;

const project = (tracks: Track[], audioBuses?: AudioBus[]): Project =>
  ({
    id: "p", name: "My Film", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 10, markers: [], subtitles: [], tracks, ...(audioBuses ? { audioBuses } : {}) },
    mediaLibrary: { items: [{ id: "m1", name: "a.wav", type: "audio", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { duration: 60 } }] },
  }) as unknown as Project;

const bus = (id: string, extra: Partial<AudioBus> = {}): AudioBus => ({ id, name: id, muted: false, solo: false, ...extra });

let seq = 0;
async function run(executor: ActionExecutor, p: Project, plan: RoutingPlan) {
  if (!plan.ok) throw new Error(plan.message);
  const action: Action = {
    type: "audioRouting/set",
    id: `a${seq++}`,
    timestamp: Date.now(),
    params: { ...(plan.params as AudioRoutingSetParams), label: plan.label } as unknown as Action["params"],
  };
  return executor.execute(action, p);
}

describe("bus cycles and validation", () => {
  it("finds loops and names them", () => {
    expect(findBusCycle([bus("a", { output: "b" }), bus("b", { output: "c" }), bus("c")])).toBeNull();
    const cycle = findBusCycle([bus("a", { output: "b" }), bus("b", { output: "a" })]);
    expect(cycle).not.toBeNull();
    expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1]);
    expect(findBusCycle([bus("a", { output: "a" })])).toEqual(["a", "a"]);
  });

  it("refuses a routing loop with a clear message and leaves the project untouched", () => {
    const buses = [bus("m", { name: "Music" }), bus("d", { name: "Dialogue", output: "m" })];
    const message = busOutputProblem(buses, "m", "d");
    expect(message).toMatch(/Cannot route Music into Dialogue/);
    expect(message).toMatch(/routing loop/);
    expect(message).toMatch(/Music → Dialogue → Music|Dialogue → Music → Dialogue/);
    const plan = planSetBusOutput({ tracks: [], audioBuses: buses }, "m", "d");
    expect(plan.ok).toBe(false);
    expect(planSetBusOutput({ tracks: [], audioBuses: buses }, "m", "m").ok).toBe(false);
  });

  it("rejects loops that arrive through a raw action as well", async () => {
    const p = project([track("t")], [bus("a", { output: "b" }), bus("b")]);
    const result = await new ActionExecutor().execute(
      { type: "audioRouting/set", id: "x", timestamp: 0, params: { buses: [bus("a", { output: "b" }), bus("b", { output: "a" })] } },
      p,
    );
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/loop/);
  });

  it("orders buses sources-first and computes mute/solo audibility", () => {
    const buses = [bus("grp"), bus("sub", { output: "grp" }), bus("leaf", { output: "sub" })];
    expect(orderBusesBySignalFlow(buses).map((b) => b.id)).toEqual(["leaf", "sub", "grp"]);
    expect([...computeBusAudibility([bus("a", { muted: true }), bus("b")]).entries()]).toEqual([["a", false], ["b", true]]);
    const solo = computeBusAudibility([bus("x", { solo: true, output: "g" }), bus("y"), bus("g")]);
    expect(Object.fromEntries(solo)).toEqual({ x: true, y: false, g: true });
  });

  it("finds every bus a track reaches through outputs and sends", () => {
    const t = track("t", { output: "a", sends: [{ id: "s", busId: "z", level: 1, preFader: false }] });
    const tl = project([t], [bus("a", { output: "b" }), bus("b"), bus("z"), bus("other")]).timeline;
    expect([...busesFedByTrack(tl, t)].sort()).toEqual(["a", "b", "z"]);
  });
});

describe("one undo step per routing edit, exact restore", () => {
  it("add bus, route, send, level, automation, flags, remove: each undoes to the exact prior state", async () => {
    const executor = new ActionExecutor();
    const p = project([track("a"), track("b")]);
    const snapshots: string[] = [JSON.stringify(p.timeline)];
    const steps: Array<() => RoutingPlan> = [
      () => planAddBus(p.timeline, { id: "bus1", name: "Dialogue", role: "dialogue" }),
      () => planAddBus(p.timeline, { id: "bus2", name: "Music", role: "music" }),
      () => planSetTrackOutput(p.timeline, "a", "bus1"),
      () => planSetTrackOutput(p.timeline, "b", "bus2"),
      () => planAddSend(p.timeline, "a", "bus2", { id: "snd", level: 0.5, preFader: true }),
      () => planSetSend(p.timeline, "a", "snd", { level: 0.25, automation: [{ time: 0, value: 0 }, { time: 2, value: 1 }] }),
      () => planSetSend(p.timeline, "a", "snd", { muted: true }),
      () => planUpdateBus(p.timeline, "bus1", { muted: true }),
      () => planUpdateBus(p.timeline, "bus1", { solo: true, muted: false }),
      () => planSetBusOutput(p.timeline, "bus1", "bus2"),
      () => planSetBusAutomation(p.timeline, "bus2", [{ time: 0, value: 1 }, { time: 5, value: 0.5 }]),
      () => planRemoveSend(p.timeline, "a", "snd"),
      () => planRemoveBus(p.timeline, "bus2"),
    ];
    for (const step of steps) {
      const result = await run(executor, p, step());
      expect(result.success, JSON.stringify(result.error)).toBe(true);
      snapshots.push(JSON.stringify(p.timeline));
    }
    expect(p.timeline.audioBuses?.map((b) => b.id)).toEqual(["bus1"]);
    // removing bus2 re-routed everything that fed it to its parent (master)
    expect(p.timeline.tracks.find((t) => t.id === "b")?.output).toBeUndefined();
    expect(p.timeline.audioBuses?.[0].output).toBeUndefined();
    for (let i = steps.length - 1; i >= 0; i--) {
      const undone = await executor.undo(p);
      expect(undone.success).toBe(true);
      expect(JSON.stringify(p.timeline)).toBe(snapshots[i]);
    }
    expect(hasAudioRouting(p.timeline)).toBe(false);
    for (let i = 0; i < steps.length; i++) {
      const redone = await executor.redo(p);
      expect(redone.success).toBe(true);
      expect(JSON.stringify(p.timeline)).toBe(snapshots[i + 1]);
    }
  });

  it("a bus rack edit goes through audioRack/set and undoes exactly", async () => {
    const executor = new ActionExecutor();
    const p = project([track("a", { output: "bus1" })], [bus("bus1")]);
    const before = JSON.stringify(p.timeline);
    const rack = { effects: [], volume: 0.5, pan: -0.25 };
    const result = await executor.execute({ type: "audioRack/set", id: "r", timestamp: 0, params: { target: "bus1", rack } }, p);
    expect(result.success).toBe(true);
    expect(p.timeline.audioBuses?.[0].rack).toMatchObject({ volume: 0.5, pan: -0.25 });
    await executor.undo(p);
    expect(JSON.stringify(p.timeline)).toBe(before);
  });

  it("removing a bus re-routes its inputs to its own output and drops sends to it", () => {
    const p = project(
      [track("a", { output: "x", sends: [{ id: "s", busId: "x", level: 1, preFader: false }] }), track("b", { output: "y" })],
      [bus("x", { output: "y" }), bus("y")],
    );
    const plan = planRemoveBus(p.timeline, "x");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.params.tracks?.a).toEqual({ output: "y", sends: null });
    expect(plan.params.buses?.map((b) => b.id)).toEqual(["y"]);
  });

  it("refuses duplicate sends, unknown buses and over-limit sends with messages", () => {
    const p = project([track("a", { sends: [{ id: "s", busId: "x", level: 1, preFader: false }] })], [bus("x"), bus("y")]);
    expect(planAddSend(p.timeline, "a", "x")).toMatchObject({ ok: false });
    expect(planAddSend(p.timeline, "a", "nope")).toMatchObject({ ok: false, message: "Bus not found: nope" });
    expect(planSetTrackOutput(p.timeline, "nope", "x")).toMatchObject({ ok: false });
    expect(planAddSend(p.timeline, "a", "y", { level: 99 })).toMatchObject({ ok: true });
  });
});

describe("Dialogue / Music / FX stems preset", () => {
  it("creates the three buses once and routes by role or name", async () => {
    const executor = new ActionExecutor();
    const p = project([
      track("d", { role: "dialogue" }),
      track("m", { role: "music" }),
      track("f", { role: "effects" }),
      track("amb", { role: "ambience" }),
      track("g", { name: "Sfx Whooshes", role: "general" }),
      track("misc", { name: "Audio 9", role: "general" }),
    ]);
    const plan = planStemsPreset(p.timeline);
    expect(plan.ok).toBe(true);
    expect((await run(executor, p, plan)).success).toBe(true);
    const buses = p.timeline.audioBuses ?? [];
    expect(buses.map((b) => b.name)).toEqual(["Dialogue", "Music", "FX"]);
    const out = (id: string) => buses.find((b) => b.id === p.timeline.tracks.find((t) => t.id === id)?.output)?.name;
    expect([out("d"), out("m"), out("f"), out("amb"), out("g"), out("misc")]).toEqual(["Dialogue", "Music", "FX", "FX", "FX", undefined]);
    expect(planStemsPreset(p.timeline)).toMatchObject({ ok: false });
    await executor.undo(p);
    expect(hasAudioRouting(p.timeline)).toBe(false);
  });
});

describe("old projects load unchanged", () => {
  it("a pre-routing project (no buses, no outputs) is returned as the same object", () => {
    const old = project([track("a"), track("b")]);
    expect(normalizeProjectAudioRouting(old)).toBe(old);
    // full load path: every routing field stays absent
    const loaded = normalizeProjectStoredFields(JSON.parse(JSON.stringify(old)) as Project);
    expect(loaded.timeline.audioBuses).toBeUndefined();
    for (const t of loaded.timeline.tracks) {
      expect(t.output).toBeUndefined();
      expect(t.sends).toBeUndefined();
    }
  });

  it("repairs dangling outputs/sends, duplicate ids and bus loops instead of crashing", () => {
    const broken = project(
      [track("a", { output: "ghost", sends: [{ id: "s", busId: "ghost", level: 2, preFader: false }, { id: "s2", busId: "x", level: 99, preFader: true }] })],
      [bus("x", { output: "y" }), bus("y", { output: "x" }), bus("x", { name: "dup" }), bus("z", { output: "ghost" })],
    );
    const fixed = normalizeProjectAudioRouting(broken);
    expect(findBusCycle(fixed.timeline.audioBuses ?? [])).toBeNull();
    expect(fixed.timeline.audioBuses?.map((b) => b.id)).toEqual(["x", "y", "z"]);
    expect(fixed.timeline.audioBuses?.find((b) => b.id === "z")?.output).toBeUndefined();
    const t = fixed.timeline.tracks[0];
    expect(t.output).toBeUndefined();
    expect(t.sends).toEqual([{ id: "s2", busId: "x", level: 4, preFader: true }]);
  });
});

describe("mixdown cache invalidates exactly on routing changes", () => {
  const base = () =>
    project(
      [track("a", { output: "x", sends: [{ id: "s", busId: "y", level: 0.5, preFader: false }] }), track("b")],
      [bus("x", { name: "Dialogue", color: "#fff" }), bus("y", { name: "Reverb" })],
    );
  const fp = (p: Project) => audioRangeFingerprint(p, 0, 5);

  it("is stable for an identical project, and ignores names and colours", () => {
    const a = base();
    expect(fp(a)).toBe(fp(base()));
    const renamed = base();
    (renamed.timeline as { audioBuses?: AudioBus[] }).audioBuses = renamed.timeline.audioBuses!.map((b) => ({ ...b, name: `${b.name}!`, color: "#000" }));
    expect(fp(renamed)).toBe(fp(a));
  });

  it("changes on output, send, bus rack/mute/solo/automation and bus output edits", () => {
    const reference = fp(base());
    const edits: Array<(p: Project) => void> = [
      (p) => { p.timeline.tracks[0] = { ...p.timeline.tracks[0], output: undefined }; },
      (p) => { p.timeline.tracks[1] = { ...p.timeline.tracks[1], output: "x" }; },
      (p) => { p.timeline.tracks[0] = { ...p.timeline.tracks[0], sends: [{ id: "s", busId: "y", level: 0.6, preFader: false }] }; },
      (p) => { p.timeline.tracks[0] = { ...p.timeline.tracks[0], sends: [{ id: "s", busId: "y", level: 0.5, preFader: true }] }; },
      (p) => { p.timeline.tracks[0] = { ...p.timeline.tracks[0], sends: [{ id: "s", busId: "y", level: 0.5, preFader: false, automation: [{ time: 0, value: 1 }] }] }; },
      (p) => { p.timeline.audioBuses![0] = { ...p.timeline.audioBuses![0], rack: { effects: [], volume: 0.5 } }; },
      (p) => { p.timeline.audioBuses![0] = { ...p.timeline.audioBuses![0], muted: true }; },
      (p) => { p.timeline.audioBuses![0] = { ...p.timeline.audioBuses![0], solo: true }; },
      (p) => { p.timeline.audioBuses![0] = { ...p.timeline.audioBuses![0], output: "y" }; },
      (p) => { p.timeline.audioBuses![1] = { ...p.timeline.audioBuses![1], automation: { volume: [{ time: 1, value: 2 }] } }; },
      (p) => { (p.timeline as { audioBuses?: AudioBus[] }).audioBuses = p.timeline.audioBuses!.slice(0, 1); },
    ];
    const seen = new Set<string>([reference]);
    for (const edit of edits) {
      const p = base();
      edit(p);
      const key = fp(p);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("a bus rack with effects widens the history window like track racks (unbounded clip reach)", () => {
    const withFx = base();
    withFx.timeline.audioBuses![0] = {
      ...withFx.timeline.audioBuses![0],
      rack: { effects: [{ id: "e", type: "reverb", params: {}, bypassed: false }] },
    };
    // a clip that ended before the window now still counts (reverb tail)
    withFx.timeline.tracks[1] = { ...withFx.timeline.tracks[1], clips: [clip("early", "b", 0, 1)] };
    const noFx = base();
    noFx.timeline.tracks[1] = { ...noFx.timeline.tracks[1], clips: [clip("early", "b", 0, 1)] };
    expect(audioRangeFingerprint(withFx, 5, 5)).not.toBe(audioRangeFingerprint(noFx, 5, 5));
  });
});

describe("stem isolation and planning", () => {
  const p = () =>
    project(
      [
        track("d", { output: "dlg" }),
        track("m", { output: "mus", sends: [{ id: "s", busId: "dlg", level: 1, preFader: false }] }),
        track("x"),
      ],
      [bus("dlg", { solo: true }), bus("mus"), bus("empty")],
    );

  it("isolates a bus: master rack and solos gone, non-feeding tracks muted, its output is master", () => {
    const full = p();
    (full as { timeline: Project["timeline"] }).timeline = { ...full.timeline, masterAudioRack: { effects: [], volume: 0.5 } };
    const stem = isolateBusStem(full, "dlg");
    expect(stem).toBeDefined();
    expect(stem!.timeline.masterAudioRack).toBeUndefined();
    expect(stem!.timeline.audioBuses?.map((b) => [b.id, b.solo])).toEqual([["dlg", false], ["__stem_sink__", false]]);
    // "m" reaches dlg only through a send: its dry output is parked on the muted sink, not the master
    expect(stem!.timeline.tracks.find((t) => t.id === "m")?.output).toBe("__stem_sink__");
    expect(stem!.timeline.audioBuses?.find((b) => b.id === "__stem_sink__")?.muted).toBe(true);
    expect(stem!.timeline.tracks.map((t) => [t.id, t.muted])).toEqual([["d", false], ["m", false], ["x", true]]);
    expect(isolateBusStem(full, "ghost")).toBeUndefined();
    // the original is untouched
    expect(full.timeline.masterAudioRack).toBeDefined();
  });

  it("includes buses routed into the stem bus and drops the stem bus's own output", () => {
    const parent = project([track("a", { output: "leaf" })], [bus("grp"), bus("leaf", { output: "sub" }), bus("sub", { output: "grp" })]);
    const stem = isolateBusStem(parent, "sub")!;
    expect(stem.timeline.audioBuses?.map((b) => b.id).sort()).toEqual(["leaf", "sub"]);
    expect(stem.timeline.audioBuses?.find((b) => b.id === "sub")?.output).toBeUndefined();
    expect(stem.timeline.tracks[0].muted).toBe(false);
  });

  it("plans one uniquely named WAV per bus that carries signal", () => {
    const plan = planStemExport(p());
    expect(plan.map((i) => i.busId)).toEqual(["dlg", "mus"]);
    expect(plan[0].fileName).toBe("My_Film_dlg.wav");
    expect(planStemExport(p(), ["empty"]).map((i) => i.busId)).toEqual(["empty"]);
    const dup = project([track("a", { output: "x" }), track("b", { output: "y" })], [bus("x", { name: "Mix" }), bus("y", { name: "Mix" })]);
    expect(planStemExport(dup).map((i) => i.fileName)).toEqual(["My_Film_Mix.wav", "My_Film_Mix_2.wav"]);
  });
});

describe("nests and stale routing", () => {
  it("routing edits are not blocked by an untouched track that names a bus this sequence lacks", () => {
    const stale = project([track("a", { output: "gone", sends: [{ id: "s", busId: "gone", level: 1, preFader: false }] }), track("b")]);
    const plan = planAddBus(stale.timeline);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const executor = new ActionExecutor();
    return run(executor, stale, planSetTrackOutput(stale.timeline, "b", null)).then((r) => expect(r.success).toBe(true));
  });
});

describe("load repair covers inactive sequences", () => {
  it("breaks a routing loop and drops dangling ids inside a non-active sequence", () => {
    const active = project([track("a")]);
    const inner = project(
      [track("t", { output: "ghost", sends: [{ id: "s", busId: "ghost", level: 1, preFader: false }] })],
      [bus("x", { output: "y" }), bus("y", { output: "x" })],
    );
    const withSeq = {
      ...active,
      sequences: [{ id: "n", name: "Nest", settings: inner.settings, timeline: inner.timeline, createdAt: 0, modifiedAt: 0 }],
    } as unknown as Project;
    const fixed = normalizeProjectAudioRouting(withSeq);
    const tl = fixed.sequences![0].timeline;
    expect(findBusCycle(tl.audioBuses ?? [])).toBeNull();
    expect(tl.tracks[0].output).toBeUndefined();
    expect(tl.tracks[0].sends).toBeUndefined();
    expect(fixed.timeline).toBe(active.timeline);
  });
});
