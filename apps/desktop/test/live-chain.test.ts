import { describe, expect, it } from "vitest";
import path from "node:path";
import { LiveChain, type LiveStepConfig } from "../src/main/plughost/live-chain";
import { LiveInsertService, type LivePortLike } from "../src/main/plughost/live-service";

const MOCK = path.resolve(__dirname, "fixtures/mock-plughost.mjs");
const SR = 48000;
const B = 128;
const spawn = { command: process.execPath, args: [MOCK, "serve"] };
const step = (pluginId: string, values: Record<string, number> = {}, effectId = pluginId, automation: LiveStepConfig["automation"] = {}): LiveStepConfig => ({ pluginId, effectId, values, automation, spawn });

const block = (value: number): Float32Array => new Float32Array(2 * B).fill(value);
const waitFor = async (condition: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

function rig(steps: LiveStepConfig[], extra: Partial<ConstructorParameters<typeof LiveChain>[0]> = {}) {
  const posted: Array<Record<string, any>> = [];
  const chain = new LiveChain({ steps, sampleRate: SR, blockFrames: B, post: (m) => posted.push(m), warmupBlocks: 8, ...extra });
  return { chain, posted, outs: () => posted.filter((m) => m.t === "out") };
}

describe("LiveChain (mock helper)", () => {
  it("opens one helper per plugin, reports the summed latency and sizes the jitter buffer", async () => {
    const { chain } = rig([step("au:aufx:lkah:mock"), step("au:aufx:gain:mock")]);
    const open = await chain.open();
    expect(open.perPluginLatencyFrames).toEqual([300, 0]);
    expect(open.pluginLatencyFrames).toBe(300);
    expect(open.blockFrames).toBe(B);
    expect(open.prefillBlocks).toBeGreaterThanOrEqual(2);
    expect(open.roundTripMs.p95).toBeGreaterThan(0);
    expect(chain.pids).toHaveLength(2);
    chain.dispose();
    expect(chain.pids).toEqual([]);
  });

  it("streams blocks through the chain in order and posts them back with their sequence numbers", async () => {
    const { chain, outs } = rig([step("au:aufx:gain:mock", { "0": 0.5 }), step("au:aufx:gain:mock", { "0": 0.5 }, "second")]);
    await chain.open();
    chain.onMessage({ t: "epoch", epoch: 1, seconds: 0 });
    for (let seq = 0; seq < 6; seq += 1) chain.onMessage({ t: "in", epoch: 1, seq, data: block(seq + 1) });
    await waitFor(() => outs().length === 6);
    expect(outs().map((m) => m.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(outs().every((m) => m.epoch === 1)).toBe(true);
    outs().forEach((m, i) => expect((m.data as Float32Array)[0]).toBeCloseTo((i + 1) * 0.25, 6));
    expect(chain.stats()).toMatchObject({ blocksIn: 6, blocksOut: 6, dropped: 0 });
    chain.dispose();
  });

  it("a parameter change reaches the plugin with the next block that is dispatched", async () => {
    const { chain, outs } = rig([step("au:aufx:gain:mock", { "0": 1 })]);
    await chain.open();
    chain.onMessage({ t: "epoch", epoch: 1, seconds: 0 });
    chain.onMessage({ t: "in", epoch: 1, seq: 0, data: block(1) });
    await waitFor(() => outs().length === 1);
    expect(chain.setValues("au:aufx:gain:mock", { "0": 3 })).toBe(true);
    expect(chain.setValues("nope", { "0": 3 })).toBe(false);
    chain.onMessage({ t: "in", epoch: 1, seq: 1, data: block(1) });
    await waitFor(() => outs().length === 2);
    expect((outs()[0].data as Float32Array)[5]).toBeCloseTo(1, 6);
    expect((outs()[1].data as Float32Array)[5]).toBeCloseTo(3, 6);
    chain.dispose();
  });

  it("automation lanes are evaluated at the block's TIMELINE time (epoch start + seq * block)", async () => {
    // gain 0 at t=0 rising to 2 at t=10 s; the epoch starts at 5 s, so block 0 has gain 1
    const { chain, outs } = rig([step("au:aufx:gain:mock", {}, "fx", { "0": [[0, 0], [10, 2]] })]);
    await chain.open();
    chain.onMessage({ t: "epoch", epoch: 1, seconds: 5 });
    chain.onMessage({ t: "in", epoch: 1, seq: 0, data: block(1) });
    await waitFor(() => outs().length === 1);
    expect((outs()[0].data as Float32Array)[0]).toBeCloseTo(1, 3);
    // new lanes arrive while playing
    chain.setValues("fx", undefined, { "0": [[0, 4], [10, 4]] });
    chain.onMessage({ t: "in", epoch: 1, seq: 1, data: block(1) });
    await waitFor(() => outs().length === 2);
    expect((outs()[1].data as Float32Array)[0]).toBeCloseTo(4, 3);
    chain.dispose();
  });

  it("blocks of another epoch are dropped, and a new epoch resets the plugins' history", async () => {
    const { chain, outs } = rig([step("au:aufx:lkah:mock", { "0": 1 })]);
    await chain.open();
    chain.onMessage({ t: "epoch", epoch: 1, seconds: 0 });
    chain.onMessage({ t: "in", epoch: 1, seq: 0, data: block(1) });
    await waitFor(() => outs().length === 1);
    chain.onMessage({ t: "epoch", epoch: 2, seconds: 3 });
    chain.onMessage({ t: "in", epoch: 1, seq: 1, data: block(1) }); // stale
    chain.onMessage({ t: "in", epoch: 2, seq: 0, data: block(0.5) });
    await waitFor(() => outs().length === 2);
    expect(outs()[1].epoch).toBe(2);
    // the lookahead mock delays by 300 frames: with its history cleared by the reset, the first 128 frames of the new epoch are silence, not the old tone
    expect((outs()[1].data as Float32Array)[10]).toBe(0);
    expect(chain.stats().staleDropped).toBe(1);
    chain.dispose();
  });

  it("an idle worklet (transport stopped) makes later blocks stale", async () => {
    const { chain, outs } = rig([step("au:aufx:gain:mock")]);
    await chain.open();
    chain.onMessage({ t: "epoch", epoch: 1, seconds: 0 });
    chain.onMessage({ t: "idle" });
    chain.onMessage({ t: "in", epoch: 1, seq: 0, data: block(1) });
    await new Promise((r) => setTimeout(r, 50));
    expect(outs()).toHaveLength(0);
    chain.dispose();
  });

  it("blocks that find the pipes full wait in a queue instead of being dropped, so the plugins see an unbroken stream", async () => {
    const { chain, outs } = rig([step("au:aufx:gain:mock", { "0": 1 })], { maxInFlight: 1 });
    await chain.open();
    chain.onMessage({ t: "epoch", epoch: 1, seconds: 0 });
    for (let seq = 0; seq < 20; seq += 1) chain.onMessage({ t: "in", epoch: 1, seq, data: block(seq) });
    await waitFor(() => outs().length === 20);
    expect(outs().map((m) => m.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    const stats = chain.stats();
    expect(stats.queued).toBeGreaterThan(0);
    expect(stats.dropped).toBe(0);
    chain.dispose();
  });

  it("a helper that crashes mid-stream ends the chain, tells the worklet and never throws", async () => {
    const failures: string[] = [];
    const { chain, posted, outs } = rig([step("au:aufx:cr3b:mock")], { onFailure: (reason) => failures.push(reason) });
    // the warm-up consumes blocks too: this mock crashes on its third block, so open itself reports it
    await expect(chain.open()).rejects.toThrow(/killed by|exited/);
    expect(outs()).toHaveLength(0);
    chain.dispose();
    // a plugin that survives open and dies later: the late crash of a VST3 bundle is not available in the mock, so crash the process directly
    const liveFailures: string[] = [];
    const live = rig([step("au:aufx:gain:mock")], { onFailure: (reason) => liveFailures.push(reason) });
    await live.chain.open();
    live.chain.onMessage({ t: "epoch", epoch: 1, seconds: 0 });
    process.kill(live.chain.pids[0], "SIGKILL");
    live.chain.onMessage({ t: "in", epoch: 1, seq: 0, data: block(1) });
    await waitFor(() => live.chain.failed !== null);
    expect(live.chain.failed).toMatch(/killed by|exited|closed/);
    expect(live.posted.some((m) => m.t === "status" && m.state === "crashed" && typeof m.reason === "string")).toBe(true);
    expect(liveFailures).toHaveLength(1);
    expect(failures.length, "an open that fails reports through the same path").toBeGreaterThanOrEqual(1);
    // later blocks are ignored quietly
    live.chain.onMessage({ t: "in", epoch: 1, seq: 1, data: block(1) });
    expect(live.outs()).toHaveLength(0);
    expect(posted.filter((m) => m.t === "out")).toHaveLength(0);
    live.chain.dispose();
  });

  it("a plugin that returns NaN stops the chain at the first bad block", async () => {
    const { chain, posted } = rig([step("au:aufx:nan0:mock")]);
    await chain.open();
    chain.onMessage({ t: "epoch", epoch: 1, seconds: 0 });
    chain.onMessage({ t: "in", epoch: 1, seq: 0, data: block(0.2) });
    await waitFor(() => chain.failed !== null);
    expect(chain.failed).toMatch(/NaN/);
    expect(posted.some((m) => m.t === "status")).toBe(true);
    chain.dispose();
  });

  it("a plugin that hangs at open rejects on the timeout and leaves no process behind", async () => {
    const { chain } = rig([step("au:aufx:hang:mock")], { openTimeoutMs: 300 });
    await expect(chain.open()).rejects.toThrow(/did not answer/);
    expect(chain.pids).toEqual([]);
  });
});

describe("LiveInsertService", () => {
  const port = (): LivePortLike & { sent: unknown[]; emit(data: unknown): void } => {
    const listeners: Array<(event: { data: unknown }) => void> = [];
    return {
      sent: [],
      postMessage(message) {
        this.sent.push(message);
      },
      on(_event, listener) {
        listeners.push(listener);
      },
      start() {},
      close() {},
      emit(data) {
        for (const l of listeners) l({ data });
      },
    };
  };
  const scan = (status: string) => ({ plugins: [{ id: "au:aufx:gain:mock", format: "au" as const, status, name: "Mock Gain", statusReason: "blocked after a crash" }] });
  const service = (status = "ok", binary = true) => {
    const local = port();
    const delivered: unknown[] = [];
    const svc = new LiveInsertService({ ensureScanned: async () => scan(status), helper: () => (binary ? spawn : null), createChannel: () => ({ local, remote: "remote-port" }) });
    return { svc, local, delivered };
  };
  const args = (deliver: (remote: unknown) => void) => ({ sessionId: "s1", steps: [{ pluginId: "au:aufx:gain:mock", effectId: "fx", values: { "0": 2 }, automation: {} }], sampleRate: SR, blockFrames: B, deliver });

  it("opens a session, hands the renderer its port end, streams blocks and closes cleanly", async () => {
    const { svc, local, delivered } = service();
    const outcome = await svc.open(args((remote) => delivered.push(remote)));
    expect(outcome).toMatchObject({ ok: true, sessionId: "s1" });
    expect(delivered).toEqual(["remote-port"]);
    local.emit({ t: "epoch", epoch: 1, seconds: 0 });
    local.emit({ t: "in", epoch: 1, seq: 0, data: new Float32Array(2 * B).fill(1) });
    await waitFor(() => local.sent.some((m) => (m as { t?: string }).t === "out"));
    expect(svc.stats("s1")?.blocksOut).toBe(1);
    expect(svc.setValues("s1", "fx", { "0": 1 })).toBe(true);
    svc.close("s1");
    expect(svc.stats("s1")).toBeNull();
    expect(svc.count).toBe(0);
  });

  it("answers unavailable for blocked or missing plugins and a build without a helper, without spawning anything", async () => {
    expect(await service("blocked").svc.open(args(() => undefined))).toMatchObject({ ok: false, kind: "unavailable", message: expect.stringMatching(/cannot be used/) });
    expect(await service("ok", false).svc.open(args(() => undefined))).toMatchObject({ ok: false, kind: "unavailable", message: expect.stringMatching(/no plugin helper/) });
    const missing = service();
    expect(await missing.svc.open({ ...args(() => undefined), steps: [{ pluginId: "au:aufx:zzzz:mock", effectId: "fx", values: {}, automation: {} }] })).toMatchObject({ ok: false, kind: "unavailable" });
    expect(await missing.svc.open({ ...args(() => undefined), steps: [{ pluginId: "bogus", effectId: "fx", values: {}, automation: {} }] })).toMatchObject({ ok: false, kind: "unavailable" });
  });

  it("reports an open that fails as failed and delivers no port", async () => {
    const local = port();
    const delivered: unknown[] = [];
    const svc = new LiveInsertService({
      ensureScanned: async () => ({ plugins: [{ id: "au:aufx:cras:mock", format: "au", status: "ok", name: "Mock Crasher" }] }),
      helper: () => spawn,
      createChannel: () => ({ local, remote: "r" }),
    });
    const outcome = await svc.open({ ...args((r) => delivered.push(r)), steps: [{ pluginId: "au:aufx:cras:mock", effectId: "fx", values: {}, automation: {} }] });
    expect(outcome).toMatchObject({ ok: false, kind: "failed" });
    expect(delivered).toEqual([]);
    expect(svc.count).toBe(0);
  });
});
