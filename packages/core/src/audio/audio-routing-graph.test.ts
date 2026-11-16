import { describe, expect, it } from "vitest";
import type { AudioBus, AudioSend, Timeline, Track } from "../types/timeline";
import { AudioRoutingGraph, buildOfflineTrackChain } from "./audio-routing-graph";
import { hasAudioRouting, isolateBusStem } from "./audio-routing";
import type { Project } from "../types/project";

/**
 * A tiny Web Audio evaluator: gain nodes with scheduled params and an
 * (identity-at-centre) stereo panner, enough to run the SAME node graph the
 * offline mixdown and the realtime graph build, on synthetic signals, and
 * compare it with closed-form math.
 */
interface FakeParam {
  value: number;
  events: Array<{ kind: "set" | "ramp"; value: number; time: number }>;
  cancelScheduledValues(t: number): void;
  setValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
}
interface FakeNode {
  kind: "gain" | "pan" | "master";
  gain?: FakeParam;
  pan?: FakeParam;
  inputs: FakeNode[];
  connect(dest: FakeNode): FakeNode;
  disconnect(dest?: FakeNode): void;
  outputs: Set<FakeNode>;
}

function param(initial = 1): FakeParam {
  const p: FakeParam = {
    value: initial,
    events: [],
    cancelScheduledValues(t) {
      p.events = p.events.filter((e) => e.time < t);
    },
    setValueAtTime(v, t) {
      p.events.push({ kind: "set", value: v, time: t });
    },
    linearRampToValueAtTime(v, t) {
      p.events.push({ kind: "ramp", value: v, time: t });
    },
  };
  return p;
}

function valueAt(p: FakeParam, t: number): number {
  let value = p.value;
  let lastTime = -Infinity;
  const events = [...p.events].sort((a, b) => a.time - b.time);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind === "set") {
      if (e.time <= t) {
        value = e.value;
        lastTime = e.time;
      } else break;
    } else if (e.time <= t) {
      value = e.value;
      lastTime = e.time;
    } else {
      // ramping from the previous event value towards e at e.time
      const from = lastTime === -Infinity ? p.value : value;
      const start = lastTime === -Infinity ? 0 : lastTime;
      return from + ((e.value - from) * (t - start)) / (e.time - start);
    }
  }
  return value;
}

function makeContext() {
  const all: FakeNode[] = [];
  const make = (kind: FakeNode["kind"]): FakeNode => {
    const node: FakeNode = {
      kind,
      inputs: [],
      outputs: new Set(),
      connect(dest) {
        node.outputs.add(dest);
        dest.inputs.push(node);
        return dest;
      },
      disconnect(dest?: FakeNode) {
        for (const out of dest ? [dest] : node.outputs) {
          out.inputs = out.inputs.filter((n) => n !== node);
          node.outputs.delete(out);
        }
      },
    };
    if (kind === "gain") node.gain = param(1);
    if (kind === "pan") node.pan = param(0);
    all.push(node);
    return node;
  };
  const master = make("master");
  const ctx = {
    currentTime: 0,
    sampleRate: 1000,
    destination: master,
    createGain: () => make("gain"),
    createStereoPanner: () => make("pan"),
  } as unknown as BaseAudioContext;
  return { ctx, master, make };
}

/** Pull-evaluates `node` at time t for stereo sources keyed by node. */
function evaluate(node: FakeNode, t: number, sources: Map<FakeNode, [number, number]>): [number, number] {
  let l = 0;
  let r = 0;
  const own = sources.get(node);
  if (own) {
    l += own[0];
    r += own[1];
  }
  for (const input of node.inputs) {
    const [il, ir] = evaluate(input, t, sources);
    l += il;
    r += ir;
  }
  if (node.kind === "gain") {
    const g = valueAt(node.gain!, t);
    return [l * g, r * g];
  }
  if (node.kind === "pan") {
    const pan = valueAt(node.pan!, t);
    if (pan === 0) return [l, r];
    const x = pan <= 0 ? pan + 1 : pan;
    const a = (x * Math.PI) / 2;
    return pan <= 0 ? [l + r * Math.cos(a), r * Math.sin(a)] : [l * Math.cos(a), r + l * Math.sin(a)];
  }
  return [l, r];
}

const track = (id: string, extra: Partial<Track> = {}): Track =>
  ({ id, type: "audio", name: id, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;
const bus = (id: string, extra: Partial<AudioBus> = {}): AudioBus => ({ id, name: id, muted: false, solo: false, ...extra });
const send = (id: string, busId: string, extra: Partial<AudioSend> = {}): AudioSend => ({ id, busId, level: 1, preFader: false, ...extra });
const tl = (tracks: Track[], audioBuses?: AudioBus[]): Pick<Timeline, "tracks" | "audioBuses"> => ({ tracks, ...(audioBuses ? { audioBuses } : {}) });

/** Builds the offline graph and returns the master output at time t for per-track input levels. */
function mix(
  timeline: Pick<Timeline, "tracks" | "audioBuses">,
  levels: Record<string, number>,
  t = 0,
  window = { timelineStart: 0, duration: 4 },
) {
  const { ctx, master } = makeContext();
  const routing = hasAudioRouting(timeline)
    ? new AudioRoutingGraph(ctx, master as unknown as AudioNode, { live: false, window })
    : null;
  routing?.configure(timeline);
  const sources = new Map<FakeNode, [number, number]>();
  for (const tr of timeline.tracks) {
    const input = buildOfflineTrackChain(ctx, routing, tr, master as unknown as AudioNode);
    const entry = (input ?? master) as unknown as FakeNode;
    const v = levels[tr.id] ?? 0;
    const prev = sources.get(entry) ?? [0, 0];
    sources.set(entry, [prev[0] + v, prev[1] + v]);
  }
  return evaluate(master, t, sources);
}

describe("routing graph math (shared by offline mixdown and realtime graph)", () => {
  it("projects without routing build no chain at all (bit-exact with the pre-routing mix)", () => {
    const timeline = tl([track("a"), track("b")]);
    expect(hasAudioRouting(timeline)).toBe(false);
    expect(hasAudioRouting(tl([track("a")], []))).toBe(false);
    const { ctx, master } = makeContext();
    for (const t of timeline.tracks) {
      expect(buildOfflineTrackChain(ctx, null, t, master as unknown as AudioNode)).toBeUndefined();
    }
    expect(mix(timeline, { a: 0.3, b: 0.25 })).toEqual([0.55, 0.55]);
  });

  it("routes a track through a bus fader into the master and leaves the others alone", () => {
    const timeline = tl(
      [track("a", { output: "dlg" }), track("b")],
      [bus("dlg", { rack: { effects: [], volume: 0.5 } })],
    );
    const [l] = mix(timeline, { a: 0.8, b: 0.2 });
    expect(l).toBeCloseTo(0.8 * 0.5 + 0.2, 12);
  });

  it("applies the track fader, then the bus fader, along a bus chain", () => {
    const timeline = tl(
      [track("a", { output: "sub", audioRack: { effects: [], volume: 0.5 } })],
      [bus("sub", { output: "grp", rack: { effects: [], volume: 2 } }), bus("grp", { rack: { effects: [], volume: 0.25 } })],
    );
    expect(mix(timeline, { a: 1 })[0]).toBeCloseTo(0.5 * 2 * 0.25, 12);
  });

  it("pre-fader sends ignore the track fader, post-fader sends follow it", () => {
    const base = (pre: boolean) =>
      tl(
        [track("a", { audioRack: { effects: [], volume: 0.5 }, sends: [send("s", "fx", { level: 0.4, preFader: pre })] })],
        [bus("fx")],
      );
    // main path (0.5) + send
    expect(mix(base(true), { a: 1 })[0]).toBeCloseTo(0.5 + 0.4, 12);
    expect(mix(base(false), { a: 1 })[0]).toBeCloseTo(0.5 + 0.5 * 0.4, 12);
  });

  it("a track can play into one bus and send to another that feeds the first", () => {
    const timeline = tl(
      [track("a", { output: "dry", sends: [send("s", "wet", { level: 0.5 })] })],
      [bus("dry"), bus("wet", { output: "dry", rack: { effects: [], volume: 2 } })],
    );
    expect(mix(timeline, { a: 1 })[0]).toBeCloseTo(1 + 0.5 * 2, 12);
  });

  it("send-level automation follows the render window (linear between points)", () => {
    const timeline = tl(
      [track("a", { sends: [send("s", "fx", { level: 0, automation: [{ time: 1, value: 0 }, { time: 3, value: 1 }] })], output: "dry" })],
      [bus("dry", { muted: true }), bus("fx")],
    );
    // main path is muted (dry bus muted) so only the send is audible
    const at = (t: number, start: number) => mix(timeline, { a: 1 }, t, { timelineStart: start, duration: 4 })[0];
    expect(at(0, 0)).toBeCloseTo(0, 9); // timeline t=0
    expect(at(2, 0)).toBeCloseTo(0.5, 9); // timeline t=2 (halfway through the ramp)
    expect(at(0.5, 2)).toBeCloseTo(0.75, 9); // window starts at t=2: ctx 0.5 = timeline 2.5
    expect(at(1, 2)).toBeCloseTo(1, 9); // timeline 3
  });

  it("bus fader automation replaces the fader value and respects mute", () => {
    const timeline = tl(
      [track("a", { output: "m" })],
      [bus("m", { rack: { effects: [], volume: 1 }, automation: { volume: [{ time: 0, value: 0 }, { time: 2, value: 2 }] } })],
    );
    expect(mix(timeline, { a: 1 }, 1)[0]).toBeCloseTo(1, 9);
    const muted = tl([track("a", { output: "m" })], [bus("m", { muted: true })]);
    expect(mix(muted, { a: 1 })[0]).toBe(0);
  });

  it("solo on one bus silences the other buses but not the master-routed tracks", () => {
    const timeline = tl(
      [track("a", { output: "x" }), track("b", { output: "y" }), track("c")],
      [bus("x", { solo: true }), bus("y")],
    );
    expect(mix(timeline, { a: 0.1, b: 0.2, c: 0.4 })[0]).toBeCloseTo(0.1 + 0.4, 12);
  });

  it("a soloed bus keeps the bus it plays into audible", () => {
    const timeline = tl([track("a", { output: "x" })], [bus("x", { solo: true, output: "grp" }), bus("grp")]);
    expect(mix(timeline, { a: 0.5 })[0]).toBeCloseTo(0.5, 12);
  });

  it("matches an independent reference mixer on a random-ish routing graph", () => {
    const tracks = [
      track("t1", { output: "b1", audioRack: { effects: [], volume: 0.7 }, sends: [send("s1", "b2", { level: 0.3, preFader: true })] }),
      track("t2", { output: "b2", sends: [send("s2", "b1", { level: 1.5 })] }),
      track("t3"),
    ];
    const buses = [bus("b1", { output: "b2", rack: { effects: [], volume: 0.8 } }), bus("b2", { rack: { effects: [], volume: 1.25 } })];
    const x = { t1: 0.6, t2: -0.4, t3: 0.15 };
    // reference
    const b1 = (x.t1 * 0.7 + x.t2 * 1.5) * 0.8;
    const b2 = (x.t1 * 0.3 + x.t2 + b1) * 1.25;
    const expected = b2 + x.t3;
    expect(mix(tl(tracks, buses), x)[0]).toBeCloseTo(expected, 12);
  });

  it("live buses reconcile incrementally: params retarget, structure rebuilds", () => {
    const { ctx, master } = makeContext();
    const routing = new AudioRoutingGraph(ctx, master as unknown as AudioNode, { live: true, getTimelineTime: () => 0, getHorizon: () => 60 });
    const t0 = tl([track("a", { output: "x" })], [bus("x")]);
    expect(routing.configure(t0)).toBe(true);
    const faderBefore = routing.getBusOutput("x");
    expect(routing.configure(tl([track("a", { output: "x" })], [bus("x", { rack: { effects: [], volume: 0.5 } })]))).toBe(false);
    expect(routing.getBusOutput("x")).toBe(faderBefore);
    expect(routing.configure(tl([track("a")], [bus("x")]))).toBe(true);
    routing.dispose();
    expect(routing.getBusOutput("x")).toBeUndefined();
  });
});

describe("review fixes", () => {
  it("re-wiring a track's sends leaves no orphan fan-out on its taps", () => {
    const { ctx, master } = makeContext();
    const timeline = tl([track("a", { sends: [send("s", "fx")] })], [bus("fx")]);
    const routing = new AudioRoutingGraph(ctx, master as unknown as AudioNode, { live: true });
    routing.configure(timeline);
    const pre = ctx.createGain();
    const post = ctx.createGain();
    for (let i = 0; i < 5; i++) routing.connectSends(timeline.tracks[0], pre, post);
    expect((post as unknown as FakeNode).outputs.size).toBe(1);
    routing.disconnectSends("a");
    expect((post as unknown as FakeNode).outputs.size).toBe(0);
  });

  it("a stem holds only the bus: the dry signal of a send-only track does not leak to the master", () => {
    const timeline = tl(
      [
        track("only-send", { sends: [send("s", "stem", { level: 0.5 })] }),
        track("other-bus", { output: "other", sends: [send("s2", "stem", { level: 0.5 })] }),
        track("direct", { output: "stem" }),
        track("unrelated"),
      ],
      [bus("stem"), bus("other")],
    );
    const project = { timeline, settings: {} } as unknown as Project;
    const iso = isolateBusStem(project, "stem")!.timeline;
    const audible = Object.fromEntries(iso.tracks.map((t) => [t.id, t.muted ? 0 : 1]));
    // 0.5 (send) + 0.5 (send) + 1 (direct) = 2; no dry 1 + 1 leaked, nothing from "unrelated"
    expect(mix(iso, audible)[0]).toBeCloseTo(2, 12);
  });
});
