import { describe, expect, it } from "vitest";
import { createInlineReverbBackend } from "./reverb-worker-client";
import { createReverbHandler, reverbTransferListOf, type ReverbResponse } from "./reverb-worker-core";
import { ReverbCancelledError } from "./reverb-params";

const RATE = 16000;
const voiceLike = (seconds: number) => Float32Array.from({ length: RATE * seconds }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 180 * i) / RATE) * (Math.sin((2 * Math.PI * 3 * i) / RATE) > 0 ? 1 : 0.05));

describe("Reduce Reverb worker handler", () => {
  it("answers a request with progress and a result of the source's length, and transfers each shared buffer once", async () => {
    const handler = createReverbHandler();
    const posted: ReverbResponse[] = [];
    const channel = voiceLike(3);
    await handler.handle({ id: 1, kind: "reduce", channels: [channel, channel], sampleRate: RATE, params: { amount: 60, sensitivity: 50 } }, (response) => posted.push(response));
    const done = posted.find((r) => r.kind === "done");
    expect(done).toBeDefined();
    if (done?.kind !== "done") throw new Error("no result");
    expect(done.channels).toHaveLength(2);
    expect(done.channels[0]).toHaveLength(channel.length);
    expect(done.channels[0]).toBe(done.channels[1]);
    expect(reverbTransferListOf(done)).toHaveLength(1);
    expect(posted.some((r) => r.kind === "progress")).toBe(true);
  }, 60_000);

  it("reports a cancel as cancelled, not as a failure", async () => {
    const handler = createReverbHandler();
    const posted: ReverbResponse[] = [];
    const running = handler.handle({ id: 7, kind: "reduce", channels: [voiceLike(8)], sampleRate: RATE, params: { amount: 60, sensitivity: 50 } }, (response) => posted.push(response));
    await handler.handle({ id: 7, kind: "cancel" }, () => undefined);
    await running;
    expect(posted[posted.length - 1]).toMatchObject({ kind: "error", cancelled: true });
  }, 60_000);

  it("the inline backend runs the same handler, honours abort and refuses very long sources", async () => {
    const backend = createInlineReverbBackend();
    const result = await backend.reduce([voiceLike(2)], RATE, { amount: 60, sensitivity: 50 });
    expect(result.channels[0]).toHaveLength(RATE * 2);
    expect(result.rt60).toBeGreaterThan(0);
    const controller = new AbortController();
    const pending = backend.reduce([voiceLike(8)], RATE, { amount: 60, sensitivity: 50 }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ReverbCancelledError);
    await expect(backend.reduce([new Float32Array(RATE * 121)], RATE, { amount: 60, sensitivity: 50 })).rejects.toThrow(/limited to 120s/);
  }, 60_000);
});
