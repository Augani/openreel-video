import { describe, expect, it } from "vitest";
import {
  CH_C,
  CH_L,
  CH_LFE,
  CH_LS,
  CH_R,
  CH_RS,
  DEFAULT_SURROUND_PAN,
  DOWNMIX_5_1_TO_STEREO,
  SURROUND_CHANNELS,
  createSurroundPairs,
  createSurroundPanner,
  downmixSurroundToStereo,
  getChannelLayout,
  layoutSettingsPatch,
  mixChannelCount,
  resolveSurroundPan,
  sanitizeSurroundPan,
  sourceToSurroundMatrix,
  surroundPanGains,
} from "./surround";

const power = (gains: number[]) => gains.reduce((sum, g, i) => (i === CH_LFE ? sum : sum + g * g), 0);
const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

describe("channel layout setting", () => {
  it("is stereo unless the sequence says 5.1", () => {
    expect(getChannelLayout(undefined)).toBe("stereo");
    expect(getChannelLayout({ channels: 2 })).toBe("stereo");
    expect(getChannelLayout({ channels: 6 })).toBe("stereo"); // only the explicit layout switches the mix
    expect(getChannelLayout({ channelLayout: "5.1", channels: 6 })).toBe("5.1");
  });

  it("keeps the mixdown channel count of stereo (and mono) projects exactly as it was", () => {
    expect(mixChannelCount({ channels: 2 })).toBe(2);
    expect(mixChannelCount({ channels: 1 })).toBe(1);
    expect(mixChannelCount({})).toBe(2);
    expect(mixChannelCount({ channels: 2, channelLayout: "5.1" })).toBe(6);
  });

  it("changes layout and channel count together", () => {
    expect(layoutSettingsPatch("5.1")).toEqual({ channelLayout: "5.1", channels: 6 });
    expect(layoutSettingsPatch("stereo")).toEqual({ channelLayout: "stereo", channels: 2 });
  });
});

describe("surround panner gains", () => {
  const at = (x: number, y: number, divergence = 0, lfeSend = 0) => surroundPanGains({ x, y, divergence, lfeSend });

  it("places a source on one speaker at the corners of the room", () => {
    const frontLeft = at(-1, 1);
    close(frontLeft[CH_L], 1);
    [CH_R, CH_C, CH_LS, CH_RS].forEach((c) => close(frontLeft[c], 0));
    close(at(1, 1)[CH_R], 1);
    close(at(-1, -1)[CH_LS], 1);
    close(at(1, -1)[CH_RS], 1);
  });

  it("is a constant-power phantom image at front centre (the same -3 dB centre law as the stereo panner)", () => {
    const g = at(0, 1);
    close(g[CH_L], Math.SQRT1_2);
    close(g[CH_R], Math.SQRT1_2);
    close(g[CH_C], 0);
    close(g[CH_LS], 0);
  });

  it("sends the centre of the rear to both surrounds", () => {
    const g = at(0, -1);
    close(g[CH_LS], Math.SQRT1_2);
    close(g[CH_RS], Math.SQRT1_2);
    close(g[CH_L], 0);
    close(g[CH_C], 0);
  });

  it("keeps the speaker feeds at unit power wherever the source is and whatever the divergence", () => {
    for (let x = -1; x <= 1; x += 0.25) {
      for (let y = -1; y <= 1; y += 0.25) {
        for (const divergence of [0, 0.3, 1]) close(power(at(x, y, divergence)), 1);
      }
    }
  });

  it("divergence moves a centred front source into the centre speaker, and fades out towards the edges", () => {
    const full = at(0, 1, 1);
    close(full[CH_C], 1);
    close(full[CH_L], 0);
    close(full[CH_R], 0);
    const half = at(0, 1, 0.5);
    close(half[CH_C], Math.SQRT1_2);
    close(half[CH_L], 0.5);
    const edge = at(1, 1, 1);
    close(edge[CH_C], 0);
    close(edge[CH_R], 1);
  });

  it("only affects the LFE through the LFE send, which is not part of the unit-power panning", () => {
    expect(at(0, 1, 0, 0)[CH_LFE]).toBe(0);
    close(at(0, 1, 0, 0.5)[CH_LFE], 0.5);
    close(power(at(0, 1, 0, 1)), 1);
  });

  it("clamps and sanitises positions", () => {
    expect(sanitizeSurroundPan({ x: 5, y: -9, divergence: 2, lfeSend: -1 })).toEqual({ x: 1, y: -1, divergence: 1, lfeSend: 0 });
    expect(sanitizeSurroundPan(undefined)).toEqual(DEFAULT_SURROUND_PAN);
    expect(sanitizeSurroundPan({ x: Number.NaN }).x).toBe(-1);
  });

  it("resolves clip over track over the default", () => {
    const track = { surroundPan: { x: 1, y: 1, divergence: 0, lfeSend: 0 } };
    const clip = { surroundPan: { x: -1, y: 1, divergence: 0, lfeSend: 0 } };
    expect(resolveSurroundPan(clip, track).x).toBe(-1);
    expect(resolveSurroundPan({}, track).x).toBe(1);
    expect(resolveSurroundPan({}, {})).toEqual(DEFAULT_SURROUND_PAN);
  });
});

describe("source to 5.1 routing matrices", () => {
  it("positions a mono source with the panner", () => {
    const m = sourceToSurroundMatrix(1, { x: -1, y: 1, divergence: 0, lfeSend: 0 });
    expect(m).toHaveLength(SURROUND_CHANNELS);
    close(m[CH_L][0], 1);
    close(m[CH_R][0], 0);
  });

  it("passes a stereo source straight to L and R at the default position", () => {
    const m = sourceToSurroundMatrix(2);
    expect(m[CH_L]).toEqual([1, 0]);
    expect(m[CH_R]).toEqual([0, 1]);
    for (const out of [CH_C, CH_LFE, CH_LS, CH_RS]) expect(m[out]).toEqual([0, 0]);
  });

  it("moves a whole stereo image to the rear when the position moves back", () => {
    const m = sourceToSurroundMatrix(2, { x: 0, y: -1, divergence: 0, lfeSend: 0 });
    close(m[CH_LS][0], 1);
    close(m[CH_RS][1], 1);
    close(m[CH_L][0], 0);
    close(m[CH_R][1], 0);
  });

  it("sends a stereo source's mono sum to the LFE at unity when the send is full", () => {
    const m = sourceToSurroundMatrix(2, { x: 0, y: 1, divergence: 0, lfeSend: 1 });
    close(m[CH_LFE][0], 0.5);
    close(m[CH_LFE][1], 0.5);
  });

  it("maps a 5.1 source to its own channels, untouched by position", () => {
    const moved = sourceToSurroundMatrix(6, { x: 1, y: -1, divergence: 1, lfeSend: 1 });
    for (let out = 0; out < 6; out++) {
      for (let source = 0; source < 6; source++) expect(moved[out][source]).toBe(out === source ? 1 : 0);
    }
  });

  it("maps quad and 5.0 sources onto the matching speakers", () => {
    const quad = sourceToSurroundMatrix(4);
    expect(quad[CH_L][0]).toBe(1);
    expect(quad[CH_R][1]).toBe(1);
    expect(quad[CH_LS][2]).toBe(1);
    expect(quad[CH_RS][3]).toBe(1);
    const five = sourceToSurroundMatrix(5);
    expect(five[CH_C][2]).toBe(1);
    expect(five[CH_LS][3]).toBe(1);
    expect(five[CH_RS][4]).toBe(1);
    expect(five[CH_LFE].every((v) => v === 0)).toBe(true);
  });
});

describe("5.1 to stereo downmix", () => {
  it("uses the ITU-R BS.775 coefficients and drops the LFE", () => {
    expect(DOWNMIX_5_1_TO_STEREO[0]).toEqual([1, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0]);
    expect(DOWNMIX_5_1_TO_STEREO[1]).toEqual([0, 1, Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    const ones = Array.from({ length: 6 }, () => new Float32Array([1]));
    const [left, right] = downmixSurroundToStereo(ones);
    close(left[0], 1 + 2 * Math.SQRT1_2, 5);
    close(right[0], 1 + 2 * Math.SQRT1_2, 5);
    const lfeOnly = Array.from({ length: 6 }, (_, c) => new Float32Array([c === CH_LFE ? 1 : 0]));
    expect(downmixSurroundToStereo(lfeOnly).map((c) => c[0])).toEqual([0, 0]);
  });
});

/** A tiny channel-routing evaluator for the splitter / gain / merger graphs this module builds. */
interface Wire {
  from: FakeNode;
  to: FakeNode;
  output: number;
  input: number;
}
interface FakeNode {
  kind: "gain" | "splitter" | "merger";
  count: number;
  gain: { value: number; setTargetAtTime(v: number): void };
  channelCount: number;
  channelCountMode: string;
  channelInterpretation: string;
  connect(to: FakeNode, output?: number, input?: number): FakeNode;
  disconnect(): void;
}

function fakeContext() {
  const wires: Wire[] = [];
  const node = (kind: FakeNode["kind"], count = 2): FakeNode => {
    const n: FakeNode = {
      kind,
      count,
      gain: { value: 1, setTargetAtTime: (v: number) => (n.gain.value = v) },
      channelCount: 2,
      channelCountMode: "max",
      channelInterpretation: "speakers",
      connect(to, output = 0, input = 0) {
        wires.push({ from: n, to, output, input });
        return to;
      },
      disconnect() {
        for (let i = wires.length - 1; i >= 0; i--) if (wires[i].from === n) wires.splice(i, 1);
      },
    };
    return n;
  };
  const ctx = {
    createGain: () => node("gain"),
    createChannelSplitter: (n: number) => node("splitter", n),
    createChannelMerger: (n: number) => node("merger", n),
  };
  /** Channels leaving `target` for the given source channels entering `source`. */
  const evaluate = (source: FakeNode, signal: number[], target: FakeNode): number[] => {
    const memo = new Map<FakeNode, number[]>();
    const outputOf = (n: FakeNode): number[] => {
      if (n === source) return signal.map((v) => v * (n.kind === "gain" ? n.gain.value : 1));
      const cached = memo.get(n);
      if (cached) return cached;
      const incoming = wires.filter((w) => w.to === n);
      const width = n.kind === "merger" ? n.count : Math.max(1, ...incoming.map((w) => (w.from.kind === "splitter" ? 1 : outputOf(w.from).length)));
      const sum = new Array<number>(width).fill(0);
      for (const w of incoming) {
        const out = outputOf(w.from);
        if (w.from.kind === "splitter") {
          const value = out[w.output] ?? 0;
          if (n.kind === "merger") sum[w.input] += value;
          else sum[0] += value;
        } else if (n.kind === "merger") {
          sum[w.input] += out[0] ?? 0;
        } else {
          out.forEach((v, i) => (sum[i] += v));
        }
      }
      const result = n.kind === "gain" ? sum.map((v) => v * n.gain.value) : sum;
      memo.set(n, result);
      return result;
    };
    return outputOf(target);
  };
  return { ctx: ctx as unknown as BaseAudioContext, evaluate, wires };
}

describe("surround panner nodes", () => {
  const matrixOf = (sourceChannels: number, pan = DEFAULT_SURROUND_PAN) => {
    const { ctx, evaluate } = fakeContext();
    const panner = createSurroundPanner(ctx, sourceChannels, pan);
    const columns = Array.from({ length: sourceChannels }, (_, c) =>
      evaluate(panner.input as unknown as FakeNode, Array.from({ length: sourceChannels }, (_, i) => (i === c ? 1 : 0)), panner.output as unknown as FakeNode),
    );
    return { panner, columns, input: panner.input as unknown as FakeNode };
  };

  it("builds exactly the routing matrix: every source channel reaches the channels the matrix says", () => {
    for (const sourceChannels of [1, 2, 4, 5, 6]) {
      const pan = { x: 0.4, y: 0.2, divergence: 0.5, lfeSend: 0.3 };
      const { columns } = matrixOf(sourceChannels, pan);
      const expected = sourceToSurroundMatrix(sourceChannels, pan);
      for (let source = 0; source < sourceChannels; source++) {
        for (let out = 0; out < SURROUND_CHANNELS; out++) close(columns[source][out] ?? 0, expected[out][source]);
      }
    }
  });

  it("reads the source discretely so no Web Audio up/down-mix rule touches it", () => {
    const { input } = matrixOf(6);
    expect(input.channelCount).toBe(6);
    expect(input.channelCountMode).toBe("explicit");
    expect(input.channelInterpretation).toBe("discrete");
  });

  it("moves with setPan without rebuilding nodes", () => {
    const { ctx, evaluate, wires } = fakeContext();
    const panner = createSurroundPanner(ctx, 1);
    const before = wires.length;
    panner.setPan({ x: 1, y: -1, divergence: 0, lfeSend: 0 });
    expect(wires.length).toBe(before);
    const out = evaluate(panner.input as unknown as FakeNode, [1], panner.output as unknown as FakeNode);
    close(out[CH_RS], 1);
    close(out[CH_L], 0);
  });

  it("does not position a 5.1 source: setPan leaves the pass-through alone", () => {
    const { ctx, evaluate } = fakeContext();
    const panner = createSurroundPanner(ctx, 6);
    panner.setPan({ x: 1, y: -1, divergence: 1, lfeSend: 1 });
    const out = evaluate(panner.input as unknown as FakeNode, [1, 2, 3, 4, 5, 6], panner.output as unknown as FakeNode);
    expect(out.map((v) => Math.round(v))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("5.1 rack pairs", () => {
  it("splits six channels into L R / C LFE / Ls Rs and merges them back to the same channels", () => {
    const { ctx, evaluate } = fakeContext();
    const seenPairs: FakeNode[][] = [];
    const pairs = createSurroundPairs(ctx, () => {
      const input = ctx.createGain();
      const output = ctx.createGain();
      input.connect(output);
      seenPairs.push([input as unknown as FakeNode, output as unknown as FakeNode]);
      return { input, output };
    });
    expect(pairs.pairs).toHaveLength(3);
    const out = evaluate(pairs.input as unknown as FakeNode, [1, 2, 3, 4, 5, 6], pairs.output as unknown as FakeNode);
    expect(out.map((v) => Math.round(v))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("runs the rack of each pair on its own two channels", () => {
    const { ctx, evaluate } = fakeContext();
    // Pair 1 (C, LFE) is attenuated by 0.5; the other pairs are transparent.
    const pairs = createSurroundPairs(ctx, (index) => {
      const gain = ctx.createGain();
      gain.gain.value = index === 1 ? 0.5 : 1;
      return { input: gain, output: gain };
    });
    const out = evaluate(pairs.input as unknown as FakeNode, [1, 1, 1, 1, 1, 1], pairs.output as unknown as FakeNode);
    expect(out).toEqual([1, 1, 0.5, 0.5, 1, 1]);
  });
});
