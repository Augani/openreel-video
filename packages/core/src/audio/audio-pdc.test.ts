import { describe, expect, it } from "vitest";
import type { AudioBus, AudioSend, Timeline, Track } from "../types/timeline";
import { AudioRoutingGraph, buildOfflineTrackChain } from "./audio-routing-graph";

/**
 * Time-domain simulation of the routing graph: a click is a one-sample pulse,
 * every node is a pure function of time (gain, delay, sum). The "effects" of a
 * track are modelled as a DelayNode of exactly the latency the track reports,
 * which is what a lookahead effect does to a click.
 */
const SR = 1000; // 1 sample = 1 ms keeps the arithmetic exact
interface FakeParam {
  value: number;
  setValueAtTime(v: number, t: number): void;
  cancelScheduledValues(t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
}
interface FakeNode {
  kind: "gain" | "pan" | "delay" | "master";
  gain?: FakeParam;
  pan?: FakeParam;
  delayTime?: FakeParam;
  inputs: FakeNode[];
  outputs: Set<FakeNode>;
  connect(dest: FakeNode): FakeNode;
  disconnect(dest?: FakeNode): void;
}
const param = (initial: number): FakeParam => {
  const p: FakeParam = {
    value: initial,
    setValueAtTime(v) {
      p.value = v;
    },
    cancelScheduledValues() {},
    linearRampToValueAtTime(v) {
      p.value = v;
    },
  };
  return p;
};

function fakeContext() {
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
      disconnect(dest) {
        for (const out of dest ? [dest] : [...node.outputs]) {
          out.inputs = out.inputs.filter((n) => n !== node);
          node.outputs.delete(out);
        }
      },
    };
    if (kind === "gain") node.gain = param(1);
    if (kind === "pan") node.pan = param(0);
    if (kind === "delay") node.delayTime = param(0);
    return node;
  };
  const master = make("master");
  const delays: FakeNode[] = [];
  const ctx = {
    currentTime: 0,
    sampleRate: SR,
    destination: master,
    createGain: () => make("gain"),
    createStereoPanner: () => make("pan"),
    createDelay: () => {
      const d = make("delay");
      delays.push(d);
      return d;
    },
  } as unknown as BaseAudioContext;
  return { ctx, master, make, delays };
}

/** Output of `node` at sample time `t` given per-node source functions. */
function evaluate(node: FakeNode, t: number, sources: Map<FakeNode, (t: number) => number>): number {
  const at = node.kind === "delay" ? t - Math.round((node.delayTime?.value ?? 0) * SR) : t;
  let sum = sources.get(node)?.(at) ?? 0;
  for (const input of node.inputs) sum += evaluate(input, at, sources);
  return node.kind === "gain" ? sum * (node.gain?.value ?? 1) : sum;
}
const asNode = (n: FakeNode): AudioNode => n as unknown as AudioNode;
const click = (at: number) => (t: number) => (t === at ? 1 : 0);

const track = (id: string, extra: Partial<Track> = {}): Track =>
  ({ id, type: "audio", name: id, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;
const bus = (id: string, extra: Partial<AudioBus> = {}): AudioBus => ({ id, name: id, muted: false, solo: false, ...extra });
const send = (id: string, busId: string, extra: Partial<AudioSend> = {}): AudioSend => ({ id, busId, level: 1, preFader: false, ...extra });
const tl = (tracks: Track[], audioBuses?: AudioBus[]): Pick<Timeline, "tracks" | "audioBuses"> => ({ tracks, ...(audioBuses ? { audioBuses } : {}) });

/** Wires each track as: click -> "effects" delay (its latency) -> post-fader gain -> graph, and returns arrival times at the master. */
function arrivals(timeline: Pick<Timeline, "tracks" | "audioBuses">, latencies: Record<string, number>, clickAt = 100) {
  const { ctx, master, make } = fakeContext();
  const masterIn = make("gain");
  masterIn.connect(master);
  const routing = new AudioRoutingGraph(ctx, asNode(masterIn), { live: true });
  routing.configure(timeline);
  routing.setLatencies(new Map(Object.entries(latencies).map(([id, s]) => [id, s])), 0);
  const sources = new Map<FakeNode, (t: number) => number>();
  for (const t of timeline.tracks) {
    const effects = make("delay");
    effects.delayTime!.value = latencies[t.id] ?? 0;
    sources.set(effects, click(clickAt));
    const pre = make("gain");
    const post = make("gain");
    effects.connect(pre);
    pre.connect(post);
    routing.connectTrackOutput(t.id, asNode(post), t.output);
    if ((t.sends?.length ?? 0) > 0) routing.connectSends(t, asNode(pre), asNode(post));
  }
  const times: number[] = [];
  for (let t = 0; t < 400; t++) {
    const v = evaluate(master, t, sources);
    for (let k = 0; k < Math.round(v); k++) times.push(t);
  }
  return { times, routing };
}

describe("plugin delay compensation in the routing graph", () => {
  it("aligns parallel tracks with different effect latencies (the click stays on one sample)", () => {
    const { times, routing } = arrivals(tl([track("a"), track("b"), track("c")]), { a: 0.006, b: 0, c: 0.021 });
    // Every track's click leaves the graph together, `total` after it went in.
    expect(times).toEqual([121, 121, 121]);
    expect(routing.getTotalLatencySeconds()).toBeCloseTo(0.021, 12);
    expect(routing.getTrackDelaySeconds("b")).toBeCloseTo(0.021, 12);
  });

  it("aligns a send through a bus that has its own latency with the dry path", () => {
    const timeline = tl(
      [track("t", { sends: [send("s", "r")] }), track("u")],
      [bus("r", { rack: { effects: [] } })],
    );
    const { times } = arrivals(timeline, { t: 0.006, u: 0 });
    // t dry, t's send through bus r, and u (delayed by 6 ms) all leave together, 6 ms after the click.
    expect(times).toEqual([106, 106, 106]);
  });

  it("without any latency no delay node exists and the graph is the plain one", () => {
    const { ctx, master, make, delays } = fakeContext();
    void master;
    const masterIn = make("gain");
    const routing = new AudioRoutingGraph(ctx, asNode(masterIn), { live: true });
    routing.configure(tl([track("a"), track("b")]));
    routing.setLatencies(new Map([["a", 0], ["b", 0]]), 0);
    const out = make("gain");
    routing.connectTrackOutput("a", asNode(out), undefined);
    expect(delays).toHaveLength(0);
    expect(out.outputs.has(masterIn)).toBe(true);
    expect(routing.getTotalLatencySeconds()).toBe(0);
  });

  it("removes the delay again when the latency goes away, and re-plans when a rack changes", () => {
    const { ctx, make, delays } = fakeContext();
    const masterIn = make("gain");
    const routing = new AudioRoutingGraph(ctx, asNode(masterIn), { live: true });
    routing.configure(tl([track("a"), track("b")]));
    const a = make("gain");
    const b = make("gain");
    routing.setLatencies(new Map([["a", 0.01], ["b", 0]]), 0);
    routing.connectTrackOutput("a", asNode(a), undefined);
    routing.connectTrackOutput("b", asNode(b), undefined);
    expect(delays).toHaveLength(1);
    expect(b.outputs.has(delays[0])).toBe(true);
    expect(Math.round(delays[0].delayTime!.value * SR)).toBe(10);
    routing.setLatencies(new Map([["a", 0.01], ["b", 0.004]]), 0);
    expect(Math.round(delays[0].delayTime!.value * SR)).toBe(6);
    routing.setLatencies(new Map([["a", 0], ["b", 0]]), 0);
    expect(b.outputs.has(masterIn)).toBe(true);
    expect(b.outputs.has(delays[0])).toBe(false);
  });

  it("offline tracks that play straight into the master get their compensation delay", () => {
    const { ctx, make, delays } = fakeContext();
    const masterIn = make("gain");
    const input = buildOfflineTrackChain(ctx, null, track("b"), asNode(masterIn), 0.021);
    expect(input).toBeDefined();
    expect(delays).toHaveLength(1);
    expect(Math.round(delays[0].delayTime!.value * SR)).toBe(21);
    expect(delays[0].outputs.has(masterIn)).toBe(true);
    // A zero-latency, rack-less track with nothing to compensate still connects straight to the master.
    expect(buildOfflineTrackChain(ctx, null, track("c"), asNode(masterIn), 0)).toBeUndefined();
  });
});
